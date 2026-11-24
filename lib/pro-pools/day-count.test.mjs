import assert from "node:assert/strict";
import test from "node:test";

/*
 * The day of a pool counted where the rows are, and the kinds told by flags, not by reading JSON.
 *
 * The rule everywhere: a person sees the same numbers either way. The day counted by the store (`ProStore.day`, the
 * database's `pro_pool_day`) equals the day the server counts from the records (`summaryOf`), field for field; the
 * filled orders the store picks (`ProStore.fills`) give the same answer as the newest transactions with orders; and
 * before the migration — a store without the new functions — everything goes the old way.
 *
 * The tests over a real database run where `./fixtures/database.mjs` can make one, and are skipped elsewhere.
 */

const { createMemoryProStore, dayStartOf, sidesIn, summaryOf, summaryOfCount, countOf, ProStoreUnavailable } = await import("./store.ts");
const { createSupabaseProStore, missingFunction, MISSING_MS, tallyOfRow } = await import("./supabase-store.ts");
const { indexerStep, INDEXER_LIMITS } = await import("./indexer.server.ts");
const { tapeAnswer } = await import("./answers.server.ts");
const { fillsAnswerOf, statsOf, tallyOf, EMPTY_TALLY } = await import("./tape.ts");
const { recordsOf, storedOf } = await import("./fixtures/records.mjs");
const { chain, rowOf, addressOf } = await import("./fixtures/synthetic.mjs");
const { proPoolsDatabase, noDatabase } = await import("./fixtures/database.mjs");

const MAINNET = "mainnet";
const NOW = Date.parse("2026-11-23T12:00:00.000Z");
const NOW_S = Math.floor(NOW / 1000);

/** A pool as the tape needs it: a coin against SOL, priced, its fee in token Y or in the output coin. */
const tapePoolOf = (address, collectedIn = "tokenY") => ({
  address,
  x: { mint: "X", symbol: "X", decimals: 6, usd: 0.5 },
  y: { mint: "Y", symbol: "SOL", decimals: 9, usd: 140 },
  coin: "x",
  collectedIn,
});

async function oldSummary(store, pool, input, now, kept = INDEXER_LIMITS.kept) {
  const since = dayStartOf(now);
  const day = await store.recent(MAINNET, pool.address, { kind: "any", since, limit: kept, tries: 3 });
  const sides = sidesIn(day.txs);
  if (day.txs.some((tx) => tx.collects.some((collect) => !sides.has(collect.order)))) {
    const orders = await store.recent(MAINNET, pool.address, { kind: "orders", since: null, limit: kept, tries: 3 });
    for (const [order, side] of sidesIn(orders.txs)) if (!sides.has(order)) sides.set(order, side);
  }
  return summaryOf(pool, { txs: day.txs, sides, pending: day.pending, refused: day.refused, truncated: day.txs.length >= kept, ...input }, now);
}

/** The day counted the new way: by the store. */
async function newSummary(store, pool, input, now) {
  const count = await store.day(MAINNET, pool.address, { since: dayStartOf(now), tries: 3, collectedIn: pool.collectedIn });
  assert.ok(count, "the store counts");
  return summaryOfCount(pool, count, input, now);
}

/** The filled orders the old way: the newest thousand transactions with orders. */
async function oldFills(store, pool, limit, now) {
  const { txs } = await store.recent(MAINNET, pool.address, { kind: "orders", since: null, limit: 1000, tries: 3 });
  return fillsAnswerOf({ pool, depth: DEPTH, txs, sides: sidesIn(txs) }, MAINNET, now, limit);
}

async function newFills(store, pool, limit, now) {
  const picked = await store.fills(MAINNET, pool.address, { collectedIn: pool.collectedIn, limit });
  assert.ok(picked, "the store picks");
  return fillsAnswerOf({ pool, depth: DEPTH, txs: picked.txs, sides: picked.sides }, MAINNET, now, limit);
}

const DEPTH = { from: null, checked: null, transactions: 0, whole: true, stop: "window" };

const CURSORS = [
  { cursor: { head: "h", tail: "t", tailTime: NOW_S - 30 * 3600, end: false }, checkedAt: NOW - 5_000, newest: null },
  { cursor: { head: "h", tail: "t", tailTime: NOW_S - 3 * 3600, end: false }, checkedAt: NOW - 5_000, newest: NOW_S + 10 },
  { cursor: { head: "h", tail: "t", tailTime: null, end: true }, checkedAt: null, newest: NOW_S - 100 },
];

