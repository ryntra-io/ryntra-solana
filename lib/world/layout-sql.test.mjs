/*
 * The layout's migration (CITY-55), read as text — its table is private with row level security forced, its two
 * functions ask for the secret — and one behaviour for both layout stores: memory every time, and the real migration
 * on a throwaway PostgreSQL when WORLD_TEST_DATABASE_URL names a local server. Never point it at a real project.
 */
import "./testing/hooks.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";

const { MemoryWorldStore } = await import("./memory-store.ts");
const { SupabaseWorldStore } = await import("./supabase-store.ts");
const { MemoryLayoutStore, SupabaseLayoutStore } = await import("./layout-store.ts");

const FILE = "20261028150000_quarter_layout.sql";
const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const code = sql.replace(/^\s*--.*$/gm, "");

test("one transaction, prepared as a file, nothing dropped", () => {
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  assert.match(sql, /Not applied to any Supabase project/);
  assert.doesNotMatch(code, /^\s*(drop|truncate|alter table \S+ (drop|rename))\s/im);
});

test("the layout table is a private world_ table, row level security forced, no policy and no grant", () => {
  assert.deepEqual([...code.matchAll(/create table (\w+\.\w+)/g)].map((m) => m[1]), ["private.world_layouts"]);
  assert.match(code, /alter table private\.world_layouts enable row level security;/);
  assert.match(code, /alter table private\.world_layouts force row level security;/);
  assert.match(code, /revoke all privileges on table private\.world_layouts from public, anon, authenticated, service_role;/);
  assert.doesNotMatch(code, /create policy/);
  assert.doesNotMatch(code, /grant (all|select|insert|update|delete|truncate)/i);
  assert.match(code, /jsonb_array_length\(pieces\) <= 120/, "the table caps a layout as the rules do");
});

test("both functions ask for the secret, run with an empty search path and are granted to anon alone", () => {
  const fns = [...code.matchAll(/create function public\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(fns, ["world_layout", "world_commit_layout"]);
  for (const fn of fns) {
    const body = code.slice(code.indexOf(`create function public.${fn}(`)).split(/\n\$\$;/)[0];
    assert.match(body, /security definer\s+set search_path = ''/, fn);
    assert.match(body, /perform private\.beta_check_secret\(p_secret\);/, fn);
    assert.match(code, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`), fn);
    assert.match(code, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to anon;`), fn);
  }
  assert.doesNotMatch(code, /world_points|world_daily_tasks|world_award|world_progress/, "a layout pays nothing");
});

const T = new Date("2026-10-28T10:00:00.000Z");
const block = (gx, gz, y = 0) => ({ gx, gz, y, kind: "block", rot: 0 });

function memoryFixture() {
  const world = new MemoryWorldStore();
  return { world, layouts: new MemoryLayoutStore(world), close: async () => {} };
}

async function pgFixture() {
  const { throwawayDatabase } = await import("./testing/pg.mjs");
  const db = await throwawayDatabase(process.env.WORLD_TEST_DATABASE_URL);
  await db.client.query(sql);
  return { world: new SupabaseWorldStore(db.rpc), layouts: new SupabaseLayoutStore(db.rpc), close: db.close, db };
}

function suite(name, makeFixture, skip = false) {
  describe(`layout store: ${name}`, { skip }, () => {
    let fx;
    before(async () => {
      fx = await makeFixture();
    });
    after(async () => {
      await fx?.close();
    });

    const claim = async () => {
      const made = await fx.world.claim({ accountId: null, guestSalt: randomUUID().replace(/-/g, ""), displayName: null, now: T });
      return made;
    };

    test("a quarter with nothing saved reads version 0; no such quarter reads null", async () => {
      const { quarter } = await claim();
      assert.deepEqual(await fx.layouts.layout(quarter.id), { quarterId: quarter.id, pieces: [], version: 0, updatedAt: null });
      assert.equal(await fx.layouts.layout(randomUUID()), null);
    });

    test("the owner writes at the version seen; each write moves the version on", async () => {
      const { quarter, resident } = await claim();
      const one = await fx.layouts.commitLayout({ residentId: resident.id, quarterId: quarter.id, version: 0, pieces: [block(0, 0)], now: T });
      assert.equal(one.ok, true);
      assert.deepEqual([one.layout.version, one.layout.updatedAt, one.layout.pieces], [1, T.toISOString(), [block(0, 0)]]);
      const two = await fx.layouts.commitLayout({ residentId: resident.id, quarterId: quarter.id, version: 1, pieces: [block(0, 0), block(0, 0, 1)], now: T });
      assert.equal(two.layout.version, 2);
      assert.deepEqual((await fx.layouts.layout(quarter.id)).pieces, [block(0, 0), block(0, 0, 1)]);
    });

    test("a stale version answers with the layout as it is now and changes nothing", async () => {
      const { quarter, resident } = await claim();
      await fx.layouts.commitLayout({ residentId: resident.id, quarterId: quarter.id, version: 0, pieces: [block(1, 1)], now: T });
      const stale = await fx.layouts.commitLayout({ residentId: resident.id, quarterId: quarter.id, version: 0, pieces: [], now: T });
      assert.equal(stale.ok, false);
      assert.equal(stale.error, "version");
      assert.deepEqual([stale.layout.version, stale.layout.pieces], [1, [block(1, 1)]]);
    });

    test("someone else's quarter and a missing one are refused", async () => {
      const { quarter } = await claim();
      const { resident: other } = await claim();
      assert.deepEqual(await fx.layouts.commitLayout({ residentId: other.id, quarterId: quarter.id, version: 0, pieces: [], now: T }), { ok: false, error: "not_owner" });
      assert.deepEqual(await fx.layouts.commitLayout({ residentId: other.id, quarterId: randomUUID(), version: 0, pieces: [], now: T }), { ok: false, error: "not_found" });
    });

    if (name === "postgres") {
      test("the database holds the caps itself, the secret is required, and the browser roles read nothing", async () => {
        const { quarter, resident } = await claim();
        const tooMany = Array.from({ length: 121 }, () => block(0, 0));
        await assert.rejects(fx.layouts.commitLayout({ residentId: resident.id, quarterId: quarter.id, version: 0, pieces: tooMany, now: T }));
        const wrong = await fx.db.rpc("world_layout", { p_quarter_id: quarter.id }, "not-the-secret");
        assert.equal(wrong.ok, false);
        for (const role of ["anon", "authenticated"]) {
          await fx.db.client.query(`set role ${role}`);
          await assert.rejects(fx.db.client.query("select * from private.world_layouts"));
          await fx.db.client.query("reset role");
        }
      });

      test("the row goes with its quarter", async () => {
        const { quarter, resident } = await claim();
        await fx.layouts.commitLayout({ residentId: resident.id, quarterId: quarter.id, version: 0, pieces: [block(0, 0)], now: T });
        // A resident that goes takes its quarters, and each quarter its layout.
        await fx.db.client.query("delete from private.world_residents where id = $1", [resident.id]);
        const { rows } = await fx.db.client.query("select count(*)::int as n from private.world_layouts where quarter_id = $1", [quarter.id]);
        assert.equal(rows[0].n, 0);
      });
    }
  });
}

suite("memory", memoryFixture);
suite("postgres", pgFixture, !process.env.WORLD_TEST_DATABASE_URL);
