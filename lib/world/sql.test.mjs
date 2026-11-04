/*
 * The world's migration, read as text: what anyone may read, that nobody but
 * the server writes, that every server function asks for the secret, and
 * that its lists match the contract. Its behaviour is checked against a real
 * database in `store.test.mjs` when WORLD_TEST_DATABASE_URL is set.
 */
import "./testing/hooks.mjs";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const contract = await import("./contract.ts");
const migrations = new URL("../../supabase/migrations/", import.meta.url);
const files = readdirSync(migrations).filter((f) => f.includes("world")).sort();
const sql = readFileSync(new URL("20261027090000_world_v1.sql", migrations), "utf8");
const code = sql.replace(/^\s*--.*$/gm, "");
/* CITY-19: a free vault's crack joins the reasons of the points ledger; nothing else changes. */
const pointsSql = readFileSync(new URL("20261028100000_world_points_v2.sql", migrations), "utf8");
const pointsCode = pointsSql.replace(/^\s*--.*$/gm, "");

const TABLES = {
  "private.world_residents": "private", "public.world_quarters": "public", "public.world_buildings": "public",
  "private.world_points": "private", "private.world_daily_tasks": "private", "private.world_visits": "private",
  "private.world_crews": "private", "private.world_events": "private", "private.world_versions": "private",
  "private.world_requests": "private", "private.world_limits": "private",
};

const awaySql = readFileSync(new URL("20261028090000_world_away.sql", migrations), "utf8");
const awayCode = awaySql.replace(/^\s*--.*$/gm, "");
const beaconsSql = readFileSync(new URL("20261028120000_world_beacons.sql", migrations), "utf8");
const beaconsCode = beaconsSql.replace(/^\s*--.*$/gm, "");

test("the world's migration files, each one transaction, not applied anywhere by this repository", () => {
  assert.deepEqual(files, ["20261027090000_world_v1.sql", "20261028090000_world_away.sql", "20261028100000_world_points_v2.sql", "20261028120000_world_beacons.sql", "20261031090000_world_crews.sql"]);
  /* The points file drops and adds back one check, the only way to widen it; its own test below holds it to that. */
  for (const text of [sql, awaySql, beaconsSql]) {
    assert.match(text, /^begin;$/m);
    assert.match(text, /^commit;$/m);
    assert.match(text, /Not applied to any Supabase project/);
    assert.doesNotMatch(text.replace(/^\s*--.*$/gm, ""), /^\s*(drop|truncate|alter table \S+ (drop|rename))\s/im);
  }
});

test("the points file only widens the ledger's reasons, in one transaction, not applied anywhere", () => {
  assert.match(pointsSql, /^begin;$/m);
  assert.match(pointsSql, /^commit;$/m);
  assert.match(pointsSql, /Not applied to any Supabase project/);
  const statements = pointsCode.split(";").map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(statements.map((s) => s.split("(")[0].replace(/\s+/g, " ").trim()), [
    "begin",
    "alter table private.world_points drop constraint world_points_reason_check",
    "alter table private.world_points add constraint world_points_reason_check check",
    "commit",
  ]);
  assert.doesNotMatch(pointsCode, /create|grant|truncate|delete|update|insert|drop table|drop function/i);
});

test("every table is a world_ table with row level security forced", () => {
  const created = [...code.matchAll(/create table (\w+\.\w+)/g)].map((m) => m[1]);
  assert.deepEqual(created.sort(), Object.keys(TABLES).sort());
  for (const table of created) {
    assert.match(table.split(".")[1], /^world_/);
    assert.match(code, new RegExp(`alter table ${table.replace(".", "\\.")} enable row level security;`));
    assert.match(code, new RegExp(`alter table ${table.replace(".", "\\.")} force row level security;`));
  }
});

