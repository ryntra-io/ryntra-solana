import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * The open reads of the DLMM Pro pools over the store: every pool's day and one pool's day, trades and filled orders
 * come from the rows the indexer wrote — the same row for the table and for the pool's page; where the store does not
 * answer, is not there yet or does not hold the pool, the instance's own memory answers as before, in the same shape.
 */

const { daysAnswer, tapeAnswer, dayEntryOf, ANSWER_LIMITS, ANSWER_CACHE } = await import("./answers.server.ts");
const { indexerStep, INDEXER_LIMITS } = await import("./indexer.server.ts");
const { createMemoryProStore, ProStoreUnavailable } = await import("./store.ts");
const { createSupabaseProStore } = await import("./supabase-store.ts");
const tape = await import("./tape.ts");
const { chain, rowOf, addressOf, word } = await import("./fixtures/synthetic.mjs");

const T0 = Date.parse("2026-11-20T12:00:00.000Z");
const S0 = T0 / 1000;
const HOUR = 3_600;
const MAINNET = "mainnet";
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

const whole = { from: null, checked: new Date(T0).toISOString(), transactions: 0, whole: true, stop: "window" };
/** The spare path of the tests: a day of the instance's own, marked so an answer shows where it came from. */
const memoryDays = async (rows) => ({ answer: { network: MAINNET, at: new Date(T0).toISOString(), fresh: 300, days: rows.map((row) => ({ pool: row.address, state: "counting", at: null })) }, refresh: null });
const memoryView = (row) => async () => ({ pool: tape.tapePoolOf(row), depth: whole, txs: [], sides: new Map() });
/** A store that does not answer: the database away, or its tables not there yet. */
const away = new Proxy({}, { get: () => async () => { throw new ProStoreUnavailable("pro_pool_states: Could not find the function"); } });

/** An order placed and, later, collected filled whole — as the venue's decoder gives the program's events. */
const order = word("order", 44);
const placeOf = (pool) => ({ name: "evtOpenLimitOrder", user: "maker", data: { pool, limitOrder: order, owner: "maker", isAskSide: true, actualTickLimitOrderAmount: [{ amount: "5000000" }], referral: "" } });
const collectOf = (pool) => ({ name: "evtCancelLimitOrder", user: "maker", data: { pool, limitOrder: order, owner: "maker", ownerAmountX: "0", ownerAmountY: "1000001000", ownerFeeX: "0", ownerFeeY: "1000", referralFee: "0", tickIds: [1] } });

/** Three pools indexed once: BUSY traded and filled an order today, QUIET did not, DOWN the node does not list. */
async function indexed() {
  let now = T0;
  const clock = () => now;
  const store = createMemoryProStore(clock);
  const node = chain();
  const rows = ["BUSY", "QUIET", "DOWN"].map(rowOf);
  node.land("BUSY", S0 - 30 * HOUR);
  node.land("BUSY", S0 - 5 * HOUR, [placeOf(addressOf("BUSY"))]);
  for (let hour = 4; hour >= 2; hour -= 1) node.land("BUSY", S0 - hour * HOUR);
  node.land("BUSY", S0 - HOUR, [collectOf(addressOf("BUSY"))]);
  node.land("QUIET", S0 - 48 * HOUR);
  node.land("DOWN", S0 - HOUR);
  node.faults.list = (address) => address === addressOf("DOWN");
  const step = () => indexerStep({ network: MAINNET, store, source: node.source, pools: async () => rows, limits: INDEXER_LIMITS, clock });
  return { store, node, rows, step, clock, move: (ms) => (now += ms) };
}