async function seed(store, address, txs) {
  assert.equal(await store.take(MAINNET, "holder-seed", 600, 0), true);
  for (let at = 0; at < txs.length; at += 2000) assert.equal(await store.putTxs(MAINNET, "holder-seed", txs.slice(at, at + 2000), []), true);
  await store.free(MAINNET, "holder-seed");
}

/* ── the server alone ────────────────────────────────────────────────────────────────────────────────────────────── */

test("a tally then the numbers is the numbers: statsOf over records equals statsOfTally over their tally", () => {
  for (const seedNo of [1, 2, 3, 4, 5]) {
    for (const collectedIn of ["tokenY", "output"]) {
      const pool = tapePoolOf(addressOf(`T${seedNo}`), collectedIn);
      const txs = recordsOf(pool.address, { seed: seedNo, count: 150, nowS: NOW_S });
      const sides = sidesIn(txs);
      for (const depth of [{ ...DEPTH }, { ...DEPTH, whole: false, stop: "budget", from: new Date((NOW_S - 6 * 3600) * 1000).toISOString() }, { ...DEPTH, whole: false, stop: "budget", from: null }]) {
        const view = { pool, depth, txs, sides };
        const stats = statsOf(view, NOW);
        assert.ok(stats.trades.count >= 0);
        /* The summary the old way and the summary from the count must be one. */
        for (const input of CURSORS) {
          const inDay = txs.filter((tx) => tx.moment.blockTime === null || tx.moment.blockTime >= dayStartOf(NOW));
          const old = summaryOf(pool, { txs: inDay, sides, pending: 2, refused: 1, truncated: false, ...input }, NOW);
          const count = { ...countOf(inDay, sides, pool), pending: 2, refused: 1, truncated: false };
          assert.deepEqual(summaryOfCount(pool, count, input, NOW), old, `seed ${seedNo} ${collectedIn}`);
        }
      }
    }
  }
  assert.deepEqual(tallyOf([], new Map(), tapePoolOf("P")), EMPTY_TALLY);
});

test("the store in memory counts the day as the old way does, and picks the filled orders the old way finds", async () => {
  for (const seedNo of [11, 12, 13, 14]) {
    for (const collectedIn of ["tokenY", "output"]) {
      const pool = tapePoolOf(addressOf(`M${seedNo}`), collectedIn);
      const records = recordsOf(pool.address, { seed: seedNo, count: 400, nowS: NOW_S });
      const store = createMemoryProStore(() => NOW);
      await seed(store, pool.address, storedOf(pool.address, records, { seed: seedNo }));
      for (const input of CURSORS) assert.deepEqual(await newSummary(store, pool, input, NOW), await oldSummary(store, pool, input, NOW), `seed ${seedNo} ${collectedIn}`);
      for (const limit of [1, 5, 50, 100]) assert.deepEqual(await newFills(store, pool, limit, NOW), await oldFills(store, pool, limit, NOW), `fills ${limit}`);
    }
  }
});

test("the indexer over a store that counts and over one that cannot yet writes the same day", async () => {
  const run = async (v1) => {
    const store = createMemoryProStore(() => NOW, { v1 });
    const node = chain();
    const rows = ["BUSY", "QUIET"].map(rowOf);
    node.land("BUSY", NOW_S - 30 * 3600);
    for (let minute = 40; minute >= 1; minute -= 1) node.land("BUSY", NOW_S - minute * 60);
    node.land("QUIET", NOW_S - 48 * 3600);
    const limits = { ...INDEXER_LIMITS, gapS: 0, readsPerStep: 25 };
    const summaries = [];
    for (let turn = 0; turn < 3; turn += 1) {
      const report = await indexerStep({ network: MAINNET, store, source: node.source, pools: async () => rows, limits, clock: () => NOW });
      assert.equal(report.ran, true);
      summaries.push([...(await store.states(MAINNET)).pools.values()].map((state) => [state.pool, state.summary]));
    }
    return summaries;
  };
  const [counted, old] = [await run(false), await run(true)];
  assert.deepEqual(counted, old);
  assert.equal(counted.at(-1)[0][1].stats.volume.usd, 4000, "the forty trades of the day, a hundred dollars each");
});

test("a store whose day fails is a store away: the step stops as before, nothing half-counted is written", async () => {
  const inner = createMemoryProStore(() => NOW);
  const store = { ...inner, day: async () => { throw new ProStoreUnavailable("pro_pool_day: temporarily unavailable"); } };
  const node = chain();
  node.land("BUSY", NOW_S - 60);
  const report = await indexerStep({ network: MAINNET, store, source: node.source, pools: async () => [rowOf("BUSY")], limits: { ...INDEXER_LIMITS, gapS: 0 }, clock: () => NOW });
  assert.deepEqual([report.ran, report.reason], [false, "store"]);
  assert.equal((await inner.states(MAINNET)).pools.size, 0);
});

