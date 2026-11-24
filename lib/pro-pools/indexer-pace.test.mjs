import assert from "node:assert/strict";
import test from "node:test";

/*
 * The indexer spends the node's key on the pools that trade: a pool that traded within the hour is listed every step,
 * a quieter one every ten minutes, one with nothing in a day every half an hour — a new pool and one not counted yet at
 * once. And no pool stands «counting» behind other pools' backlogs: its newest transactions are read ahead of them, and
 * a node that refuses them ends the pool «unknown» after a few steps. One line a step says what the step cost.
 */

const { indexerStep, listDue, stepLine, INDEXER_LIMITS } = await import("./indexer.server.ts");
const { createMemoryProStore, summaryOf } = await import("./store.ts");
const { dayEntryOf } = await import("./answers.server.ts");
const { chain, rowOf, addressOf } = await import("./fixtures/synthetic.mjs");

const T0 = Date.parse("2026-11-20T12:00:00.000Z");
const S0 = T0 / 1000;
const HOUR = 3_600;
const MIN = 60_000;
const MAINNET = "mainnet";

function stand(names, limits = {}) {
  let now = T0;
  const clock = () => now;
  const store = createMemoryProStore(clock);
  const node = chain(() => now / 1000);
  const rows = names.map(rowOf);
  const step = () => indexerStep({ network: MAINNET, store, source: node.source, pools: async () => rows, limits: { ...INDEXER_LIMITS, ...limits }, clock });
  const stateOf = async (name) => (await store.states(MAINNET)).pools.get(addressOf(name));
  const dayOf = async (name) => dayEntryOf(addressOf(name), await stateOf(name));
  return { store, node, rows, step, stateOf, dayOf, clock, move: (ms) => (now += ms) };
}

/** The steps, of `turns` a minute apart, in which the node was asked for a list. */
async function listedIn(stand, turns) {
  const at = [];
  for (let turn = 0; turn < turns; turn += 1) {
    const before = stand.node.calls.list;
    const report = await stand.step();
    assert.equal(report.ran, true);
    assert.equal(report.lists, stand.node.calls.list - before, "the report counts the calls");
    if (report.lists > 0) at.push(turn);
    stand.move(MIN);
  }
  return at;
}