test("every pool's day is one read of the store: counted, still counting, or unknown after the node's refusals — in the answer's own shape", async () => {
  const { store, rows, step, clock, move } = await indexed();
  await step();
  const result = await daysAnswer({ network: MAINNET, store, pools: async () => rows, memory: memoryDays, now: clock() });
  assert.deepEqual([result.from, result.step, result.down, result.refresh], ["store", false, false, null]);
  assert.ok(tape.isProDaysAnswer(result.answer));
  assert.deepEqual([result.answer.network, result.answer.fresh], [MAINNET, 60]);
  const [busy, quiet, down] = result.answer.days;
  assert.deepEqual([busy.pool, busy.state, busy.stats.volume.usd, busy.stats.trades.count, busy.stats.orders.filled, busy.depth.whole], [addressOf("BUSY"), "ready", 300, 3, 1, true]);
  assert.deepEqual([quiet.state, quiet.stats.volume.usd, quiet.depth.whole], ["ready", 0, true]);
  assert.deepEqual(down, { pool: addressOf("DOWN"), state: "counting", at: null }, "a pool not counted is never zeros");

  for (let turn = 0; turn < 2; turn += 1) {
    move(60_000);
    await step();
  }
  const later = await daysAnswer({ network: MAINNET, store, pools: async () => rows, memory: memoryDays, now: clock() });
  assert.equal(later.answer.days[2].state, "unknown", "only after the node's refusals in a row");
  assert.ok(tape.isProDaysAnswer(later.answer));

  /* A pool listed that the indexer has no row of yet is «counting»; the chain not listing the pools leaves the store's own. */
  const more = await daysAnswer({ network: MAINNET, store, pools: async () => [...rows, rowOf("NEW")], memory: memoryDays, now: clock() });
  assert.deepEqual(more.answer.days[3], { pool: addressOf("NEW"), state: "counting", at: null });
  const unlisted = await daysAnswer({ network: MAINNET, store, pools: async () => { throw new Error("the chain is down"); }, memory: memoryDays, now: clock() });
  assert.deepEqual([unlisted.from, unlisted.answer.days.filter((day) => day.state === "ready").length], ["store", 2]);
});

test("the pools' table and the pool's own page say one number: the page's day is the same row", async () => {
  const { store, rows, step, clock } = await indexed();
  await step();
  const days = await daysAnswer({ network: MAINNET, store, pools: async () => rows, memory: memoryDays, now: clock() });
  const page = await tapeAnswer({ network: MAINNET, store, row: rows[0], kind: "stats", limit: 50, now: clock(), memory: memoryView(rows[0]) });
  assert.equal(page.from, "store");
  assert.ok(tape.isProStatsAnswer(page.body));
  assert.deepEqual(page.body.stats, days.answer.days[0].stats, "the same figures, to the last field");
  assert.deepEqual(page.body.depth, days.answer.days[0].depth);
  assert.deepEqual([page.body.pool, page.body.pair.coin.symbol, page.body.pair.quote.symbol], [addressOf("BUSY"), "BUSY", "SOL"]);

  /* Asked again and again — by any instance, for they keep nothing — the answer is the same until the indexer's next step. */
  const again = await tapeAnswer({ network: MAINNET, store, row: rows[0], kind: "stats", limit: 50, now: clock() + 5_000, memory: memoryView(rows[0]) });
  assert.deepEqual(again.body.stats, page.body.stats);
});

test("a pool's newest trades and filled orders come from its stored transactions, newest first", async () => {
  const { store, rows, step, clock, node } = await indexed();
  await step();
  const trades = await tapeAnswer({ network: MAINNET, store, row: rows[0], kind: "trades", limit: 3, now: clock(), memory: memoryView(rows[0]) });
  assert.equal(trades.from, "store");
  assert.ok(tape.isProTradesAnswer(trades.body));
  assert.deepEqual(trades.body.trades.map((trade) => node.labelOf(trade.signature)), ["BUSY5", "BUSY4", "BUSY3"], "the newest three; the one before the day is kept for the page too");
  assert.deepEqual([trades.body.trades[0].side, trades.body.trades[0].quoteAmount], ["buy", 1]);

  const fills = await tapeAnswer({ network: MAINNET, store, row: rows[0], kind: "fills", limit: 50, now: clock(), memory: memoryView(rows[0]) });
  assert.ok(tape.isProFillsAnswer(fills.body));
  assert.deepEqual(fills.body.fills.map((fill) => [fill.order, fill.side, fill.state, fill.proceedsRaw, fill.bonusYRaw]), [[order, "ask", "filled", "1000000000", "1000"]], "its side from its placing, hours before");
});

