import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { PAGE, advanceBoughtLedger, readBoughtLedger } from "./creator-split-history.server.ts";

const CREATOR = "Creator1111111111111111111111111111111111111";

/**
 * A token's chain: the curve's transactions and the pool's, each list the oldest first, every transaction a buy of 10 by
 * its trader unless said otherwise. The curve's first is the creation; the pool's first is the migration, which touches
 * the curve too. `keeps`: how many of the newest a node lists — a node with recent history only.
 */
function chain({ curve = 5, pool = 0 } = {}) {
  let slot = 100;
  const tx = (signature, trader, venue, over = {}) => ({ signature, slot: slot++, blockTime: slot, failed: false, trades: [{ trader, payer: trader, side: "buy", tokensRaw: "10", venue }], touchesCurve: venue === "curve", ...over });
  const lists = { curve: [], pool: [] };
  for (let index = 0; index < curve; index += 1) lists.curve.push(tx(index === 0 ? "creation" : `c${index}`, `W${index % 7}`, "curve"));
  if (pool > 0) {
    /* The migration: on both lists, no trade. */
    const migration = tx("migration", "-", "pool", { trades: [], touchesCurve: true });
    lists.curve.push(migration);
    lists.pool.push(migration);
    for (let index = 1; index < pool; index += 1) lists.pool.push(tx(`p${index}`, `W${index % 7}`, "pool"));
  }
  const all = () => [...lists.curve, ...lists.pool];
  const options = { keeps: Infinity, decodable: () => true, lagging: false };
  const deps = (store, over = {}) => ({
    store,
    cluster: "devnet",
    now: () => new Date(1_800_000_000_000),
    list: async (address, { before, until, limit }) => {
      const newestFirst = [...lists[address]].reverse().slice(0, options.keeps);
      const from = before ? newestFirst.findIndex((entry) => entry.signature === before) + 1 : 0;
      /* A lagging node does not know `until` and lists on past it. */
      const to = until && !options.lagging ? newestFirst.findIndex((entry) => entry.signature === until) : -1;
      return newestFirst.slice(from, to === -1 ? newestFirst.length : to).slice(0, limit).map(({ signature, slot: at, blockTime, failed }) => ({ signature, slot: at, blockTime, failed }));
    },
    decode: async (signature) => {
      const found = all().find((entry) => entry.signature === signature);
      return found && options.decodable(signature) ? found.trades : null;
    },
    migration: async () => (lists.pool.some((entry) => entry.signature === "migration") ? "migration" : null),
    ...over,
  });
  const facts = { token: "T", creator: CREATOR, curve: "curve", creationSignature: "creation", pool: pool > 0 ? "pool" : null };
  const add = (which, signature, trader) => lists[which].push(tx(signature, trader, which));
  return { lists, deps, facts, options, add };
}

const total = (ledger) => Object.values(ledger.bought).reduce((sum, raw) => sum + BigInt(raw), 0n);

test("a curve read to its creation is whole, every buy counted once however often it is read", async () => {
  const store = createMemoryGuardStore();
  const c = chain({ curve: 15 });
  const first = await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  assert.equal(first.complete, true);
  assert.equal(total(first.ledger), 150n);
  const again = await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  assert.equal(total(again.ledger), 150n);
});

test("a history longer than a page is read across requests, each from where the last one stopped", async () => {
  const store = createMemoryGuardStore();
  const c = chain({ curve: PAGE * 2 + 5 });
  let decoded = 0;
  c.options.decodable = () => decoded++ < 300;
  const part = await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  assert.equal(part.complete, false);
  assert.equal(total(part.ledger), 3_000n);
  c.options.decodable = () => true;
  const rest = await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  assert.equal(rest.complete, true);
  assert.equal(total(rest.ledger), BigInt(PAGE * 2 + 5) * 10n);
});

test("a node that keeps recent history only is never taken for the whole of it", async () => {
  const store = createMemoryGuardStore();
  const c = chain({ curve: 40, pool: 30 });
  c.options.keeps = 12;
  const { complete, ledger } = await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  assert.equal(complete, false);
  assert.equal(ledger.curve.reachedStart, false, "the creation is not on the list");
  assert.equal(ledger.pool.reachedStart, false, "the migration is not on the list");
});

test("the pool's start is the migration, however late it came; a transaction on both lists counts each venue's trade once", async () => {
  const store = createMemoryGuardStore();
  const c = chain({ curve: 6, pool: 9 });
  const read = await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  assert.equal(read.complete, true);
  assert.equal(total(read.ledger), 60n + 80n);
  const both = [
    { trader: "X", payer: "X", side: "buy", tokensRaw: "5", venue: "curve" },
    { trader: "X", payer: CREATOR, side: "buy", tokensRaw: "7", venue: "pool" },
  ];
  c.lists.curve.push({ signature: "both", slot: 900, blockTime: 900, failed: false, trades: both, touchesCurve: true });
  c.lists.pool.push({ signature: "both", slot: 900, blockTime: 900, failed: false, trades: both, touchesCurve: true });
  const next = await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  assert.equal(next.ledger.bought.X, "12");
  assert.deepEqual(next.ledger.creatorPaid, ["X"]);
});

test("what landed since is read as a gap that goes on across requests, and closes into the newest", async () => {
  const store = createMemoryGuardStore();
  const c = chain({ curve: 4 });
  await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  for (let index = 0; index < PAGE + 50; index += 1) c.add("curve", `n${index}`, "NEW");
  let decoded = 0;
  c.options.decodable = () => decoded++ < 400;
  const part = await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  assert.equal(part.complete, false);
  assert.ok(part.ledger.curve.gap, "the gap is kept with its cursor");
  /* More lands while the gap is open: above its top, it is the next gap's. */
  for (let index = 0; index < 20; index += 1) c.add("curve", `m${index}`, "LATER");
  c.options.decodable = () => true;
  const rest = await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  assert.equal(rest.ledger.bought.NEW, String((PAGE + 50) * 10));
  const last = await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  assert.equal(last.complete, true);
  assert.equal(last.ledger.bought.LATER, "200");
  assert.equal(total(last.ledger), 40n + BigInt(PAGE + 50) * 10n + 200n, "nothing twice");
});

