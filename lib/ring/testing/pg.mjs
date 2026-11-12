/*
 * A throwaway PostgreSQL database for checking the Ring's SQL (CITY-50, CITY-217): a fresh database with the parts of
 * Supabase the migrations stand on (the world line's `bootstrap.sql`: the roles, the `private` schema, the secret check
 * and Supabase's generous default grants), the Ring's two migrations applied, and its functions called the way PostgREST does —
 * by name, with typed arguments and the app secret.
 *
 * Used only by tests, and only when RING_TEST_DATABASE_URL names a local server. Never point it at a real project: it
 * creates and drops its own database there.
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";

const here = (path) => new URL(path, import.meta.url);
const BOOTSTRAP = readFileSync(here("../../world/testing/bootstrap.sql"), "utf8").replace(/^\\.*$/gm, "");
const MIGRATION = readFileSync(here("../../../supabase/migrations/20261027230000_ring_v1.sql"), "utf8");
const ARENA = readFileSync(here("../../../supabase/migrations/20261108120100_ring_v2_arena.sql"), "utf8");
/** The secret the bootstrap's `private.beta_check_secret` accepts. */
export const TEST_SECRET = "world-test-secret";

export async function throwawayDatabase(url) {
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const name = `ring_test_${randomBytes(6).toString("hex")}`;
  await admin.query(`create database ${name}`);
  const target = new URL(url);
  target.pathname = `/${name}`;
  // Every call on its own connection from a pool, as PostgREST makes them: two calls at once really run at once.
  const pool = new pg.Pool({ connectionString: target.toString(), max: 4 });
  await pool.query(BOOTSTRAP);
  await pool.query(MIGRATION);
  await pool.query(ARENA);

  const types = new Map();
  async function argTypes(fn) {
    if (!types.has(fn)) {
      const { rows } = await pool.query(
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
      const { rows } = await pool.query(`select public.${fn}(${parts.join(", ")}) as result`, values);
      return { ok: true, data: rows[0].result };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async function close() {
    await pool.end();
    await admin.query(`drop database ${name} with (force)`);
    await admin.end();
  }

  return { pool, rpc, close, name };
}
