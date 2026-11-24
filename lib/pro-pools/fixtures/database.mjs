/*
 * A throwaway database with the pools' migrations applied, for the tests that run the database's own functions.
 *
 * - `RYNTRA_PRO_POOLS_PG` — a Postgres server to make the database in (a connection string to a server of one's own,
 *   e.g. one started for the test). A new database is created there, used and dropped: nothing that exists is read or
 *   written.
 * - else `RYNTRA_PGLITE_DIR` — a folder whose `node_modules` holds `@electric-sql/pglite` (not a dependency of the
 *   repository, `scripts/access-qa/apply-prodlike.mjs`): a database in memory.
 * - else none: the tests that need one are skipped. Neither ever touches a real Supabase project.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SECRET = "local-secret";

export const MIGRATIONS = Object.freeze({
  v1: "20261120150000_pro_pools_store_v1.sql",
  v2: "20261123120000_pro_pools_flags_v2.sql",
});

export const migrationText = (name) => readFileSync(new URL(`../../../supabase/migrations/${MIGRATIONS[name] ?? name}`, import.meta.url), "utf8");

const pgUrl = process.env.RYNTRA_PRO_POOLS_PG?.trim() || null;
const pgliteDir = process.env.RYNTRA_PGLITE_DIR ? resolve(process.env.RYNTRA_PGLITE_DIR) : null;
const pgliteEntry = pgliteDir ? join(pgliteDir, "node_modules", "@electric-sql", "pglite", "dist", "index.js") : null;

/** False where a database can be made; else why not — a test's `skip`. */
export const noDatabase = pgUrl || (pgliteEntry && existsSync(pgliteEntry)) ? false : "neither RYNTRA_PRO_POOLS_PG nor RYNTRA_PGLITE_DIR names a database to make";

const SETUP = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
  end $$;
  create schema private;
  create function private.beta_check_secret(p_secret text) returns void language plpgsql as $f$
  begin if p_secret is distinct from '${SECRET}' then raise exception 'forbidden'; end if; end $f$;
`;

/**
 * A new database with the named migrations applied in order. `{ query(sql, params) → rows, exec(sql), apply(name),
 * rpc(secret), kind, close() }`; `rpc` is the server's transport as PostgREST does it: named arguments, JSON in and
 * out, a raised exception as a refusal.
 */
export async function proPoolsDatabase(migrations = ["v1", "v2"]) {
  let query;
  let exec;
  let close;
  let kind;
  if (pgUrl) {
    const { default: pg } = await import("pg");
    const name = `pro_pools_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const admin = new pg.Client({ connectionString: pgUrl });
    await admin.connect();
    await admin.query(`create database ${name}`);
    const url = new URL(pgUrl);
    url.pathname = `/${name}`;
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    query = async (sql, params = []) => (await client.query(sql, params)).rows;
    exec = async (sql) => void (await client.query(sql));
    close = async () => {
      await client.end();
      await admin.query(`drop database if exists ${name}`);
      await admin.end();
    };
    kind = "postgres";
  } else {
    const { PGlite } = await import(pathToFileURL(pgliteEntry).href);
    const db = new PGlite();
    query = async (sql, params = []) => (await db.query(sql, params)).rows;
    exec = async (sql) => void (await db.exec(sql));
    close = async () => db.close();
    kind = "pglite";
  }
  await exec(SETUP);
  const apply = async (name) => exec(migrationText(name));
  for (const name of migrations) await apply(name);
  const rpc = (secret = SECRET) => async (fn, args) => {
    const all = { p_secret: secret, ...args };
    const names = Object.keys(all);
    try {
      const rows = await query(`select public.${fn}(${names.map((name, at) => `${name} => $${at + 1}`).join(", ")}) as r`, names.map((name) => (all[name] !== null && typeof all[name] === "object" ? JSON.stringify(all[name]) : all[name])));
      return { ok: true, data: rows[0].r };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  };
  return { query, exec, apply, rpc, kind, close };
}
