// Run from repo root: node --test city/lib/arena/hack/runs/sql.test.mjs
/*
 * CITY-238: the runs' migration, read as text — one transaction, not applied by this repository, a number no other
 * migration has, standing on `hack_v1`; the table private with row level security forced, no policy and no grant;
 * every server function secret-gated with an empty search path and granted to anon alone; a start takes the order's
 * lock and the day's lock before it writes; the lists are the library's. And the wiring: every function the database
 * store calls exists with exactly the arguments it sends. Its behaviour is checked against a real database in
 * `runs.test.mjs` when HACK_TEST_DATABASE_URL is set.
 */
import "../../../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const { createSupabaseRunStore } = await import("./supabase.ts");
const { RUN_ATTEMPTS, OWNER_SHARE_OF_CAP } = await import("./contract.ts");
const { HACK_ROLES } = await import("../store/contract.ts");

const FILE = "20261110120000_hack_v2_runs.sql";
const migrations = new URL("../../../../../supabase/migrations/", import.meta.url);
const sql = readFileSync(new URL(FILE, migrations), "utf8");
const code = sql.replace(/^\s*--.*$/gm, "");
const bodyOf = (fn) => code.slice(code.indexOf(`create function ${fn}(`)).split(/\n\$\$;/)[0];
const PUBLIC = ["hack_run_get", "hack_run_put", "hack_run_spent", "hack_run_start"];
/** How a run ends (`AgentResult`, `../runner/brain.ts`). */
const RESULTS = ["aborted", "fault", "out_of_budget", "over_turns", "stopped", "submitted", "void"];

test("one file, one transaction, after hack_v1, not applied anywhere by this repository; its number is its own", () => {
  const all = readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort();
  const hack = all.filter((f) => /_hack_/.test(f));
  assert.deepEqual(hack, ["20261108180000_hack_v1.sql", FILE], "the orders first, then the runs that stand on them");
  const stamp = FILE.split("_")[0];
  assert.deepEqual(all.filter((f) => f.startsWith(`${stamp}_`)), [FILE], "no other migration has this number");
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  assert.match(sql, /Not applied to any Supabase project/);
  assert.match(sql, /through MCP Supabase/);
  assert.doesNotMatch(code, /^\s*(drop|truncate|alter table public\.)/im);
  assert.doesNotMatch(code, /\bdelete from private\.hack_runs\b/, "a run is never deleted: every attempt's spend counts");
});

test("the table is private with row level security forced, no policy and no grant", () => {
  assert.deepEqual([...code.matchAll(/create table (\w+\.\w+)/g)].map((m) => m[1]), ["private.hack_runs"]);
  assert.match(code, /alter table private\.hack_runs enable row level security;/);
  assert.match(code, /alter table private\.hack_runs force row level security;/);
  assert.doesNotMatch(code, /create policy/);
  assert.match(code, /revoke all privileges on table private\.hack_runs from public, anon, authenticated, service_role;/);
  assert.match(code, /order_id text not null references private\.hack_orders \(id\)/);
  const grants = [...code.matchAll(/^grant ([^\n]+);$/gm)].map((m) => m[1]);
  assert.equal(grants.length, PUBLIC.length);
  for (const grant of grants) assert.match(grant, /^execute on function public\.hack_run_\w+\([^)]*\) to anon$/, grant);
});

test("every server function is secret-gated, runs with an empty search path and is granted to anon alone", () => {
  const publicFns = [...code.matchAll(/create function public\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(publicFns.sort(), PUBLIC);
  for (const fn of publicFns) {
    const body = bodyOf(`public.${fn}`);
    assert.match(body, /security definer\s+set search_path = ''/, fn);
    assert.match(body, /begin\s+perform private\.beta_check_secret\(p_secret\);/, `${fn}: the secret first`);
    assert.match(code, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`), fn);
    assert.match(code, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to anon;`), fn);
  }
  const json = bodyOf("private.hack_run_json");
  assert.match(json, /set search_path = ''/);
  assert.doesNotMatch(json, /security definer/);
  assert.match(code, /revoke all on function private\.hack_run_json\(private\.hack_runs\) from public, anon, authenticated, service_role;/);
});

test("the lists and the figures are the library's", () => {
  const list = (re) => re.exec(code)[1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
  assert.deepEqual(list(/role in \(([^)]+)\)/), [...HACK_ROLES].sort());
  assert.deepEqual(list(/result in \(([^)]+)\)/), RESULTS);
  assert.match(code, new RegExp(`attempt between 1 and ${RUN_ATTEMPTS}\\b`));
  const start = bodyOf("public.hack_run_start");
  assert.match(start, new RegExp(`v_last\\.attempt >= ${RUN_ATTEMPTS}\\b`));
  assert.match(start, new RegExp(`v_owner > 0 and v_owner \\+ p_reserved > p_cap / ${OWNER_SHARE_OF_CAP}\\b`), "one owner's part of the day");
});

