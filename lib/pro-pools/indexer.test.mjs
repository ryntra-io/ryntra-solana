import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import { Connection } from "@solana/web3.js";

/*
 * The indexer of the DLMM Pro pools' tape over a store in memory that keeps the database's own rules and a node made
 * up for the case (`./fixtures/synthetic.mjs`): one step lists, reads, counts and writes; it is safe to run again;
 * two never run together; the node's budget holds; the day is read before anything older and the newest of every pool
 * before any pool's backlog; a node that fails is counted, not fatal; what is older than three days is let go; and a
 * pool's number never falls from one step to the next. The last test runs the program's own recorded transactions
 * through it and gets the day the instance's own reader counts.
 */

const { indexerStep, planReads, readable, INDEXER_LIMITS } = await import("./indexer.server.ts");
const { createMemoryProStore, ProStoreUnavailable } = await import("./store.ts");
const { createTapeReader, TAPE_LIMITS } = await import("./tape.server.ts");
const tape = await import("./tape.ts");
const { earnProVenue } = await import("../earn-pro/venue.server.ts");
const { chain, rowOf, addressOf } = await import("./fixtures/synthetic.mjs");

const T0 = Date.parse("2026-11-20T12:00:00.000Z");
const S0 = T0 / 1000;
const HOUR = 3_600;
const MAINNET = "mainnet";

/** A clock the test moves, a store on it, a node, and a step over them. */
function stand(names, limits = {}) {
  let now = T0;
  const clock = () => now;
  const store = createMemoryProStore(clock);
  const node = chain();
  const rows = names.map(rowOf);
  const step = (over = {}) => indexerStep({ network: MAINNET, store, source: node.source, pools: async () => rows, limits: { ...INDEXER_LIMITS, ...limits, ...over }, clock });
  const stateOf = async (name) => (await store.states(MAINNET)).pools.get(addressOf(name));
  return { store, node, rows, step, stateOf, clock, move: (ms) => (now += ms) };
}

const usdOf = (state) => state?.summary?.stats.volume.usd ?? null;

test("a step lists every pool, reads what landed, counts the day from the stored rows and writes each pool's row", async () => {
  const { node, step, stateOf, store } = stand(["BUSY", "QUIET"]);
  node.land("BUSY", S0 - 30 * HOUR);
  for (let hour = 5; hour >= 1; hour -= 1) node.land("BUSY", S0 - hour * HOUR);
  node.land("QUIET", S0 - 48 * HOUR);

  const report = await step();
  assert.deepEqual([report.ran, report.pools, report.unlisted, report.listed, report.read, report.lost, report.counted], [true, 2, 0, 7, 7, 0, 2]);

  const busy = await stateOf("BUSY");
  assert.deepEqual([busy.summary.depth.whole, busy.summary.depth.stop, busy.summary.depth.transactions], [true, "window", 5], "the list reaches back past the day's start, and all of the day is read");
  assert.deepEqual([busy.summary.stats.trades.count, busy.summary.stats.volume.usd, busy.summary.stats.fees.lp.yRaw, busy.summary.stats.whole], [5, 500, "5000", true]);
  assert.equal(busy.summary.depth.from, new Date((S0 - 5 * HOUR) * 1000).toISOString(), "from the oldest transaction counted");
  assert.deepEqual([busy.fails, busy.checkedAt, busy.cursor.end], [0, T0, true]);

  const quiet = await stateOf("QUIET");
  assert.deepEqual([quiet.summary.depth.whole, quiet.summary.stats.trades.count, quiet.summary.stats.volume.usd], [true, 0, 0], "a quiet day is zeros, counted whole — never «counting» for ever");
  const last = await store.recent(MAINNET, addressOf("QUIET"), { kind: "trades", since: null, limit: 10, tries: 3 });
  assert.equal(last.txs.length, 1, "a quiet pool keeps its last trades for its page");
});