test("the store away, not there yet, or never filled: the instance's own memory answers, in the same shape, and nothing fails", async () => {
  const rows = ["BUSY", "QUIET"].map(rowOf);
  for (const [store, down] of [[away, true], [null, false]]) {
    const days = await daysAnswer({ network: MAINNET, store, pools: async () => rows, memory: memoryDays, now: T0 });
    assert.deepEqual([days.from, days.step, days.down, days.answer.fresh], ["memory", false, down, 300]);
    assert.ok(tape.isProDaysAnswer(days.answer));
    const page = await tapeAnswer({ network: MAINNET, store, row: rows[0], kind: "stats", limit: 50, now: T0, memory: memoryView(rows[0]) });
    assert.deepEqual([page.from, page.step, page.down], ["memory", false, down]);
    assert.ok(tape.isProStatsAnswer(page.body));
    for (const kind of ["trades", "fills"]) assert.equal((await tapeAnswer({ network: MAINNET, store, row: rows[0], kind, limit: 50, now: T0, memory: memoryView(rows[0]) })).from, "memory");
  }

  /* A store nobody has indexed into yet: memory answers, and a step is started behind the answer. */
  const empty = createMemoryProStore(() => T0);
  const first = await daysAnswer({ network: MAINNET, store: empty, pools: async () => rows, memory: memoryDays, now: T0 });
  assert.deepEqual([first.from, first.step, first.down], ["memory", true, false]);

  /* Neither answers: the route says UNAVAILABLE, never zeros. */
  assert.equal(await daysAnswer({ network: MAINNET, store: away, pools: async () => { throw new Error("down"); }, memory: memoryDays, now: T0 }), null);
  assert.equal(await tapeAnswer({ network: MAINNET, store: away, row: rows[0], kind: "stats", limit: 50, now: T0, memory: async () => { throw new Error("down"); } }), null);
});

test("a pool the indexer does not hold is read by the instance itself; so is a list the store fails to give", async () => {
  const { store, rows, step, clock, move } = await indexed();
  await step();
  const other = rowOf("OTHER");
  const page = await tapeAnswer({ network: MAINNET, store, row: other, kind: "stats", limit: 50, now: clock(), memory: memoryView(other) });
  assert.equal(page.from, "memory", "not among the pools indexed");
  const uncounted = await tapeAnswer({ network: MAINNET, store, row: rows[2], kind: "stats", limit: 50, now: clock(), memory: memoryView(rows[2]) });
  assert.equal(uncounted.from, "memory", "indexed, not counted yet");

  const failing = { ...store, recent: async () => { throw new ProStoreUnavailable("pro_pool_txs_recent: temporarily unavailable"); } };
  const trades = await tapeAnswer({ network: MAINNET, store: failing, row: rows[0], kind: "trades", limit: 50, now: clock(), memory: memoryView(rows[0]) });
  assert.deepEqual([trades.from, trades.down], ["memory", true]);

  /* A pool that left the indexed ones: its row is no longer written, and stops being answered from. */
  const kept = rows.slice(1);
  for (let turn = 0; turn < 12; turn += 1) {
    move(60_000);
    await indexerStep({ network: MAINNET, store, source: { list: async () => [], events: async () => null }, pools: async () => kept, limits: INDEXER_LIMITS, clock });
  }
  const left = await tapeAnswer({ network: MAINNET, store, row: rows[0], kind: "stats", limit: 50, now: clock(), memory: memoryView(rows[0]) });
  assert.equal(left.from, "memory");
});

