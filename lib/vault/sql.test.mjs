// Run from repo root: node --test lib/vault/sql.test.mjs
/*
 * The vault's migration, read as text: one transaction, not applied by this repository, every table closed to every
 * role, every server function secret-gated with an empty search path and granted to anon alone, and its lists the
 * vault's own lists. Its behaviour is checked against a real database in `store.test.mjs` when
 * VAULT_TEST_DATABASE_URL is set.
 */
import "../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const { VAULT_IDS, TITLE } = await import("./levels.ts");
const migrations = new URL("../../supabase/migrations/", import.meta.url);
const files = readdirSync(migrations).filter((f) => /vault/.test(f));
const sql = readFileSync(new URL("20261027200000_vault_v1.sql", migrations), "utf8");
const code = sql.replace(/^\s*--.*$/gm, "");

const TABLES = ["private.vault_attempts", "private.vault_progress", "private.vault_feed", "private.vault_answers"];

test("one migration file, one transaction, not applied anywhere by this repository", () => {
  assert.deepEqual(files, ["20261027200000_vault_v1.sql"]);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  assert.match(sql, /Not applied to any Supabase project/);
  assert.doesNotMatch(code, /^\s*(drop|truncate|alter table public\.)/im);
});

test("every table is a private vault_ table with row level security forced, no policy and no grant", () => {
  const created = [...code.matchAll(/create table (\w+\.\w+)/g)].map((m) => m[1]);
  assert.deepEqual(created.sort(), [...TABLES].sort());
  for (const table of created) {
    assert.match(table, /^private\.vault_/);
    assert.match(code, new RegExp(`alter table ${table.replace(".", "\\.")} enable row level security;`));
    assert.match(code, new RegExp(`alter table ${table.replace(".", "\\.")} force row level security;`));
  }
  assert.doesNotMatch(code, /create policy/);
  assert.match(code, /revoke all privileges on table[\s\S]+?from public, anon, authenticated, service_role;/);
  for (const table of TABLES) assert.ok(/revoke all privileges on table([\s\S]+?)from public/.exec(code)[1].includes(table), table);
  assert.match(code, /revoke all privileges on sequence private\.vault_feed_seq from public, anon, authenticated, service_role;/);
  const grants = [...code.matchAll(/^grant ([^\n]+);$/gm)].map((m) => m[1]);
  assert.ok(grants.length > 0);
  for (const grant of grants) assert.match(grant, /^execute on function public\.vault_\w+\([^)]*\) to anon$/, grant);
});

test("every server function is secret-gated, runs with an empty search path and is granted to anon alone", () => {
  const publicFns = [...code.matchAll(/create function public\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(publicFns.sort(), ["vault_answer", "vault_crack", "vault_feed", "vault_give_back", "vault_keep_answer", "vault_left", "vault_progress", "vault_push", "vault_take"]);
  for (const fn of publicFns) {
    const body = code.slice(code.indexOf(`create function public.${fn}(`)).split(/\n\$\$;/)[0];
    assert.match(body, /security definer\s+set search_path = ''/, fn);
    assert.match(body, /perform private\.beta_check_secret\(p_secret\);/, fn);
    assert.match(code, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`), fn);
    assert.match(code, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to anon;`), fn);
  }
  const privateFns = [...code.matchAll(/create function private\.(\w+)\(/g)].map((m) => m[1]);
  for (const fn of privateFns) {
    const body = code.slice(code.indexOf(`create function private.${fn}(`)).split(/\n\$\$;/)[0];
    assert.match(body, /set search_path = ''/, fn);
    assert.doesNotMatch(body, /security definer/, fn);
    assert.match(code, new RegExp(`revoke all on function private\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`), fn);
    assert.doesNotMatch(code, new RegExp(`grant execute on function private\\.${fn}`), fn);
  }
});

test("counting is one step per key and a crack takes the row's lock", () => {
  const take = code.slice(code.indexOf("create function public.vault_take(")).split(/\n\$\$;/)[0];
  assert.match(take, /pg_advisory_xact_lock\(hashtextextended\('vault:' \|\| p_key, 0\)\)/);
  assert.ok(take.indexOf("pg_advisory_xact_lock") < take.indexOf("count(*)"), "the lock comes before the count");
  const crack = code.slice(code.indexOf("create function public.vault_crack(")).split(/\n\$\$;/)[0];
  assert.match(crack, /for update;/);
});

test("the lists in the tables are the vault's lists, and nothing stores a phrase", () => {
  const list = (re) => re.exec(code)[1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
  assert.deepEqual(list(/vault text not null check \(vault in \(([^)]+)\)\)/), [...VAULT_IDS].sort());
  assert.deepEqual(list(/outcome in \(([^)]+)\)/), ["caught", "cracked", "held", "leaked", "screened"]);
  assert.deepEqual(list(/title in \(([^)]+)\)/), [TITLE]);
  const tables = [...code.matchAll(/create table \w+\.\w+ \(([\s\S]+?)\n\);/g)].map((m) => m[1]).join("\n");
  const columns = [...tables.matchAll(/^\s+(\w+) (?:uuid|text|integer|bigint|double precision|date\[\]|timestamptz|jsonb)\b/gm)].map((m) => m[1]);
  assert.ok(columns.length >= 15, `${columns.length} columns`);
  for (const column of columns) assert.doesNotMatch(column, /phrase|secret|amount|balance|price|lamports/i, column);
});
