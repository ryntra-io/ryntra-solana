import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

/*
 * The migration itself, run: the file applied to a local PGlite database, and the paper week's start, passes,
 * race and close run over its own functions through the store's adapter — the code the deployment runs, only the
 * transport is local.
 *
 * PGlite is deliberately not a dependency of the repository (as `lib/pro-pools/sql-store.test.mjs`): the test runs where
 * `RYNTRA_PGLITE_DIR` names a folder whose `node_modules` holds `@electric-sql/pglite`, and is skipped elsewhere. It
 * never touches a real database.
 */

const dir = process.env.RYNTRA_PGLITE_DIR ? resolve(process.env.RYNTRA_PGLITE_DIR) : null;
const entry = dir ? join(dir, "node_modules", "@electric-sql", "pglite", "dist", "index.js") : null;
const skip = entry && existsSync(entry) ? false : "RYNTRA_PGLITE_DIR does not name a folder with @electric-sql/pglite";

const SECRET = "local-secret";

async function database() {
  const { PGlite } = await import(pathToFileURL(entry).href);
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema private;
    create function private.beta_check_secret(p_secret text) returns void language plpgsql as $$
    begin if p_secret is distinct from '${SECRET}' then raise exception 'forbidden'; end if; end $$;
  `);
  await db.exec(readFileSync(new URL("../../../supabase/migrations/20261120190100_agent_paper_week_v1.sql", import.meta.url), "utf8"));
  /* The server's transport as PostgREST does it: named arguments, JSON in and out, a raised exception as a refusal. */
  const rpc = (secret) => async (fn, args) => {
    const all = { p_secret: secret, ...args };
    const names = Object.keys(all);
    try {
      const result = await db.query(`select public.${fn}(${names.map((name, at) => `${name} => $${at + 1}`).join(", ")}) as r`, names.map((name) => (all[name] !== null && typeof all[name] === "object" ? JSON.stringify(all[name]) : all[name])));
      return { ok: true, data: result.rows[0].r };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  };
  return { db, rpc };
}

test("the migration applied: a paper week starts, trades, loses a race, goes live and is gone after its keep", { skip }, async () => {
  const { createSupabasePaperStore } = await import("./supabase-store.ts");
  const { PaperStoreUnavailable } = await import("./store.ts");
  const { closePaper, paperIdOf, readPaper, runPaperPass, startPaper } = await import("./service.server.ts");

  const { db, rpc } = await database();
  const store = createSupabasePaperStore(rpc(SECRET));
  await assert.rejects(createSupabasePaperStore(rpc("not-the-secret")).get("0".repeat(64)), PaperStoreUnavailable, "without the secret nothing answers");

  const T0 = Date.UTC(2026, 10, 20, 12);
  let now = T0;
  const reads = {
    buy: async (lamports) => (lamports * 1_000_000n) / 2_000_000n,
    worth: async (coins) => (coins * 2_000_000n) / 1_000_000n,
    fees: async () => ({ buyBps: 10, sellBps: 10 }),
  };
  const deps = { store, reads: () => reads, now: () => now };
  const KEY = "k".repeat(43);
  const input = { key: KEY, coin: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", plan: "steady", perDay: "100000000", perTrade: "20000000", days: 30, who: "a".repeat(64) };

  const started = await startPaper(input, deps);
  assert.equal(started.ok, true);
  assert.equal(started.view.trades, 1);
  assert.equal((await startPaper(input, deps)).already, true, "one week at a time for a key");

  now = T0 + 5 * 3_600_000;
  assert.deepEqual((await runPaperPass(deps)).map((line) => line.did), ["bought"]);
  assert.equal((await readPaper(KEY, deps)).view.trades, 2);

  /* A write over an old version is refused by the database itself. */
  const row = await store.get(paperIdOf(KEY));
  assert.equal(await store.put(row.agent, row.version - 1), null);

  /* The full row in the table: the hash, never the key; paper only. */
  const raw = await db.query("select id, status, doc->>'kind' as kind, doc::text as doc from private.agent_paper_weeks");
  assert.equal(raw.rows.length, 1);
  assert.match(raw.rows[0].id, /^[0-9a-f]{64}$/u);
  assert.equal(raw.rows[0].kind, "paper");
  assert.ok(!raw.rows[0].doc.includes(KEY), "the key never reaches the database");

  now = T0 + 6 * 3_600_000;
  const live = await closePaper(KEY, "live", deps);
  assert.equal(live.view.status, "live");
  assert.equal((await store.due("mainnet", 10)).length, 0, "a week taken live is no longer at work");

  /* The database refuses a document that is not a paper agent, or another id's. */
  const bad = await rpc(SECRET)("agent_paper_put", { p_id: row.agent.id, p_network: "mainnet", p_status: "working", p_doc: { ...row.agent, kind: "mandate" }, p_version: 1 });
  assert.equal(bad.data.ok, false);
  await assert.rejects(db.query("insert into private.agent_paper_weeks (id, network, status, doc, version, started_at, updated_at) values ($1, 'mainnet', 'working', '{\"id\":\"x\",\"status\":\"working\",\"kind\":\"paper\"}', 1, now(), now())", ["a".repeat(64)]));

  /* Kept 90 days after its last change, then gone; a week at work is never purged. */
  await db.query("update private.agent_paper_weeks set updated_at = now() - interval '100 days'");
  assert.equal(await store.purge(90), 1);
  assert.equal((await readPaper(KEY, deps)).view, null);
});

test("the migration applied: starts admitted by the ledger under the network's lock — per caller, for everyone, and the store's places", { skip }, async () => {
  const { createSupabasePaperStore } = await import("./supabase-store.ts");
  const { PAPER_STARTS } = await import("./store.ts");
  const { startPaper } = await import("./service.server.ts");
  const { db, rpc } = await database();
  const store = createSupabasePaperStore(rpc(SECRET));
  const WHO = "a".repeat(64);
  const OTHER = "b".repeat(64);

  /* The very figures the server's memory store mirrors. */
  for (let at = 0; at < PAPER_STARTS.perHour; at += 1) assert.equal(await store.admit(WHO, "mainnet", 2_000), "ok");
  assert.equal(await store.admit(WHO, "mainnet", 2_000), "limited", "three an hour for one caller");
  assert.equal(await store.admit(OTHER, "mainnet", 2_000), "ok", "another caller is not held by this one");
  /* An hour later: the day's count still holds. */
  await db.query("update private.agent_paper_starts set at = at - interval '61 minutes'");
  for (let at = 0; at < PAPER_STARTS.perDay - PAPER_STARTS.perHour; at += 1) {
    if (at === PAPER_STARTS.perHour) await db.query("update private.agent_paper_starts set at = at - interval '61 minutes'");
    assert.equal(await store.admit(WHO, "mainnet", 2_000), "ok");
  }
  assert.equal(await store.admit(WHO, "mainnet", 2_000), "limited", "eight a day");
  /* After a day the ledger has forgotten: the admission sweeps it. */
  await db.query("update private.agent_paper_starts set at = at - interval '25 hours'");
  assert.equal(await store.admit(WHO, "mainnet", 2_000), "ok");
  assert.equal((await db.query("select count(*)::int as n from private.agent_paper_starts")).rows[0].n, 1, "rows older than a day are gone");
  /* Everyone's hour. */
  await db.query("insert into private.agent_paper_starts (who, network, at) select lpad(to_hex(g), 64, '0'), 'mainnet', now() from generate_series(1, 239) g");
  assert.equal(await store.admit(OTHER, "mainnet", 2_000), "busy", "240 an hour for everyone — not this wallet's doing");
  await db.query("delete from private.agent_paper_starts");

  /* The store's places: a start into the last place is admitted once; the next is told the store is full. */
  const reads = { buy: async (l) => l / 2n, worth: async (c) => c * 2n, fees: async () => ({ buyBps: 10, sellBps: 10 }) };
  const deps = { store, reads: () => reads, now: () => Date.UTC(2026, 10, 21, 12) };
  const input = { coin: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", plan: "steady", perDay: "100000000", perTrade: "20000000", days: 30 };
  assert.equal((await startPaper({ ...input, key: "k".repeat(43), who: WHO }, deps)).ok, true);
  assert.equal(await store.admit(OTHER, "mainnet", 1), "full");
  assert.equal(await store.start({ ...(await store.get((await import("./service.server.ts")).paperIdOf("k".repeat(43)))).agent, id: "c".repeat(64) }, 1), "full", "the start counts again under the lock");

  /* Without the secret the ledger answers nothing; a caller that is not an HMAC is refused. */
  assert.equal((await rpc("not-the-secret")("agent_paper_admit", { p_network: "mainnet", p_who: WHO, p_limit: 10 })).ok, false);
  assert.equal((await rpc(SECRET)("agent_paper_admit", { p_network: "mainnet", p_who: "203.0.113.7", p_limit: 10 })).data.ok, false);
  await assert.rejects(db.query("insert into private.agent_paper_starts (who, network, at) values ('203.0.113.7', 'mainnet', now())"), "only an HMAC is ever stored");
});