test("a step is safe to run again: nothing is read twice, nothing is counted twice — after a step that died half way too", async () => {
  const { node, step, stateOf, store, move } = stand(["A"]);
  node.land("A", S0 - 30 * HOUR);
  for (let hour = 4; hour >= 1; hour -= 1) node.land("A", S0 - hour * HOUR);

  /* The first step dies before it writes the pool's row: its transactions are kept, its cursor is not. */
  const putStates = store.putStates;
  const dying = { ...store, putStates: async () => { throw new ProStoreUnavailable("the database went away"); } };
  const died = await indexerStep({ network: MAINNET, store: dying, source: node.source, pools: async () => [rowOf("A")], limits: INDEXER_LIMITS, clock: () => T0 });
  assert.deepEqual([died.ran, died.reason], [false, "store"]);
  assert.equal(await stateOf("A"), undefined);
  assert.equal(node.calls.events, 5);
  assert.equal(store.putStates, putStates);

  move(60_000);
  const again = await step();
  assert.deepEqual([again.ran, again.read], [true, 0], "listed again from the start, and every transaction is already read");
  assert.equal(node.calls.events, 5, "the node is not asked for a transaction twice");
  assert.deepEqual([usdOf(await stateOf("A")), (await stateOf("A")).summary.stats.trades.count], [400, 4]);

  move(60_000);
  const third = await step();
  assert.deepEqual([third.ran, third.listed, third.read], [true, 0, 0], "nothing landed: only what landed since the cursor is listed");
  assert.deepEqual([usdOf(await stateOf("A")), (await stateOf("A")).summary.stats.trades.count], [400, 4], "the same day, the same number");
});

test("one indexer at a time: a second step does nothing while the first runs, nor sooner than the gap after it began", async () => {
  const { node, step, move } = stand(["A"]);
  node.land("A", S0 - 30 * HOUR);
  node.land("A", S0 - HOUR);

  const [first, second] = await Promise.all([step(), step()]);
  assert.deepEqual([first.ran, second.ran, second.reason], [true, false, "lease"]);
  assert.equal(node.calls.events, 2, "the second read nothing");

  move(20_000);
  assert.deepEqual([(await step()).reason], ["lease"], "twenty seconds after a step began is too soon for the next");
  move(INDEXER_LIMITS.gapS * 1000);
  assert.equal((await step()).ran, true);
});

test("the node's budget holds: a step reads at most half the minute's budget, and steps begin no closer than the gap", async () => {
  assert.equal(INDEXER_LIMITS.readsPerStep * 2, TAPE_LIMITS.readsPerMinute, "two steps' reads are the minute's budget, never more");
  assert.ok(INDEXER_LIMITS.gapS * 2 + (INDEXER_LIMITS.time - INDEXER_LIMITS.countTime) / 1000 > 60, "no minute holds the reads of three steps");
  const { node, step, stateOf, move } = stand(["A"]);
  node.land("A", S0 - 30 * HOUR);
  for (let at = 400; at >= 1; at -= 1) node.land("A", S0 - at * 60);

  const asked = [];
  for (let turn = 0; turn < 3; turn += 1) {
    const before = node.calls.events;
    const report = await step();
    asked.push(node.calls.events - before);
    assert.equal(report.ran, true);
    move(60_000);
  }
  assert.deepEqual(asked, [150, 150, 100], "the day's four hundred transactions take three steps; the one before the day is neither kept nor read");
  const state = await stateOf("A");
  assert.deepEqual([state.summary.depth.whole, state.summary.stats.trades.count], [true, 400]);
});

test("the newest of every pool is read before any pool's backlog, the deepest pool's backlog first, and the day before anything older", async () => {
  const { node, step } = stand(["DEEP", "NEXT"], { concurrency: 1, freshShare: 2, firstShare: 0 });
  node.land("DEEP", S0 - 40 * HOUR);
  node.land("DEEP", S0 - 30 * HOUR);
  for (let hour = 5; hour >= 1; hour -= 1) node.land("DEEP", S0 - hour * HOUR);
  node.land("NEXT", S0 - 30 * HOUR);
  for (let hour = 4; hour >= 1; hour -= 1) node.land("NEXT", S0 - hour * HOUR);

  await step();
  assert.deepEqual(node.calls.read, [
    /* the day: the newest two of each pool… */
    "DEEP7", "DEEP6", "NEXT5", "NEXT4",
    /* …then the deepest pool's backlog, then the next one's… */
    "DEEP5", "DEEP4", "DEEP3", "NEXT3", "NEXT2",
    /* …and only then what is older than the day, kept for the pools' pages. */
    "DEEP2", "DEEP1", "NEXT1",
  ]);

  const pending = (pool, slot, blockTime) => ({ pool, signature: `${pool}${slot}`, slot, blockTime, state: "unread", misses: 0, lostAt: null });
  const plan = planReads([pending("b", 9, 50), pending("a", 8, 50), pending("a", 7, 50), pending("b", 6, 5), pending("a", 5, 50)], ["a", "b"], 1, 4, 10);
  assert.deepEqual(plan.map((tx) => tx.signature), ["a8", "b9", "a7", "a5"], "at most as many as the step may read");
});