test("a node that does not know the newest yet is stopped at its slot, never counting old history again", async () => {
  const store = createMemoryGuardStore();
  const c = chain({ curve: 8 });
  await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  c.add("curve", "late1", "L");
  c.options.lagging = true;
  const read = await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  assert.equal(total(read.ledger), 80n + 10n);
});

test("two instances reading at once count each transaction once", async () => {
  const store = createMemoryGuardStore();
  const c = chain({ curve: 30 });
  await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  for (let index = 0; index < 40; index += 1) c.add("curve", `x${index}`, "W");
  /* Every decode yields, so the two reads interleave step by step. */
  const slow = () =>
    c.deps(store, {
      decode: async (signature) => {
        await new Promise((resolve) => setImmediate(resolve));
        return c.lists.curve.find((entry) => entry.signature === signature)?.trades ?? null;
      },
    });
  await Promise.all([advanceBoughtLedger(slow(), c.facts, 10_000), advanceBoughtLedger(slow(), c.facts, 10_000)]);
  const final = await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  assert.equal(final.complete, true);
  assert.equal(total(final.ledger), 300n + 400n, "the race costs nothing and counts nothing twice");
  assert.equal((await readBoughtLedger(store, "devnet", "T")).curve.newest, "x39");
});

test("two instances back-filling from nothing at once count each transaction once", async () => {
  const store = createMemoryGuardStore();
  const c = chain({ curve: PAGE + 120, pool: 40 });
  const slow = () =>
    c.deps(store, {
      decode: async (signature) => {
        await new Promise((resolve) => setImmediate(resolve));
        return [...c.lists.curve, ...c.lists.pool].find((entry) => entry.signature === signature)?.trades ?? null;
      },
    });
  await Promise.all([advanceBoughtLedger(slow(), c.facts, 10_000), advanceBoughtLedger(slow(), c.facts, 10_000), advanceBoughtLedger(slow(), c.facts, 10_000)]);
  const final = await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  assert.equal(final.complete, true);
  assert.equal(total(final.ledger), BigInt(PAGE + 120) * 10n + 39n * 10n);
});

test("a node that does not know the gap's cursor answers nothing, and the gap waits — never closed over a hole", async () => {
  const store = createMemoryGuardStore();
  const c = chain({ curve: 4 });
  await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  c.add("curve", "s1", "A");
  c.add("curve", "s2", "A");
  c.add("curve", "s3", "B");
  /* s2 cannot be read in this request: the gap opens with s3 counted, its cursor on s3. */
  c.options.decodable = (signature) => signature !== "s2";
  const opened = await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  assert.ok(opened.ledger.curve.gap);
  assert.equal(opened.ledger.curve.gap.cursor, "s3");
  c.options.decodable = () => true;
  /* The next node does not know the cursor: an empty page. */
  const blind = c.deps(store, { list: async () => [] });
  const blindRead = await advanceBoughtLedger(blind, c.facts, 10_000);
  assert.equal(blindRead.complete, false);
  assert.ok(blindRead.ledger.curve.gap, "the gap stays open");
  const whole = await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  assert.equal(whole.complete, true);
  assert.equal(whole.ledger.bought.A, "20", "s1 and s2 counted, nothing skipped");
});

test("anything naming the pool's address before the migration does not keep the pool from its start", async () => {
  const store = createMemoryGuardStore();
  const c = chain({ curve: 6, pool: 9 });
  /* A lamport sent to the pool's address before the migration: the oldest entry of its list, no trade, no migration. */
  c.lists.pool.unshift({ signature: "dust", slot: 50, blockTime: 50, failed: false, trades: [], touchesCurve: false });
  const read = await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  assert.equal(read.complete, true);
  assert.equal(total(read.ledger), 60n + 80n);
});

test("a migration sent with a swap on the new pool is still the pool's start, and a page cut below it does not lose it", async () => {
  const store = createMemoryGuardStore();
  const c = chain({ curve: 6, pool: 6 });
  /* The migration carries a sniper's buy; dust older than it names the pool's address. */
  const migration = c.lists.pool[0];
  migration.trades = [{ trader: "SNIPER", payer: "SNIPER", side: "buy", tokensRaw: "9", venue: "pool" }];
  c.lists.pool.unshift({ signature: "dust", slot: 50, blockTime: 50, failed: false, trades: [], touchesCurve: false });
  /* The dust cannot be read on the first pass: the pool's page is cut right after the migration. */
  c.options.decodable = (signature) => signature !== "dust";
  const first = await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  assert.equal(first.ledger.pool.reachedStart, true, "the counted part holds the migration");
  assert.equal(first.complete, true);
  assert.equal(first.ledger.bought.SNIPER, "9");
});

test("a pool whose migration is not found yet waits, and starts once it is", async () => {
  const store = createMemoryGuardStore();
  const c = chain({ curve: 6, pool: 4 });
  const unknown = await advanceBoughtLedger(c.deps(store, { migration: async () => null }), c.facts, 10_000);
  assert.equal(unknown.complete, false);
  const known = await advanceBoughtLedger(c.deps(store), c.facts, 10_000);
  assert.equal(known.complete, true);
  assert.equal(known.ledger.pool.start, "migration");
});
