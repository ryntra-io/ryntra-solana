import assert from "node:assert/strict";
import test from "node:test";

/*
 * The migrations themselves, run: the files applied to a throwaway database (`./fixtures/database.mjs` — a Postgres
 * server of one's own named by `RYNTRA_PRO_POOLS_PG`, or PGlite where `RYNTRA_PGLITE_DIR` names a folder whose
 * `node_modules` holds `@electric-sql/pglite`), and the indexer and the answers run over their own functions through
 * the store's adapter — the same code the deployment runs, only the transport is local. Once with v1 alone (the
 * server's old way: the day counted from the records), once with v2 on top (the day counted in the database). Skipped
 * where no database can be made; it never touches a real one.
 */

const { proPoolsDatabase, noDatabase: skip, SECRET } = await import("./fixtures/database.mjs");

const MAINNET = "mainnet";

for (const migrations of [["v1"], ["v1", "v2"]]) test(`the migrations ${migrations.join(" + ")} applied: the indexer and the answers over the database's own functions`, { skip }, async () => {
  const { indexerStep, INDEXER_LIMITS } = await import("./indexer.server.ts");
  const { daysAnswer, tapeAnswer } = await import("./answers.server.ts");
  const { createSupabaseProStore } = await import("./supabase-store.ts");
  const { ProStoreUnavailable } = await import("./store.ts");
  const tape = await import("./tape.ts");
  const { chain, rowOf, addressOf } = await import("./fixtures/synthetic.mjs");

  const db = await proPoolsDatabase(migrations);
  try {
  const { rpc } = db;
  const store = createSupabaseProStore(rpc(SECRET));
  await assert.rejects(createSupabaseProStore(rpc("not-the-secret")).states(MAINNET), ProStoreUnavailable, "without the secret nothing answers");

  /* The database keeps its own clock, so the node's transactions land around now. */
  const nowS = Math.floor(Date.now() / 1000);
  const node = chain();
  const rows = ["BUSY", "QUIET"].map(rowOf);
  node.land("BUSY", nowS - 30 * 3600);
  for (let minute = 40; minute >= 1; minute -= 1) node.land("BUSY", nowS - minute * 60);
  node.land("QUIET", nowS - 48 * 3600);
  /* No gap between steps here: the test does not wait a minute. */
  const limits = { ...INDEXER_LIMITS, gapS: 0, readsPerStep: 25 };
  const step = () => indexerStep({ network: MAINNET, store, source: node.source, pools: async () => rows, limits });
  const memory = { days: async () => assert.fail("the store answers"), view: async () => assert.fail("the store answers") };
  const usd = async () => (await store.states(MAINNET)).pools.get(addressOf("BUSY"))?.summary?.stats.volume.usd ?? null;

  /* Before any step the store is there and empty: memory would answer, and a step is asked for. */
  const before = await daysAnswer({ network: MAINNET, store, pools: async () => rows, memory: async (asked) => ({ answer: { network: MAINNET, at: new Date().toISOString(), fresh: 300, days: asked.map((row) => ({ pool: row.address, state: "counting", at: null })) }, refresh: null }) });
  assert.deepEqual([before.from, before.step], ["memory", true]);

  /* Two steps at once: one runs. Then step by step the number only grows, to the whole day. */
  const [one, two] = await Promise.all([step(), step()]);
  assert.deepEqual([one.ran, two.ran].sort(), [false, true]);
  assert.equal([one, two].find((report) => !report.ran).reason, "lease");
  const seen = [await usd()];
  assert.equal(seen[0], 2500, "twenty-five read of the day's forty: a floor");
  node.land("BUSY", nowS - 5);
  for (let turn = 0; turn < 3; turn += 1) {
    const report = await step();
    assert.equal(report.ran, true);
    seen.push(await usd());
  }
  for (let at = 1; at < seen.length; at += 1) assert.ok(seen[at] >= seen[at - 1], `the number fell: ${seen.join(", ")}`);
  assert.equal(seen.at(-1), 4100);
  assert.equal(node.calls.events, 43, "each transaction read from the node once: forty-one of the day, and one before it for each pool's page");
  const idle = await step();
  assert.deepEqual([idle.ran, idle.listed, idle.read, idle.purged], [true, 0, 0, 0], "a step with nothing new reads and lets go of nothing");

  /* The table and the page read one row. */
  const days = await daysAnswer({ network: MAINNET, store, pools: async () => rows, memory: memory.days });
  assert.equal(days.from, "store");
  assert.ok(tape.isProDaysAnswer(days.answer));
  const [busy, quiet] = days.answer.days;
  assert.deepEqual([busy.state, busy.stats.volume.usd, busy.stats.trades.count, busy.depth.whole, busy.depth.stop], ["ready", 4100, 41, true, "window"]);
  assert.deepEqual([quiet.state, quiet.stats.volume.usd, quiet.depth.whole], ["ready", 0, true]);
  const page = await tapeAnswer({ network: MAINNET, store, row: rows[0], kind: "stats", limit: 50, memory: memory.view });
  assert.ok(tape.isProStatsAnswer(page.body));
  assert.deepEqual(page.body.stats, busy.stats);
  const trades = await tapeAnswer({ network: MAINNET, store, row: rows[0], kind: "trades", limit: 5, memory: memory.view });
  assert.ok(tape.isProTradesAnswer(trades.body));
  assert.deepEqual(trades.body.trades.map((trade) => node.labelOf(trade.signature)), ["BUSY42", "BUSY41", "BUSY40", "BUSY39", "BUSY38"]);
  const fills = await tapeAnswer({ network: MAINNET, store, row: rows[0], kind: "fills", limit: 5, memory: memory.view });
  assert.deepEqual([fills.from, fills.body.fills], ["store", []]);

  /* Rows as the database holds them: every one read, with its records; nothing else of the schema was written to. */
  const kept = await db.query(`select state, count(*)::int as n, bool_and(records is not null and read_at is not null) as full from private.pro_pool_txs group by state`);
  assert.deepEqual(kept, [{ state: "read", n: 43, full: true }]);
  const pools = await db.query(`select pool, summary is not null as counted, fails, lease_holder from private.pro_pool_state order by pool = 'lease', pool`);
  assert.deepEqual(pools.map((row) => [row.pool === "lease" ? "lease" : "pool", row.counted, row.fails, row.lease_holder]), [["pool", true, 0, null], ["pool", true, 0, null], ["lease", false, 0, null]]);

  /* Three days on, the broom: the day's rows go, the last hundred of a pool stay only up to `tapeMin`. */
  await db.exec(`update private.pro_pool_txs set block_time = block_time - interval '4 days', seen_at = seen_at - interval '4 days'`);
  const swept = await indexerStep({ network: MAINNET, store, source: node.source, pools: async () => rows, limits: { ...limits, tapeMin: 3 } });
  assert.deepEqual([swept.ran, swept.purged], [true, 39]);
  const left = await db.query(`select count(*)::int as n from private.pro_pool_txs`);
  assert.equal(left[0].n, 4, "the newest three of the busy pool and the quiet pool's one");
  } finally {
    await db.close();
  }
});