test("the database's adapter: a function it does not know yet is null and left alone a while; one it knows is read whole or refused", async () => {
  let now = NOW;
  const asked = [];
  let answers = {};
  const store = createSupabaseProStore(async (fn, args) => {
    asked.push([fn, args]);
    return answers[fn] ?? { ok: false, error: `Could not find the function public.${fn}(p_collected_in, p_network, p_pool) in the schema cache` };
  }, () => now);
  assert.equal(await store.day(MAINNET, "P", { since: 100, tries: 3, collectedIn: "tokenY" }), null);
  assert.equal(await store.fills(MAINNET, "P", { collectedIn: "output", limit: 5 }), null);
  assert.equal(await store.day(MAINNET, "P", { since: 100, tries: 3, collectedIn: "tokenY" }), null);
  assert.deepEqual(asked.map(([fn]) => fn), ["pro_pool_day", "pro_pool_fills"], "not asked again inside the while");
  assert.deepEqual(asked[0][1], { p_network: MAINNET, p_pool: "P", p_since: "1970-01-01T00:01:40.000Z", p_tries: 3, p_collected_in: "tokenY" });
  assert.deepEqual(asked[1][1], { p_network: MAINNET, p_pool: "P", p_collected_in: "output", p_limit: 5 });

  const tally = { ...EMPTY_TALLY, trades: 2, buys: 1, sells: 1, wallets: 2, coinRaw: "123456789012345678901234", priceFirst: 1.5, priceLast: null };
  answers = {
    pro_pool_day: { ok: true, data: { ok: true, transactions: 3, created: false, oldest: 1_000, newest: null, pending: 1, refused: 0, tally } },
    pro_pool_fills: { ok: true, data: { ok: true, txs: [{ moment: { signature: "s", slot: 1, blockTime: 2 }, trades: [], placed: [], collects: [], created: false }, { junk: true }], sides: { A: "ask", B: "bid", C: "up" } } },
  };
  now += MISSING_MS;
  assert.deepEqual(await store.day(MAINNET, "P", { since: 100, tries: 3, collectedIn: "tokenY" }), { transactions: 3, created: false, oldest: 1_000, newest: null, pending: 1, refused: 0, truncated: false, tally });
  const fills = await store.fills(MAINNET, "P", { collectedIn: "output", limit: 5 });
  assert.equal(fills.txs.length, 1);
  assert.deepEqual([...fills.sides], [["A", "ask"], ["B", "bid"]]);

  for (const broken of [{ ok: false, error: "temporarily unavailable" }, { ok: true, data: { ok: false, error: "bad_request" } }, { ok: true, data: { ok: true, transactions: 1 } }, { ok: true, data: { ok: true, transactions: 1, created: false, oldest: null, newest: null, pending: 0, refused: 0, tally: { ...tally, coinRaw: 5 } } }]) {
    answers.pro_pool_day = broken;
    await assert.rejects(store.day(MAINNET, "P", { since: 100, tries: 3, collectedIn: "tokenY" }), ProStoreUnavailable);
  }
  assert.equal(tallyOfRow({ ...tally, priceLast: "1" }), null, "a price that is not a number is no tally");
  for (const said of ["Could not find the function public.pro_pool_day(p_network) in the schema cache", "PGRST202", "function public.pro_pool_day(p_secret => unknown, p_network => unknown) does not exist"]) assert.equal(missingFunction(said), true, said);
  for (const said of ["temporarily unavailable", "forbidden", "canceling statement due to statement timeout"]) assert.equal(missingFunction(said), false, said);
});