test("a pool that traded within the hour is listed every step; a quieter one every ten minutes; one with nothing in a day every half an hour", async () => {
  const active = stand(["A"]);
  active.node.land("A", S0 - 30 * HOUR);
  active.node.land("A", S0 - 20 * 60);
  assert.deepEqual(await listedIn(active, 12), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

  const quiet = stand(["Q"]);
  quiet.node.land("Q", S0 - 30 * HOUR);
  quiet.node.land("Q", S0 - 5 * HOUR);
  assert.deepEqual(await listedIn(quiet, 35), [0, 10, 20, 30], "traded today, not within the hour");

  const idle = stand(["I"]);
  idle.node.land("I", S0 - 30 * HOUR);
  assert.deepEqual(await listedIn(idle, 65), [0, 30, 60], "nothing in a day");
});

test("a pool that goes quiet slows down an hour after its last trade, and one that trades again is every step from the list that sees it", async () => {
  const pool = stand(["A"]);
  pool.node.land("A", S0 - 30 * HOUR);
  pool.node.land("A", S0 - 55 * 60);
  /* Every step while its last trade is within the hour — five steps — then every ten minutes. */
  assert.deepEqual(await listedIn(pool, 30), [0, 1, 2, 3, 4, 14, 24]);
  /* A trade lands at the 31st minute: the list of the 34th sees it, and the pool is listed every step again. */
  pool.node.land("A", S0 + 31 * 60);
  assert.deepEqual(await listedIn(pool, 10), [4, 5, 6, 7, 8, 9]);
  assert.equal((await pool.stateOf("A")).summary.stats.trades.count, 2, "both of the day's trades are counted; the freshness of an active pool is a step, as before");
});

test("a new pool is listed at once, and so is one that started over, until its day is whole again", async () => {
  const pools = stand(["OLD"], { page: 4, bridgePages: 2 });
  pools.node.land("OLD", S0 - 30 * HOUR);
  await pools.step();
  pools.move(MIN);
  /* A pool appears in the list: its first step lists it, whatever the others' pace. */
  pools.rows.push(rowOf("NEW"));
  pools.node.land("NEW", S0 - 30 * HOUR);
  pools.node.land("NEW", S0 - 2 * HOUR);
  const before = pools.node.calls.list;
  await pools.step();
  assert.equal(pools.node.calls.list - before, 1, "the new pool alone");
  assert.deepEqual([(await pools.dayOf("NEW")).state, (await pools.stateOf("NEW")).summary.stats.volume.usd], ["ready", 100]);

  /* Twenty transactions land at once in the new pool — more than a step may join: it starts over, and is listed every step until whole. */
  pools.move(10 * MIN);
  for (let at = 20; at >= 1; at -= 1) pools.node.land("NEW", pools.clock() / 1000 - 3 * 3_600 + at);
  for (let at = 20; at >= 1; at -= 1) pools.node.land("NEW", pools.clock() / 1000 - at);
  const turns = await listedIn(pools, 8);
  assert.deepEqual(turns.slice(0, 5), [0, 1, 2, 3, 4], "no waiting between the steps that list its older pages");
  const state = await pools.stateOf("NEW");
  assert.deepEqual([state.summary.depth.whole, state.summary.stats.trades.count], [true, 41]);
});

test("the pace is read from the pool's own row", () => {
  const limits = INDEXER_LIMITS;
  const whole = { from: null, checked: null, transactions: 0, whole: true, stop: "window" };
  const row = (over = {}, summary = {}) => ({ cursor: { head: "h", tail: "t", tailTime: 1, end: true }, checkedAt: T0, fails: 0, failedAt: null, summary: { at: "", depth: whole, stats: {}, newest: S0 - 2 * HOUR, ...summary }, ...over });
  assert.equal(listDue(undefined, T0, limits), true, "no row: a new pool");
  assert.equal(listDue(row({ cursor: { head: null, tail: null, tailTime: null, end: false } }), T0, limits), true, "never listed");
  assert.equal(listDue(row({ summary: null }), T0 + MIN, limits), true, "not counted yet");
  assert.equal(listDue(row({ summary: null, fails: 3, failedAt: T0 }), T0 + 9 * MIN, limits), false, "the node keeps refusing it: asked again every ten minutes");
  assert.equal(listDue(row({ summary: null, fails: 3, failedAt: T0 }), T0 + 10 * MIN, limits), true);
  assert.equal(listDue(row({}, { depth: { ...whole, whole: false, stop: "budget" } }), T0 + MIN, limits), true, "its day is still open");
  assert.equal(listDue(row({}, { depth: { ...whole, whole: false, stop: "node" } }), T0 + MIN, limits), false, "open only because the node refuses what is left: a list would bring nothing");
  assert.equal(listDue(row({}, { newest: undefined }), T0 + MIN, limits), true, "counted before the pace was kept");
  assert.equal(listDue(row({}, { newest: S0 - 59 * 60 }), T0, limits), true, "traded within the hour");
  assert.equal(listDue(row(), T0 + 9 * MIN, limits), false);
  assert.equal(listDue(row(), T0 + 10 * MIN, limits), true);
  assert.equal(listDue(row({}, { newest: null }), T0 + 29 * MIN, limits), false, "nothing known of it in a day");
  assert.equal(listDue(row({}, { newest: S0 - 30 * HOUR }), T0 + 30 * MIN, limits), true);
  assert.equal(listDue(row({ checkedAt: T0 - 20 * MIN, failedAt: T0 }), T0 + 9 * MIN, limits), false, "the interval runs from the last time the node was asked, answered or not");
});

/** A seeded draw, so the day is the same every run. */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test("a day of sixty-four pools as they trade now costs under twenty-five thousand lists — it was ninety-two thousand", async () => {
  /*
   * The pools as the live answer showed them on 20.11.2026: two busy ones, a few with tens or hundreds of
   * transactions a day, a few with a handful, and fifty with none. Transactions land at moments drawn at random
   * over the day. The four busiest stand here with a few hundred a day each instead of their thousands: a pool is
   * listed every step from a few transactions an hour on, so more of them changes the reads, not the lists.
   */
  const perDay = [400, 300, 250, 200, 40, 40, 35, 35, 30, 10, 6, 5, 1, 1];
  const names = Array.from({ length: 64 }, (_, at) => `P${at}`);
  const model = stand(names, { recount: 30 * MIN });
  const draw = seeded(20261120);
  const day = [];
  names.forEach((name, at) => {
    day.push({ name, at: S0 - 3 * 86_400 });
    /* Two days of it: the day before the steps begin, and the day lived through. */
    for (let tx = 0; tx < 2 * (perDay[at] ?? 0); tx += 1) day.push({ name, at: S0 - 86_400 + Math.floor(draw() * 2 * 86_400) });
  });
  day.sort((a, b) => a.at - b.at).forEach((tx) => model.node.land(tx.name, tx.at));

  /* The first steps fill the store with the day before; then a day is lived through, a step a minute. */
  for (let turn = 0; turn < 40; turn += 1) {
    await model.step();
    model.move(MIN);
  }
  const before = model.node.calls.list;
  let reads = 0;
  for (let turn = 0; turn < 1_440; turn += 1) {
    const report = await model.step();
    assert.equal(report.ran, true);
    reads += report.read + report.lost;
    model.move(MIN);
  }
  const lists = model.node.calls.list - before;
  assert.ok(lists <= 25_000, `${lists} lists in the day`);
  assert.ok(lists >= 1_440 * 4, "the busy pools are still listed every step");
  assert.equal(64 * 1_440, 92_160, "what every pool every step cost");
  /* Nothing is lost to the pace: every transaction that landed in the day is read by its end, each once. */
  const landed = day.filter((tx) => tx.at > S0 + 40 * 60 && tx.at <= model.clock() / 1000 - 30 * 60).length;
  assert.ok(reads >= landed, `${reads} reads for ${landed} transactions`);
  const busy = await model.stateOf("P0");
  assert.equal(busy.summary.depth.whole, true);
  /* 15 154 on 20.11.2026 with this draw: a sixth of what it was. */
  assert.ok(lists >= 12_000 && lists <= 18_000, `${lists} lists in the day`);
});

test("a pool whose only transaction is the day's oldest is not left «counting» behind the others' backlog", async () => {
  /* As on 20.11.2026: the store gives what is unread newest first, a window of it; a busy pool's backlog fills the window. */
  const pools = stand(["BUSY", "LONE"], { pending: 5, readsPerStep: 4 });
  pools.node.land("LONE", S0 - 23 * HOUR);
  pools.node.land("BUSY", S0 - 30 * HOUR);
  for (let at = 60; at >= 1; at -= 1) pools.node.land("BUSY", S0 - at * 60);

  await pools.step();
  const lone = await pools.dayOf("LONE");
  assert.deepEqual([lone.state, lone.stats.trades.count, lone.stats.volume.usd], ["ready", 1, 100], "read in its first step, ahead of the backlog");
  assert.equal((await pools.dayOf("BUSY")).state, "ready", "and the busy pool has its floor");
  assert.ok(pools.node.calls.events <= 4, "within the step's budget");

  /* Every pool not counted yet has its share before any backlog: sixty-four new pools are all counted in two steps. */
  const many = stand(Array.from({ length: 64 }, (_, at) => `N${at}`));
  for (const row of many.rows) for (let at = 30; at >= 1; at -= 1) many.node.land(row.x.symbol, S0 - at * 60);
  for (let turn = 0; turn < 2; turn += 1) {
    await many.step();
    many.move(MIN);
  }
  const states = await Promise.all(many.rows.map((row) => many.dayOf(row.x.symbol)));
  assert.deepEqual([...new Set(states.map((day) => day.state))], ["ready"]);
});

test("a pool with nothing in a day is ready with zeros; a pool the node refuses is «unknown» after three steps, never «counting» for good", async () => {
  const pools = stand(["EMPTY", "REFUSED", "UNLISTED"]);
  pools.node.land("EMPTY", S0 - 40 * HOUR);
  pools.node.land("REFUSED", S0 - 23 * HOUR);
  pools.node.land("UNLISTED", S0 - HOUR);
  pools.node.faults.lost = (_signature, label) => label === "REFUSED1";
  pools.node.faults.list = (address) => address === addressOf("UNLISTED");

  const seen = [];
  for (let turn = 0; turn < 4; turn += 1) {
    await pools.step();
    seen.push([(await pools.dayOf("EMPTY")).state, (await pools.dayOf("REFUSED")).state, (await pools.dayOf("UNLISTED")).state]);
    pools.move(MIN);
  }
  assert.deepEqual(seen, [
    ["ready", "counting", "counting"],
    ["ready", "counting", "counting"],
    ["ready", "unknown", "unknown"],
    ["ready", "unknown", "unknown"],
  ]);
  const empty = await pools.dayOf("EMPTY");
  assert.deepEqual([empty.stats.volume.usd, empty.stats.trades.count, empty.depth.whole], [0, 0, true]);

  /* «Unknown» is asked again every ten minutes, not every step; the node back, both are counted. */
  const lists = pools.node.calls.list;
  for (let turn = 0; turn < 5; turn += 1) {
    await pools.step();
    pools.move(MIN);
  }
  assert.equal(pools.node.calls.list, lists, "five steps, no list of the refused pools");
  pools.node.faults.lost = () => false;
  pools.node.faults.list = () => false;
  pools.move(10 * MIN);
  for (let turn = 0; turn < 3; turn += 1) {
    await pools.step();
    pools.move(MIN);
  }
  assert.deepEqual([(await pools.dayOf("REFUSED")).state, (await pools.dayOf("UNLISTED")).state], ["ready", "ready"]);
  assert.deepEqual([(await pools.stateOf("REFUSED")).fails, (await pools.stateOf("UNLISTED")).fails], [0, 0]);
});

test("a list that ended with nothing landed in the day is an empty day, not a day still counting", () => {
  const pool = { address: "P", x: { mint: "x", symbol: "X", decimals: 6, usd: 1 }, y: { mint: "y", symbol: "Y", decimals: 9, usd: 1 }, coin: "x", collectedIn: "tokenY" };
  const input = { txs: [], sides: new Map(), pending: 0, refused: 0, truncated: false, checkedAt: T0 };
  const ended = summaryOf(pool, { ...input, cursor: { head: "h", tail: "t", tailTime: S0 - HOUR, end: true } }, T0);
  assert.deepEqual([ended.depth.whole, ended.depth.stop, ended.stats.trades.count, ended.newest], [false, "node", 0, null]);
  assert.equal(summaryOf(pool, { ...input, cursor: { head: "h", tail: "t", tailTime: S0 - HOUR, end: false } }, T0), null, "older pages are still to list");
  assert.equal(summaryOf(pool, { ...input, pending: 1, cursor: { head: "h", tail: "t", tailTime: S0 - HOUR, end: true } }, T0), null, "a transaction is still to read");
});

test("a step is one line of the log: that it ran, how long, what it asked of the node — and nothing that names a pool", async () => {
  const pools = stand(["A"]);
  pools.node.land("A", S0 - 30 * HOUR);
  pools.node.land("A", S0 - HOUR);
  const [ran, busy] = await Promise.all([pools.step(), pools.step()]);
  const line = stepLine(MAINNET, ran);
  assert.match(line, /^pro-pools step ran network=mainnet lease=taken ms=\d+ pools=1 lists=1 unlisted=0 listed=2 reads=2 lost=0 counted=1 purged=0$/);
  assert.equal(stepLine(MAINNET, busy), "pro-pools step skipped:lease network=mainnet lease=no ms=0 pools=0 lists=0 unlisted=0 listed=0 reads=0 lost=0 counted=0 purged=0");
  assert.equal(line.includes(addressOf("A")), false);
  assert.equal(line.includes("\n"), false);
});