test("anyone reads quarters and buildings; nobody but the server writes anything", () => {
  const policies = [...code.matchAll(/create policy (\w+) on (\S+)\s+for (\w+) to ([^\n]+?) using \(true\);/g)].map((m) => [m[2], m[3], m[4]]);
  assert.deepEqual(policies, [["public.world_quarters", "select", "anon, authenticated"], ["public.world_buildings", "select", "anon, authenticated"]]);
  assert.equal((code.match(/create policy/g) ?? []).length, 2);
  const grants = [...code.matchAll(/^grant ([^\n]+);$/gm)].map((m) => m[1]);
  assert.deepEqual(grants.filter((g) => !g.startsWith("execute on function public.world_")), ["select on table public.world_quarters, public.world_buildings to anon, authenticated"]);
  assert.doesNotMatch(code, /grant (all|insert|update|delete|truncate)/i);
  assert.match(code, /revoke all privileges on table[\s\S]+?from public, anon, authenticated, service_role;/);
  for (const table of Object.keys(TABLES)) assert.ok(code.includes(table), table);
});

test("every server function is secret-gated, runs with an empty search path and is granted to anon alone", () => {
  const publicFns = [...code.matchAll(/create function public\.(\w+)\(/g)].map((m) => m[1]);
  assert.ok(publicFns.length >= 18);
  for (const fn of publicFns) {
    const body = code.slice(code.indexOf(`create function public.${fn}(`)).split(/\n\$\$;/)[0];
    assert.match(body, /security definer\s+set search_path = ''/, fn);
    assert.match(body, /perform private\.beta_check_secret\(p_secret\);/, fn);
    assert.match(code, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`), fn);
    assert.match(code, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to anon;`), fn);
  }
  const privateFns = [...code.matchAll(/create function private\.(\w+)\(/g)].map((m) => m[1]);
  for (const fn of privateFns) {
    assert.match(code, new RegExp(`revoke all on function private\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`), fn);
    assert.doesNotMatch(code, new RegExp(`grant execute on function private\\.${fn}`), fn);
  }
});

test("the lists in the tables are the contract's lists", () => {
  const list = (column) => {
    const match = new RegExp(`${column} in \\(([^)]+)\\)`).exec(code);
    return match[1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
  };
  const reasons = /reason in \(([^)]+)\)/.exec(pointsCode)[1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
  assert.deepEqual(reasons, [...contract.POINTS_REASONS].sort());
  assert.deepEqual(list("reason"), [...contract.POINTS_REASONS].filter((r) => r !== "vault_crack").sort());
  assert.deepEqual(list("district"), [...contract.DISTRICTS].sort());
  assert.deepEqual(list("kind text not null check \\(kind"), [...contract.BUILDING_KINDS].sort());
  assert.deepEqual(list("source"), [...contract.EVENT_SOURCES].sort());
  const events = /kind in \(('pump'[^)]+)\)/.exec(code)[1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
  assert.deepEqual(events, [...contract.EVENT_KINDS].sort());
  const tasks = /kind in \(('add_floor'[^)]+)\)/.exec(code)[1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
  assert.deepEqual(tasks, [...contract.DAILY_TASK_KINDS].sort());
});

test("no money lives in the world: no amount, balance or price column", () => {
  const columns = [...code.matchAll(/^\s+(\w+) (?:uuid|text|integer|smallint|bigint|boolean|date|timestamptz|jsonb|text\[\])/gm)].map((m) => m[1]);
  for (const column of columns) assert.doesNotMatch(column, /amount|balance|price|usd|sol|lamports|fee/i, column);
});

test("«While you were away»: one private table with row level security forced, no policy and no grant", () => {
  const created = [...awayCode.matchAll(/create table (\w+\.\w+)/g)].map((m) => m[1]);
  assert.deepEqual(created, ["private.world_away_consent"]);
  assert.match(awayCode, /alter table private\.world_away_consent enable row level security;/);
  assert.match(awayCode, /alter table private\.world_away_consent force row level security;/);
  assert.match(awayCode, /revoke all privileges on table private\.world_away_consent from public, anon, authenticated, service_role;/);
  assert.match(awayCode, /resident_id uuid primary key references private\.world_residents\(id\) on delete cascade/);
  assert.doesNotMatch(awayCode, /create policy/);
  const grants = [...awayCode.matchAll(/^grant ([^\n]+);$/gm)].map((m) => m[1]);
  assert.ok(grants.length > 0 && grants.every((g) => /^execute on function public\.world_\w+\([^)]*\) to anon$/.test(g)), grants.join("; "));
  assert.doesNotMatch(awayCode, /grant (all|insert|update|delete|truncate|select)/i);
  assert.match(awayCode, /telegram boolean not null default false/);
  assert.match(awayCode, /push boolean not null default false/);
});

test("«While you were away»: every function is secret-gated, runs with an empty search path and keeps world_away's signature", () => {
  const fns = [...awayCode.matchAll(/create (?:or replace )?function public\.(\w+)\(([^)]*)\)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(fns.map(([name]) => name), ["world_away", "world_consent", "world_set_consent"]);
  assert.equal([...awayCode.matchAll(/create or replace function/g)].length, 1, "only world_away is replaced");
  const before = /create function public\.world_away\(([^)]*)\)/.exec(code)[1];
  assert.equal(fns[0][1], before, "the same arguments, so the server and its grants keep working");
  for (const [fn] of fns) {
    const body = awayCode.slice(awayCode.search(new RegExp(`create (or replace )?function public\\.${fn}\\(`))).split(/\n\$\$;/)[0];
    assert.match(body, /security definer\s+set search_path = ''/, fn);
    assert.match(body, /perform private\.beta_check_secret\(p_secret\);/, fn);
    assert.match(awayCode, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`), fn);
    assert.match(awayCode, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to anon;`), fn);
  }
  assert.match(awayCode, /if r\.account_id is null then\s+return jsonb_build_object\('ok', false, 'error', 'account_required'\);/, "a guest never consents");
});