test("a node that fails is counted, never fatal: a transaction it does not give, a pool it does not list", async () => {
  const { node, step, stateOf, store, move } = stand(["A", "B"], { lostRetry: 60_000 });
  node.land("A", S0 - 30 * HOUR);
  for (let hour = 3; hour >= 1; hour -= 1) node.land("A", S0 - hour * HOUR);
  node.land("B", S0 - HOUR);
  node.faults.events = (_signature, label) => label === "A3";
  node.faults.list = (address) => address === addressOf("B");

  const first = await step();
  assert.deepEqual([first.ran, first.unlisted, first.read, first.lost], [true, 1, 3, 1]);
  let a = await stateOf("A");
  assert.deepEqual([usdOf(a), a.summary.depth.whole, a.summary.depth.stop], [200, false, "budget"], "the two it read are counted — a floor; the third is still to read");
  assert.deepEqual([(await stateOf("B")).fails, (await stateOf("B")).summary], [1, null]);
  const days = await import("./answers.server.ts").then(({ dayEntryOf }) => dayEntryOf);
  assert.equal(days(addressOf("B"), await stateOf("B")).state, "counting");

  for (let turn = 0; turn < 2; turn += 1) {
    move(60_000);
    await step();
  }
  a = await stateOf("A");
  assert.deepEqual([usdOf(a), a.summary.depth.whole, a.summary.depth.stop], [200, false, "node"], "refused three times: the node's gap, said so");
  const [lost] = await store.unread(MAINNET, 10);
  assert.deepEqual([lost.state, lost.misses], ["lost", 3]);
  const b = await stateOf("B");
  assert.deepEqual([b.fails, days(b.pool, b).state], [3, "unknown"], "a pool never counted that the node refused three times in a row is «unknown»");

  /* A refused transaction is asked again after a while, longer each time; the node back, it is read and the pool listed. */
  assert.equal(readable(lost, T0 + 120_000, { tries: 3, lostRetry: 60_000 }), false);
  node.faults.events = () => false;
  node.faults.list = () => false;
  move(60_000);
  await step();
  a = await stateOf("A");
  assert.deepEqual([usdOf(a), a.summary.depth.whole], [300, true]);
  /* A pool the node kept refusing is asked again every ten minutes, not every step. */
  assert.equal((await stateOf("B")).fails, 3);
  move(INDEXER_LIMITS.quietEvery);
  await step();
  assert.deepEqual([(await stateOf("B")).fails, usdOf(await stateOf("B"))], [0, 100]);
});

test("what is older than three days is let go by the indexer itself; the last transactions of a pool stay for its page", async () => {
  const { node, step, stateOf, store, move } = stand(["A"], { tapeMin: 2 });
  for (let hour = 6; hour >= 1; hour -= 1) node.land("A", S0 - hour * HOUR);
  await step();
  const all = () => store.recent(MAINNET, addressOf("A"), { kind: "any", since: null, limit: 100, tries: 3 });
  assert.equal((await all()).txs.length, 6);

  move(2 * 86_400_000);
  assert.equal((await step()).purged, 0, "two days on, everything is kept");
  assert.equal((await all()).txs.length, 6);

  move(2 * 86_400_000);
  const report = await step();
  assert.equal(report.purged, 4);
  assert.deepEqual((await all()).txs.map((tx) => node.labelOf(tx.moment.signature)), ["A6", "A5"], "the newest two stay whatever their age");
  const state = await stateOf("A");
  assert.deepEqual([state.summary.stats.trades.count, state.summary.depth.whole], [0, true], "and the day, four days on, is empty and whole");
});

test("a pool's number never falls from one step to the next: not while its backlog is read, not when new trades wait, not when the node refuses the newest", async () => {
  const { node, step, stateOf, move } = stand(["A"], { readsPerStep: 3, concurrency: 1 });
  node.land("A", S0 - 30 * HOUR);
  for (let hour = 10; hour >= 1; hour -= 1) node.land("A", S0 - hour * HOUR);

  const seen = [];
  const run = async () => {
    await step();
    seen.push(usdOf(await stateOf("A")));
    move(60_000);
  };
  await run();
  assert.deepEqual(seen, [300], "three read of ten: a floor");
  assert.equal((await stateOf("A")).summary.depth.whole, false);

  /* New trades land while the backlog is still being read. */
  node.land("A", (T0 + 60_000) / 1000 - 5);
  node.land("A", (T0 + 60_000) / 1000 - 4);
  await run();
  /* The node refuses the newest trade of all. */
  const newest = node.land("A", (T0 + 120_000) / 1000 - 5);
  node.faults.lost = (signature) => signature === newest.signature;
  await run();
  await run();
  node.faults.lost = () => false;
  for (let turn = 0; turn < 4; turn += 1) await run();

  for (let at = 1; at < seen.length; at += 1) assert.ok(seen[at] >= seen[at - 1], `step ${at + 1} answered less than the step before: ${seen.join(", ")}`);
  assert.equal(seen.at(-1), 1300, "and it ends at the whole day: ten, two and one");
  assert.equal((await stateOf("A")).summary.depth.whole, true);
});