test("an answer that sees the count grow old asks for a step — unless one runs", async () => {
  const { store, rows, step, clock, move } = await indexed();
  await step();
  const ask = () => daysAnswer({ network: MAINNET, store, pools: async () => rows, memory: memoryDays, now: clock() });
  move(ANSWER_LIMITS.staleMs - 1);
  assert.equal((await ask()).step, false);
  move(1);
  assert.equal((await ask()).step, true);
  assert.equal((await tapeAnswer({ network: MAINNET, store, row: rows[0], kind: "stats", limit: 50, now: clock(), memory: memoryView(rows[0]) })).step, true);
  assert.equal(await store.take(MAINNET, "another-step", 90, 0), true);
  assert.equal((await ask()).step, false, "a step is running");
});

test("a pool's entry: its row's summary, «counting» without one, «unknown» after the refusals", () => {
  assert.deepEqual(dayEntryOf("P", undefined), { pool: "P", state: "counting", at: null });
  assert.deepEqual(dayEntryOf("P", { summary: null, fails: 2 }), { pool: "P", state: "counting", at: null });
  assert.deepEqual(dayEntryOf("P", { summary: null, fails: 3 }), { pool: "P", state: "unknown", at: null });
  const summary = { at: "2026-11-20T12:00:00.000Z", depth: whole, stats: { volume: {}, fees: {} } };
  assert.deepEqual(dayEntryOf("P", { summary, fails: 5 }), { pool: "P", state: "ready", ...summary }, "a pool counted keeps its count through the node's refusals");
});

test("the database's store: one function per question, the secret the transport's; a refusal or a strange answer is the store away", async () => {
  const asked = [];
  const answers = {
    pro_pool_lease_take: { ok: true, taken: true },
    pro_pool_lease_free: { ok: true, freed: true },
    pro_pool_states: { ok: true, step: { running: false, startedAgo: 30_000, endedAgo: 20_000 }, pools: [{ pool: "P", summary: { at: "2026-11-20T12:00:00.000Z", depth: whole, stats: { volume: {}, fees: {}, trades: {}, orders: {} } }, head: "h", tail: "t", tailTime: 5, end: true, checkedAt: 7, fails: 0, failedAt: null, writtenAgo: 9 }, { pool: "Q", summary: { at: 1 }, head: null, tail: null, tailTime: null, end: false, checkedAt: null, fails: 2, failedAt: 3, writtenAgo: 4 }, "junk"] },
    pro_pool_txs_put: { ok: true, written: true, rows: 1 },
    pro_pool_state_put: { ok: true, written: false },
    pro_pool_txs_recent: { ok: true, txs: [{ moment: { signature: "s", slot: 1, blockTime: 2 }, trades: [], placed: [], collects: [], created: false }, { junk: true }], pending: 2, refused: 1 },
    pro_pool_txs_unread: { ok: true, txs: [{ pool: "P", signature: "s", slot: 1, blockTime: null, state: "lost", misses: 2, lostAt: 5 }, { pool: "P", state: "read" }] },
    pro_pool_purge: { ok: true, purged: true, txs: 4, pools: 0 },
  };
  const store = createSupabaseProStore(async (fn, args) => {
    asked.push([fn, args]);
    return { ok: true, data: answers[fn] };
  });
  assert.equal(await store.take(MAINNET, "holder-1", 90, 50), true);
  await store.free(MAINNET, "holder-1");
  const states = await store.states(MAINNET);
  assert.deepEqual(states.step, { running: false, startedAgo: 30_000, endedAgo: 20_000 });
  assert.deepEqual([...states.pools.keys()], ["P", "Q"]);
  assert.deepEqual(states.pools.get("P").cursor, { head: "h", tail: "t", tailTime: 5, end: true });
  assert.equal(states.pools.get("Q").summary, null, "a summary that is not one is none");
  assert.equal(await store.putTxs(MAINNET, "holder-1", [{ pool: "P", signature: "s", slot: 1, blockTime: 2, state: "unread", misses: 0, records: null }], []), true);
  assert.equal(await store.putStates(MAINNET, "holder-1", [{ pool: "P", summary: null, cursor: { head: "h", tail: "t", tailTime: 5, end: false }, checkedAt: 7, fails: 0, failedAt: null }]), false, "the lease is another's");
  const recent = await store.recent(MAINNET, "P", { kind: "trades", since: 100, limit: 10, tries: 3 });
  assert.deepEqual([recent.txs.length, recent.pending, recent.refused], [1, 2, 1]);
  assert.deepEqual(await store.unread(MAINNET, 5), [{ pool: "P", signature: "s", slot: 1, blockTime: null, state: "lost", misses: 2, lostAt: 5 }]);
  assert.equal(await store.purge(MAINNET, "holder-1", 3, 100), 4);

  assert.deepEqual(asked.map(([fn]) => fn), ["pro_pool_lease_take", "pro_pool_lease_free", "pro_pool_states", "pro_pool_txs_put", "pro_pool_state_put", "pro_pool_txs_recent", "pro_pool_txs_unread", "pro_pool_purge"]);
  assert.ok(asked.every(([, args]) => args.p_network === MAINNET && !("p_secret" in args)), "the network always; the secret is the transport's to add");
  assert.deepEqual(asked[0][1], { p_network: MAINNET, p_holder: "holder-1", p_ttl_seconds: 90, p_gap_seconds: 50 });
  assert.deepEqual(asked[3][1].p_reset, null);
  assert.deepEqual(asked[4][1].p_states, [{ pool: "P", summary: null, head: "h", tail: "t", tailTime: 5, end: false, checkedAt: 7, fails: 0, failedAt: null }]);
  assert.deepEqual(asked[5][1], { p_network: MAINNET, p_pool: "P", p_kind: "trades", p_since: "1970-01-01T00:01:40.000Z", p_limit: 10, p_tries: 3 });

  for (const rpc of [async () => ({ ok: false, error: "Could not find the function public.pro_pool_states" }), async () => ({ ok: true, data: null }), async () => ({ ok: true, data: { ok: false, error: "bad_request" } }), async () => ({ ok: true, data: { ok: true } })]) {
    await assert.rejects(createSupabaseProStore(rpc).states(MAINNET), ProStoreUnavailable);
  }
});

