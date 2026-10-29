/*
 * A throwaway PostgreSQL database for checking the world's SQL: it creates a
 * fresh database, lays down the parts of Supabase the migration needs
 * (`bootstrap.sql`), applies the world's migration files in order and calls the functions the
 * way PostgREST does — by name, with typed arguments and the app secret.
 *
 * Used only by tests, and only when WORLD_TEST_DATABASE_URL names a local
 * server. Never point it at a real project.
 */
import { readFileSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";

const here = (path) => new URL(path, import.meta.url);
const BOOTSTRAP = readFileSync(here("./bootstrap.sql"), "utf8").replace(/^\\.*$/gm, "");
/** Every world migration, in the order of their names: `world_v1` first. */
const MIGRATIONS = readdirSync(here("../../../supabase/migrations/")).filter((f) => f.includes("world")).sort()
  .map((f) => readFileSync(here(`../../../supabase/migrations/${f}`), "utf8"));
export const TEST_SECRET = "world-test-secret";

export async function throwawayDatabase(url) {
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const name = `world_test_${randomBytes(6).toString("hex")}`;
  await admin.query(`create database ${name}`);
  const target = new URL(url);
  target.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: target.toString() });
  await client.connect();
  await client.query(BOOTSTRAP);
  for (const migration of MIGRATIONS) await client.query(migration);

  const types = new Map();
  async function argTypes(fn) {
    if (!types.has(fn)) {
      const { rows } = await client.query(
        `select unnest(proargnames) as name, format_type(unnest(proargtypes::oid[]), null) as type
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`,
        [fn],
      );
      types.set(fn, new Map(rows.map((r) => [r.name, r.type])));
    }
    return types.get(fn);
  }

  /** Call `public.<fn>` like PostgREST: named, typed arguments, the secret first. */
  async function rpc(fn, args, secret = TEST_SECRET) {
    const known = await argTypes(fn);
    const entries = Object.entries({ p_secret: secret, ...args });
    const values = [];
    const parts = entries.map(([key, value], i) => {
      const type = known.get(key);
      if (!type) throw new Error(`${fn} has no argument ${key}`);
      values.push(type === "jsonb" ? (value === null || value === undefined ? null : JSON.stringify(value)) : value);
      return `${key} => $${i + 1}::${type}`;
    });
    try {
      const { rows } = await client.query(`select public.${fn}(${parts.join(", ")}) as result`, values);
      return { ok: true, data: rows[0].result };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async function close() {
    await client.end();
    await admin.query(`drop database ${name} with (force)`);
    await admin.end();
  }

  return { client, rpc, close, name };
}