test("the atomic rules: a start takes the order's lock, then the day's, before it writes; a put only while running", () => {
  const start = bodyOf("public.hack_run_start");
  const orderLock = start.indexOf("from private.hack_orders o where o.id = p_order for update");
  const taken = start.indexOf("from private.hack_takes k");
  const dayLock = start.indexOf("pg_advisory_xact_lock(hashtextextended('hack:runs:day', 0))");
  const sum = start.indexOf("sum(coalesce(x.spent, x.reserved))");
  const write = start.indexOf("insert into private.hack_runs");
  assert.ok(orderLock > 0 && orderLock < taken && taken < dayLock && dayLock < sum && sum < write, "lock, take, day's lock, sum, write");
  assert.match(start, /k\.hunter = p_hunter and k\.owner = p_owner and k\.role = p_role/, "the agent's own take, by the same owner on the same side");
  assert.match(start, /v_last\.status = 'running' or v_last\.result is distinct from 'void'/, "only a void run is played again");
  assert.match(start, /v_day \+ p_reserved > p_cap/);
  const put = bodyOf("public.hack_run_put");
  assert.match(put, /x\.attempt = p_attempt and x\.status = 'running'/, "written only while this attempt still runs here");
  assert.match(put, /spent = case when p_status = 'done' then coalesce\(p_spent, x\.reserved\) else null end/, "nothing measured counts at its most");
  assert.doesNotMatch(put, /insert into/);
});

test("no address, key or money in a column", () => {
  const table = /create table private\.hack_runs \(([\s\S]+?)\n\);/.exec(code)[1];
  const columns = [...table.matchAll(/^\s+(\w+) (?:text|integer|bigint|boolean|timestamptz|jsonb)\b/gm)].map((m) => m[1]);
  assert.deepEqual(columns, ["order_id", "hunter", "attempt", "owner", "role", "status", "result", "record", "reserved", "spent", "started_at", "updated_at"]);
  for (const column of columns) assert.doesNotMatch(column, /secret|password|key|lamports|balance|amount|ip_address/i, column);
});

test("the wiring: every function the database store calls exists with exactly the arguments it sends", async () => {
  const signatures = new Map();
  for (const match of code.matchAll(/create function public\.(\w+)\(([\s\S]*?)\)\nreturns/g)) {
    signatures.set(match[1], match[2].split(",").map((arg) => arg.trim().split(/\s+/)[0]).filter(Boolean));
  }
  const record = { order: "order-1", hunter: "agent-7", owner: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", role: "attacker", attempt: 1, status: "running", maxTurns: 12, history: [], result: null, detail: "", finding: null, cost: { reserved: 600, spent: null }, startedAt: 1_000, updatedAt: 1_000 };
  const runJson = { record, status: "running", result: null, attempt: 1, reserved: 600, spent: null, startedAt: 1_000, updatedAt: 1_000 };
  const answers = { hack_run_start: { ok: true, started: true, attempt: 1 }, hack_run_put: { ok: true, written: true }, hack_run_get: { ok: true, run: runJson }, hack_run_spent: { ok: true, spent: 600 } };
  const called = [];
  const rpc = async (fn, args) => {
    called.push(fn);
    const expected = signatures.get(fn);
    assert.ok(expected, `${fn} is not in the migration`);
    assert.deepEqual(["p_secret", ...Object.keys(args)].sort(), [...expected].sort(), fn);
    return { ok: true, data: answers[fn] };
  };
  const runs = createSupabaseRunStore(rpc);
  assert.equal(runs.durable, true);
  assert.deepEqual(await runs.start(record, { day: 0, cap: 5_000_000 }), { ok: true, attempt: 1 });
  assert.equal(await runs.put(record), true);
  assert.deepEqual(await runs.get("order-1", "agent-7"), record);
  assert.equal(await runs.spent(0), 600);
  assert.deepEqual([...new Set(called)].sort(), [...signatures.keys()].sort(), "every function is used, none is missing");

  // An answer that does not read as a run is unavailable, never guessed at.
  const broken = createSupabaseRunStore(async (fn) => ({ ok: true, data: fn === "hack_run_get" ? { ok: true, run: { record: { order: "order-1" } } } : { ok: true, error: "something_new" } }));
  await assert.rejects(broken.get("order-1", "agent-7"), /unreadable run/);
  await assert.rejects(broken.start(record, { day: 0, cap: 1 }), /something_new/);
  await assert.rejects(broken.put(record), /unreadable/);
  await assert.rejects(createSupabaseRunStore(async () => ({ ok: false, error: "temporarily unavailable" })).spent(0), /temporarily unavailable/);
});