test("the routes read the store and keep every answer fifteen seconds; the cron runs the step each minute behind its bearer", () => {
  assert.deepEqual(ANSWER_CACHE, { fresh: 15, stale: 30 });
  const days = read("app/api/pro/pools/days/route.ts");
  assert.match(days, /daysAnswer\(\{/);
  assert.match(days, /publicCacheHeaders\(ANSWER_CACHE\.fresh, ANSWER_CACHE\.stale\)/);
  assert.match(days, /if \(result\?\.step\) after\(\(\) => runProPoolsStep\(network\)/);
  const one = read("lib/pro-pools/tape-route.server.ts");
  assert.match(one, /tapeAnswer\(\{/);
  assert.match(one, /publicCacheHeaders\(ANSWER_CACHE\.fresh, ANSWER_CACHE\.stale\)/);
  assert.match(one, /if \(answer\?\.step\) after\(\(\) => runProPoolsStep\(network\)/);
  const cron = read("app/api/cron/pro-pools/route.ts");
  assert.match(cron, /decideBearerAuth/);
  assert.match(cron, /process\.env\.CRON_SECRET/);
  assert.match(cron, /if \(!gate\.open\) return/);
  const crons = JSON.parse(read("vercel.json")).crons;
  assert.ok(crons.some((row) => row.path === "/api/cron/pro-pools" && row.schedule === "* * * * *"));
  /* The platform's cache is out of the way of reading, and nothing on this path signs, sends or reads a key. */
  for (const file of ["lib/pro-pools/tape.server.ts", "lib/pro-pools/days.server.ts", "lib/pro-pools/indexer.server.ts", "lib/pro-pools/answers.server.ts", "lib/pro-pools/store.server.ts", "lib/pro-pools/store.ts", "lib/pro-pools/supabase-store.ts", "app/api/cron/pro-pools/route.ts"]) {
    const source = read(file);
    assert.doesNotMatch(source, /unstable_cache|shared\.server/, file);
    assert.doesNotMatch(source, /signTransaction|sendTransaction|sendRawTransaction|Keypair|secretKey|privateKey/, file);
  }
});

test("the migration: a file only, one transaction, two private tables under forced row security, every function asks for the secret", () => {
  const sql = read("supabase/migrations/20261120150000_pro_pools_store_v1.sql");
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  assert.match(sql, /Not applied to any Supabase project/);
  const code = sql.replace(/^\s*--.*$/gm, "");
  assert.deepEqual([...code.matchAll(/create table (\S+)/g)].map((m) => m[1]), ["private.pro_pool_txs", "private.pro_pool_state"], "exactly two tables");
  for (const table of ["pro_pool_txs", "pro_pool_state"]) {
    assert.match(code, new RegExp(`alter table private\\.${table} enable row level security;`));
    assert.match(code, new RegExp(`alter table private\\.${table} force row level security;`));
    assert.match(code, new RegExp(`revoke all privileges on table private\\.${table} from public, anon, authenticated, service_role;`));
  }
  /* Nothing that exists is touched: no drop, no truncate, no alter but row security, no policy, no replaced function, no rows. */
  assert.doesNotMatch(code, /^\s*(drop|truncate|create policy|create or replace|copy)\s/im);
  assert.deepEqual([...code.matchAll(/^\s*alter\s+(.+)$/gim)].map((m) => m[1].replace(/private\.pro_pool_(txs|state) /, "")), ["table enable row level security;", "table force row level security;", "table enable row level security;", "table force row level security;"]);
  assert.deepEqual([...code.matchAll(/^create index \S+ on (\S+)/gm)].map((m) => m[1]), ["private.pro_pool_txs", "private.pro_pool_txs"]);
  /* A statement begins at the line's start; inside the functions everything is indented. */
  const statements = [...code.matchAll(/^([a-z]+(?: [a-z]+)?)/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(statements)].sort(), ["alter table", "as", "begin", "commit", "create function", "create index", "create table", "declare", "end", "grant execute", "language plpgsql", "returns jsonb", "revoke all", "security definer", "set search"]);
  const fns = [...code.matchAll(/create function public\.(pro_pool_\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(fns, ["pro_pool_lease_take", "pro_pool_lease_free", "pro_pool_states", "pro_pool_txs_put", "pro_pool_state_put", "pro_pool_txs_recent", "pro_pool_txs_unread", "pro_pool_purge"]);
  assert.equal([...code.matchAll(/create function /g)].length, fns.length, "no function outside public.pro_pool_*");
  for (const body of code.split(/create function public\./).slice(1)) {
    assert.match(body, /security definer/);
    assert.match(body, /set search_path = ''/);
    assert.match(body, /perform private\.beta_check_secret\(p_secret\);/);
    assert.doesNotMatch(body.split("$$")[1], /\bexecute\b|format\(/i, "no statement is built from what is passed in");
  }
  for (const fn of fns) {
    assert.match(code, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`), fn);
    assert.match(code, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to anon;`), fn);
  }
  /* The functions touch these two tables and no other. */
  assert.deepEqual([...new Set([...code.matchAll(/(?:from|into|update|join)\s+((?:private|public)\.\w+)/g)].map((m) => m[1]))].sort(), ["private.pro_pool_state", "private.pro_pool_txs"]);
  /* Every function the store calls is in the file, and nothing else is. */
  const adapter = read("lib/pro-pools/supabase-store.ts");
  assert.deepEqual([...new Set([...adapter.matchAll(/call\("(pro_pool_\w+)"/g)].map((m) => m[1]))].sort(), [...fns].sort());
});