test("«While you were away»: no money and nothing sent", () => {
  const columns = [...awayCode.matchAll(/^\s+(\w+) (?:uuid|text|integer|boolean|timestamptz|jsonb)/gm)].map((m) => m[1]);
  for (const column of columns) assert.doesNotMatch(column, /amount|balance|price|usd|sol|lamports|fee/i, column);
  assert.doesNotMatch(awayCode, /net\.http|pg_net|http_post|notify\s/i);
});

test("beacons (CITY-72): one private table with row level security forced, no policy, functions granted to anon alone", () => {
  const created = [...beaconsCode.matchAll(/create table (\w+\.\w+)/g)].map((m) => m[1]);
  assert.deepEqual(created, ["private.world_beacons"]);
  assert.match(beaconsCode, /alter table private\.world_beacons enable row level security;/);
  assert.match(beaconsCode, /alter table private\.world_beacons force row level security;/);
  assert.match(beaconsCode, /revoke all privileges on table private\.world_beacons from public, anon, authenticated, service_role;/);
  assert.match(beaconsCode, /account_id uuid primary key references public\.beta_users\(id\) on delete cascade/);
  assert.doesNotMatch(beaconsCode, /create policy/);
  assert.doesNotMatch(beaconsCode, /grant (all|insert|update|delete|truncate|select)/i);
  const fns = [...beaconsCode.matchAll(/create function public\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(fns, ["world_beacons", "world_set_beacons", "world_beacons_due", "world_beacons_step"]);
  for (const fn of fns) {
    const body = beaconsCode.slice(beaconsCode.indexOf(`create function public.${fn}(`)).split(/\n\$\$;/)[0];
    assert.match(body, /security definer\s+set search_path = ''/, fn);
    assert.match(body, /perform private\.beta_check_secret\(p_secret\);/, fn);
    assert.match(beaconsCode, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`), fn);
    assert.match(beaconsCode, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to anon;`), fn);
  }
  assert.match(beaconsCode, /revoke all on function private\.world_beacon_row\([^)]*\) from public, anon, authenticated, service_role;/);
  assert.doesNotMatch(beaconsCode, /grant execute on function private\./);
});

test("beacons: no money column and nothing sent from the database", () => {
  const table = /create table private\.world_beacons \(([\s\S]+?)\n\);/.exec(beaconsCode)[1];
  const columns = [...table.matchAll(/^\s+(\w+) (?:uuid|text|integer|boolean|timestamptz|jsonb)/gm)].map((m) => m[1]);
  assert.deepEqual(columns, ["account_id", "revision", "rules", "states", "updated_at", "checked_at"]);
  assert.doesNotMatch(beaconsCode, /net\.http|pg_net|http_post|notify\s/i);
});