test("more landed than a step can join to what it knows: the pool starts over from now, and its number is counted again", async () => {
  const { node, step, stateOf, move } = stand(["A"], { page: 4, bridgePages: 2 });
  node.land("A", S0 - 30 * HOUR);
  node.land("A", S0 - 60);
  await step();
  assert.equal(usdOf(await stateOf("A")), 100);

  move(60_000);
  for (let at = 20; at >= 1; at -= 1) node.land("A", (T0 + 60_000) / 1000 - at);
  const report = await step();
  assert.equal(report.ran, true);
  const state = await stateOf("A");
  assert.deepEqual([state.cursor.end, state.summary.depth.whole], [false, false], "the day is open again until older pages are listed");
  for (let turn = 0; turn < 6; turn += 1) {
    move(60_000);
    await step();
  }
  const settled = await stateOf("A");
  assert.deepEqual([usdOf(settled), settled.summary.depth.whole], [2100, true], "every trade of the day is back");
});

test("the program's own transactions through the indexer give the day the instance's own reader counts", async () => {
  const fixture = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/tape-rehearsal.json.gz", import.meta.url))).toString());
  const bySignature = new Map(fixture.transactions.map((tx) => [tx.signature, tx]));
  const connection = new Connection("http://127.0.0.1:9");
  connection._rpcRequest = async (_method, params) => ({ result: bySignature.get(params[0])?.record ?? null });
  const venue = earnProVenue("mainnet", connection, { RYNTRA_EARN_PRO: "mainnet" });
  const keysOf = (record) => [...record.transaction.message.accountKeys, ...(record.meta.loadedAddresses?.writable ?? []), ...(record.meta.loadedAddresses?.readonly ?? [])];
  const source = {
    async list(address, { limit, before, until }) {
      let rows = fixture.transactions.filter((tx) => keysOf(tx.record).includes(address) && tx.record.blockTime <= asOf).sort((a, b) => b.record.slot - a.record.slot);
      if (before) rows = rows.slice(rows.findIndex((tx) => tx.signature === before) + 1);
      if (until) {
        const at = rows.findIndex((tx) => tx.signature === until);
        if (at >= 0) rows = rows.slice(0, at);
      }
      return rows.slice(0, limit).map((tx) => ({ signature: tx.signature, slot: tx.record.slot, blockTime: tx.record.blockTime, err: tx.record.meta.err }));
    },
    events: (signature) => venue.events.read(signature),
  };
  /* A minute after the rehearsal's first hour: the pool was created inside the day. */
  const asOf = fixture.transactions.find((tx) => tx.name === "removeCompounded").record.blockTime + 60;
  const now = asOf * 1000;
  const row = { address: fixture.pools.usdc.address, x: { ...fixture.pools.usdc.x, symbol: "RHRSL", name: null, icon: null, verified: null, usd: null }, y: { ...fixture.pools.usdc.y, symbol: "USDC", name: null, icon: null, verified: null, usd: 1 }, fee: { collectedIn: "tokenY" } };

  const store = createMemoryProStore(() => now);
  const report = await indexerStep({ network: MAINNET, store, source, pools: async () => [row], limits: INDEXER_LIMITS, clock: () => now });
  assert.equal(report.ran, true);
  const { summary } = (await store.states(MAINNET)).pools.get(row.address);

  const reader = createTapeReader(source, TAPE_LIMITS, () => now);
  const view = await reader.read(tape.tapePoolOf(row), now, "tape");
  const own = tape.statsOf(view, now);
  assert.equal(view.depth.whole, true);
  assert.deepEqual([summary.depth.whole, summary.depth.stop, summary.depth.transactions, summary.depth.from], [true, "start", view.depth.transactions, view.depth.from], "the pool's creation is read: its whole life");
  assert.deepEqual([own.trades.count, own.orders.filled + own.orders.partial], [5, 3],"trades and filled orders are in it");
  /* `from`/`to` name the moment of each count; every figure of the day is the same. */
  const figures = ({ from: _from, to: _to, ...rest }) => rest;
  assert.deepEqual(figures(summary.stats), figures(own));
});