test("a pool's filled orders: as the store picks them where it can, the newest transactions with orders where it cannot", async () => {
  const pool = tapePoolOf(addressOf("F1"), "output");
  const records = recordsOf(pool.address, { seed: 21, count: 300, nowS: NOW_S });
  const row = { address: pool.address, x: { ...pool.x, name: null, icon: null, verified: null }, y: { ...pool.y, name: null, icon: null, verified: true }, fee: { collectedIn: "output" } };
  const answers = [];
  for (const v1 of [false, true]) {
    const store = createMemoryProStore(() => NOW, { v1 });
    await seed(store, pool.address, storedOf(pool.address, records, { seed: 21, unread: 0, lost: 0 }));
    const inDay = records.filter((tx) => tx.moment.blockTime === null || tx.moment.blockTime >= dayStartOf(NOW));
    const summary = summaryOf(pool, { txs: inDay, sides: sidesIn(records), pending: 0, refused: 0, truncated: false, cursor: CURSORS[0].cursor, checkedAt: NOW, newest: null }, NOW);
    assert.equal(await store.take(MAINNET, "h-1", 600, 0), true);
    await store.putStates(MAINNET, "h-1", [{ pool: pool.address, summary, cursor: CURSORS[0].cursor, checkedAt: NOW, fails: 0, failedAt: null }]);
    await store.free(MAINNET, "h-1");
    let recentAsked = 0;
    const counting = { ...store, recent: async (...args) => ((recentAsked += 1), store.recent(...args)) };
    const answer = await tapeAnswer({ network: MAINNET, store: counting, row, kind: "fills", limit: 7, now: NOW, memory: async () => assert.fail("the store answers") });
    assert.equal(answer.from, "store");
    assert.equal(recentAsked, v1 ? 1 : 0, v1 ? "the old way reads the newest orders" : "the store picks; no records of orders are read");
    answers.push(answer.body);
  }
  assert.ok(answers[0].fills.length > 0, "the made-up pool has filled orders");
  assert.deepEqual(answers[0], answers[1]);
});

/* ── the database itself ─────────────────────────────────────────────────────────────────────────────────────────── */

test("the migration applied on top of v1: the same answers, the day counted in the database equals the day counted here", { skip: noDatabase, timeout: 180_000 }, async () => {
  const db = await proPoolsDatabase(["v1"]);
  try {
    const store = createSupabaseProStore(db.rpc());
    const nowS = Math.floor(Date.now() / 1000);
    const pools = [tapePoolOf(addressOf("D1"), "tokenY"), tapePoolOf(addressOf("D2"), "output"), tapePoolOf(addressOf("D3"), "output")];
    const seeds = [31, 32, 33];
    for (const [at, pool] of pools.entries()) await seed(store, pool.address, storedOf(pool.address, recordsOf(pool.address, { seed: seeds[at], count: 900, nowS }), { seed: seeds[at] }));

    /* Before: what v1 answers, and the day the old way. */
    const queries = [
      { kind: "any", since: null, limit: 5000, tries: 3 },
      { kind: "any", since: nowS - 24 * 3600, limit: 5000, tries: 3 },
      { kind: "trades", since: null, limit: 50, tries: 3 },
      { kind: "trades", since: nowS - 3600, limit: 5000, tries: 2 },
      { kind: "orders", since: null, limit: 1000, tries: 3 },
      { kind: "orders", since: nowS - 24 * 3600, limit: 7, tries: 3 },
    ];
    const now = Date.now();
    const before = [];
    for (const pool of pools) {
      for (const query of queries) before.push(await store.recent(MAINNET, pool.address, query));
      for (const input of CURSORS) before.push(await oldSummary(store, pool, input, now));
      for (const limit of [1, 5, 100]) before.push(await oldFills(store, pool, limit, now));
    }
    assert.equal(await store.day(MAINNET, pools[0].address, { since: nowS, tries: 3, collectedIn: "tokenY" }), null, "before the migration the store cannot count: the old way");

    await db.apply("v2");
    const fresh = createSupabaseProStore(db.rpc());
    const after = [];
    let at = 0;
    for (const pool of pools) {
      for (const query of queries) after.push(await fresh.recent(MAINNET, pool.address, query));
      for (const input of CURSORS) {
        const summary = await newSummary(fresh, pool, input, now);
        assert.deepEqual(summary, before[at + queries.length + CURSORS.indexOf(input)], `the day of ${pool.address.slice(0, 6)}`);
        after.push(summary);
      }
      for (const limit of [1, 5, 100]) after.push(await newFills(fresh, pool, limit, now));
      at += queries.length + CURSORS.length + 3;
    }
    assert.deepEqual(after, before, "every answer as before");
    assert.ok(before.some((answer) => answer?.stats?.orders && answer.stats.orders.filled + answer.stats.orders.partial > 0), "the made-up pools have filled orders to count");

    /* The flags are the records' own, and the kinds find their rows through their indexes. */
    const flags = await db.query(`
      select count(*) filter (where has_trade is distinct from (records is not null and jsonb_array_length(records->'trades') > 0))::int as trade_wrong,
             count(*) filter (where has_order is distinct from (records is not null and (jsonb_array_length(records->'placed') > 0 or jsonb_array_length(records->'collects') > 0)))::int as order_wrong,
             count(*) filter (where has_trade)::int as trades, count(*) filter (where has_order)::int as orders
        from private.pro_pool_txs`);
    assert.deepEqual([flags[0].trade_wrong, flags[0].order_wrong], [0, 0]);
    assert.ok(flags[0].trades > 0 && flags[0].orders > 0);
    /* A row written after the migration gets its flags too. */
    assert.equal(await fresh.take(MAINNET, "holder-late", 60, 0), true);
    const late = recordsOf(pools[0].address, { seed: 99, count: 1, nowS, share: { trade: 0, placed: 1, collect: 0 }, firstSlot: 9_000_000 })[0];
    await fresh.putTxs(MAINNET, "holder-late", [{ pool: pools[0].address, signature: late.moment.signature, slot: late.moment.slot, blockTime: late.moment.blockTime, state: "read", misses: 0, records: late }], []);
    const [lateRow] = await db.query(`select has_trade, has_order from private.pro_pool_txs where signature = $1`, [late.moment.signature]);
    assert.deepEqual(lateRow, { has_trade: false, has_order: true });

    /* No secret, no answer; a strange argument, a refusal. */
    await assert.rejects(createSupabaseProStore(db.rpc("not-the-secret")).day(MAINNET, pools[0].address, { since: nowS, tries: 3, collectedIn: "tokenY" }), ProStoreUnavailable);
    await assert.rejects(fresh.day(MAINNET, pools[0].address, { since: nowS, tries: 3, collectedIn: "input" }), ProStoreUnavailable);
    await assert.rejects(fresh.fills(MAINNET, pools[0].address, { collectedIn: null, limit: 5 }), ProStoreUnavailable);
  } finally {
    await db.close();
  }
});

test("the migration's own rules: one transaction, nothing dropped, helpers no role can call, every function asks for the secret", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../../supabase/migrations/20261123120000_pro_pools_flags_v2.sql", import.meta.url), "utf8");
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  assert.match(sql, /Not applied to any Supabase project/);
  const code = sql.replace(/^\s*--.*$/gm, "");
  assert.doesNotMatch(code, /^\s*(drop|truncate|delete|update|insert|create table|create policy|copy|grant all)\s/im, "nothing dropped, no row written, no table made");
  assert.match(code, /set local lock_timeout = '10s';/);
  assert.deepEqual([...code.matchAll(/^\s*add column (\w+) boolean not null generated always as/gim)].map((m) => m[1]), ["has_trade", "has_order"]);
  assert.deepEqual([...code.matchAll(/^create index (\w+) on private\.pro_pool_txs .* where (.+);$/gm)].map((m) => [m[1], m[2]]), [["pro_pool_txs_trades_idx", "has_trade"], ["pro_pool_txs_orders_idx", "has_order"], ["pro_pool_txs_pending_idx", "state <> 'read'"], ["pro_pool_txs_day_idx", "state = 'read'"]]);
  const publicFns = [...code.matchAll(/create (?:or replace )?function public\.(pro_pool_\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(publicFns, ["pro_pool_txs_recent", "pro_pool_day", "pro_pool_fills"]);
  assert.deepEqual([...code.matchAll(/create or replace function (\S+)\(/g)].map((m) => m[1]), ["public.pro_pool_txs_recent"], "only v1's reader is replaced, with its own arguments");
  for (const body of code.split(/create (?:or replace )?function public\./).slice(1)) {
    assert.match(body, /security definer/);
    assert.match(body, /set search_path = ''/);
    assert.match(body, /set jit = off/, "a plan this size is not worth compiling: JIT alone cost half a second a call");
    assert.match(body, /perform private\.beta_check_secret\(p_secret\);/);
    assert.doesNotMatch(body.split("$$")[1], /\bexecute\b|format\(/i, "no statement is built from what is passed in");
  }
  for (const fn of publicFns) {
    assert.match(code, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`), fn);
    assert.match(code, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to anon;`), fn);
  }
  for (const helper of ["pro_pool_list", "pro_pool_fill_state"]) {
    assert.match(code, new RegExp(`create function private\\.${helper}\\(`));
    assert.match(code, new RegExp(`revoke all on function private\\.${helper}\\([^)]*\\) from public, anon, authenticated, service_role;`));
    assert.doesNotMatch(code, new RegExp(`grant execute on function private\\.${helper}`));
  }
  assert.deepEqual([...new Set([...code.matchAll(/(?:from|into|update|join)\s+((?:private|public)\.\w+)/g)].map((m) => m[1]))].sort(), ["private.pro_pool_txs"], "it reads one table");
  /* The adapter calls the new functions, and the old reader stays its fallback. */
  const adapter = readFileSync(new URL("./supabase-store.ts", import.meta.url), "utf8");
  assert.deepEqual([...adapter.matchAll(/callNew\("(pro_pool_\w+)"/g)].map((m) => m[1]).sort(), ["pro_pool_day", "pro_pool_fills"]);
});
