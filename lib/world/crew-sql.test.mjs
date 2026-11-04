/*
 * The crews' migration (CITY-20), read as text — private tables with row level security forced, every function asks
 * for the secret, the claim keeps its signature — and one behaviour for both crew stores: memory every time, and the
 * real migration on a throwaway PostgreSQL when WORLD_TEST_DATABASE_URL names a local server. Never point it at a
 * real project.
 */
import "./testing/hooks.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";

const { MemoryWorldStore } = await import("./memory-store.ts");
const { SupabaseWorldStore } = await import("./supabase-store.ts");
const { MemoryCrewStore, SupabaseCrewStore } = await import("./crew-store.ts");
const { CREW_COLOURS } = await import("./contract.ts");

const FILE = "20261031090000_world_crews.sql";
const sql = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const code = sql.replace(/^\s*--.*$/gm, "");
const v1 = readFileSync(new URL("../../supabase/migrations/20261027090000_world_v1.sql", import.meta.url), "utf8");

test("one transaction, prepared as a file, nothing dropped", () => {
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  assert.match(sql, /Not applied to any Supabase project/);
  assert.doesNotMatch(code, /^\s*(drop|truncate|alter table \S+ (drop|rename))\s/im);
});

test("the crew tables are private world_ tables, row level security forced, no policy and no grant", () => {
  const created = [...code.matchAll(/create table (\w+\.\w+)/g)].map((m) => m[1]);
  assert.deepEqual(created, ["private.world_crew_members", "private.world_crew_gifts"]);
  for (const table of created) {
    assert.match(code, new RegExp(`alter table ${table.replace(".", "\\.")} enable row level security;`));
    assert.match(code, new RegExp(`alter table ${table.replace(".", "\\.")} force row level security;`));
  }
  assert.match(code, /revoke all privileges on table private\.world_crew_members, private\.world_crew_gifts from public, anon, authenticated, service_role;/);
  assert.doesNotMatch(code, /create policy/);
  assert.doesNotMatch(code, /grant (all|select|insert|update|delete|truncate)/i);
  assert.match(code, /alter table private\.world_crews\s+add column colour/, "the crews table of world_v1 gains its columns");
  const colours = /colour in \(([^)]+)\)/.exec(code)[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(colours, [...CREW_COLOURS]);
});

test("no money lives in a crew: no amount, balance or price column", () => {
  const columns = [...code.matchAll(/^\s+(?:add column )?(\w+) (?:uuid|text|integer|smallint|bigint|boolean|date|timestamptz|jsonb)/gm)].map((m) => m[1]);
  assert.ok(columns.includes("points") && columns.includes("units"));
  for (const column of columns) assert.doesNotMatch(column, /amount|balance|price|usd|sol|lamports|fee/i, column);
  assert.doesNotMatch(code, /world_award|world_progress|insert into private\.world_points/, "a crew pays no points");
});

test("every server function asks for the secret, runs with an empty search path and is granted to anon alone", () => {
  const fns = [...code.matchAll(/create function public\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(fns, ["world_crew_mine", "world_crew_streets", "world_crew_by_invite", "world_crew_create", "world_crew_join", "world_crew_leave", "world_crew_gift"]);
  for (const fn of [...fns, "world_claim"]) {
    const start = code.indexOf(`function public.${fn}(`);
    const body = code.slice(start).split(/\n\$\$;/)[0];
    assert.match(body, /security definer\s+set search_path = ''/, fn);
    assert.match(body, /perform private\.beta_check_secret\(p_secret\);/, fn);
  }
  for (const fn of fns) {
    assert.match(code, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`), fn);
    assert.match(code, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to anon;`), fn);
  }
  const privateFns = [...code.matchAll(/create function private\.(\w+)\(/g)].map((m) => m[1]);
  for (const fn of privateFns) {
    assert.match(code, new RegExp(`revoke all on function private\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`), fn);
    assert.doesNotMatch(code, new RegExp(`grant execute on function private\\.${fn}`), fn);
  }
});

test("the claim is world_v1's, with the same signature, taking its lot past every crew's street", () => {
  const signature = (text, how) => new RegExp(`${how} function public\\.world_claim\\(([^)]*)\\)`).exec(text)[1].replace(/\s+/g, " ").trim();
  assert.equal(signature(code, "create or replace"), signature(v1, "create"));
  assert.equal([...code.matchAll(/create or replace function/g)].length, 1, "only world_claim is replaced");
  const body = (text, how) =>
    text.slice(text.indexOf(`${how} function public.world_claim(`)).split(/\n\$\$;/)[0].replace(/^\s*--.*$/gm, "").replace("create or replace", "create")
      .split("\n").map((l) => l.trim()).filter(Boolean);
  const before = body(v1, "create");
  const after = body(sql, "create or replace");
  assert.equal(after.length, before.length);
  const changed = after.map((line, i) => [before[i], line]).filter(([a, b]) => a !== b);
  assert.deepEqual(changed, [["v_k := nextval('private.world_arrivals_seq');", "v_k := private.world_next_arrival(p_street_length);"]]);
  assert.match(code, /pg_advisory_xact_lock\(7201020\)/);
});

const T = new Date("2026-10-29T10:00:00.000Z");

function memoryFixture() {
  const world = new MemoryWorldStore();
  return { world, crews: new MemoryCrewStore(world), close: async () => {} };
}

async function pgFixture() {
  const { throwawayDatabase } = await import("./testing/pg.mjs");
  const db = await throwawayDatabase(process.env.WORLD_TEST_DATABASE_URL);
  return { world: new SupabaseWorldStore(db.rpc), crews: new SupabaseCrewStore(db.rpc), close: db.close, db };
}

function suite(name, makeFixture, skip = false) {
  describe(`crew store: ${name}`, { skip }, () => {
    let fx;
    before(async () => {
      fx = await makeFixture();
    });
    after(async () => {
      await fx?.close();
    });

    const claim = () => fx.world.claim({ accountId: null, guestSalt: randomUUID().replace(/-/g, ""), displayName: null, now: T });
    const invite = () => Array.from({ length: 8 }, () => "23456789ABCDEFGHJKMNPQRSTUVWXYZ"[Math.floor(Math.random() * 31)]).join("");
    const week = new Date("2026-10-26T00:00:00.000Z");

    test("a crew takes a street no newcomer stands on; claims step over it", async () => {
      const { resident } = await claim();
      const code = invite();
      const made = await fx.crews.create({ residentId: resident.id, name: "Night Owls", colour: "lilac", invite: code, now: T });
      assert.equal(made.ok, true);
      const row = made.quarter.cell.z;
      assert.deepEqual([made.quarter.cell.x, made.quarter.street, made.quarter.version], [0, `arrivals-${row + 1}`, 2]);
      for (let i = 0; i < 30; i += 1) assert.notEqual((await claim()).quarter.cell.z, row);
      const mine = await fx.crews.mine({ residentId: resident.id, day: "2026-10-29", since: week });
      assert.deepEqual([mine.crew.name, mine.crew.colour, mine.crew.row, mine.crew.invite], ["Night Owls", "lilac", row, code]);
      assert.deepEqual(mine.people.map((p) => [p.lot, p.verified]), [[0, false]]);
      assert.deepEqual([mine.units, mine.given, mine.me.gave], [0, [], { module: false, points: false }]);
      const street = await fx.crews.byInvite(code);
      assert.deepEqual([street.members, street.crew.name], [1, "Night Owls"]);
      assert.equal(await fx.crews.byInvite("ZZZZZZZZ"), null);
      assert.ok((await fx.crews.streets()).some((s) => s.crew.id === mine.crew.id));
      assert.deepEqual(await fx.crews.create({ residentId: resident.id, name: "Again", colour: "sky", invite: invite(), now: T }), { ok: false, error: "in_crew" });
    });

    test("joins take the next lot of the row while there is room; leaving goes back to a newcomers' street", async () => {
      const { resident: founder } = await claim();
      const code = invite();
      const made = await fx.crews.create({ residentId: founder.id, name: "Row", colour: "cyan", invite: code, now: T });
      const row = made.quarter.cell.z;
      const a = (await claim()).resident;
      const b = (await claim()).resident;
      const ja = await fx.crews.join({ residentId: a.id, invite: code, limit: 3, now: T });
      assert.deepEqual([ja.quarter.cell.x, ja.quarter.cell.z], [2, row]);
      assert.equal((await fx.crews.join({ residentId: b.id, invite: code, limit: 2, now: T })).error, "full");
      assert.deepEqual(await fx.crews.join({ residentId: a.id, invite: code, limit: 3, now: T }), { ok: false, error: "in_crew" });
      assert.deepEqual(await fx.crews.join({ residentId: b.id, invite: "ZZZZZZZZ", limit: 3, now: T }), { ok: false, error: "not_found" });
      const out = await fx.crews.leave({ residentId: founder.id, now: T });
      assert.equal(out.ok, true);
      assert.notEqual(out.quarter.cell.z, row);
      const jb = await fx.crews.join({ residentId: b.id, invite: code, limit: 3, now: T });
      assert.equal(jb.quarter.cell.x, 0, "the founder's lot is free again");
      assert.deepEqual(await fx.crews.leave({ residentId: founder.id, now: T }), { ok: false, error: "not_in_crew" });
      await fx.crews.leave({ residentId: a.id, now: T });
      await fx.crews.leave({ residentId: b.id, now: T });
      assert.equal(await fx.crews.byInvite(code), null, "the last one out ended the crew");
    });

    test("gifts: each kind once a day; points never more than the giver has left; a gift outlives its crew", async () => {
      const { resident } = await claim();
      await fx.crews.create({ residentId: resident.id, name: "Gifts", colour: "rose", invite: invite(), now: T });
      const day = "2026-10-29";
      assert.deepEqual(await fx.crews.gift({ residentId: resident.id, kind: "module", module: "roof.flat", points: 0, units: 25, day, now: T }), { ok: true });
      assert.deepEqual(await fx.crews.gift({ residentId: resident.id, kind: "module", module: "base.stone", points: 0, units: 25, day, now: T }), { ok: false, error: "today" });
      assert.deepEqual(await fx.crews.gift({ residentId: resident.id, kind: "points", module: null, points: 10, units: 10, day, now: T }), { ok: false, error: "points" });
      await fx.world.award({ residentId: resident.id, reason: "task_done", delta: 30, sourceRef: "t", key: `k:${resident.id}`, now: T });
      assert.deepEqual(await fx.crews.gift({ residentId: resident.id, kind: "points", module: null, points: 20, units: 20, day, now: T }), { ok: true });
      const mine = await fx.crews.mine({ residentId: resident.id, day, since: week });
      assert.deepEqual([mine.units, mine.given, mine.me.pointsTotal, mine.me.pointsGiven, mine.me.gave], [45, ["roof.flat"], 30, 20, { module: true, points: true }]);
      assert.deepEqual(mine.actions.filter((a) => a.kind === "gift").length, 2);
      const tomorrow = "2026-10-30";
      assert.deepEqual(await fx.crews.gift({ residentId: resident.id, kind: "points", module: null, points: 11, units: 11, day: tomorrow, now: T }), { ok: false, error: "points" });
      // Out and back in a new crew: what was given stays given.
      await fx.crews.leave({ residentId: resident.id, now: T });
      await fx.crews.create({ residentId: resident.id, name: "Again", colour: "lime", invite: invite(), now: T });
      assert.deepEqual(await fx.crews.gift({ residentId: resident.id, kind: "points", module: null, points: 11, units: 11, day: tomorrow, now: T }), { ok: false, error: "points" });
      assert.deepEqual(await fx.crews.gift({ residentId: resident.id, kind: "points", module: null, points: 10, units: 10, day: tomorrow, now: T }), { ok: true });
      assert.deepEqual(await fx.crews.gift({ residentId: resident.id, kind: "module", module: "roof.flat", points: 0, units: 25, day, now: T }), { ok: false, error: "today" });
    });

    test("the week's actions are the members' builds and visits and the crew's gifts", async () => {
      const { resident, quarter } = await claim();
      await fx.crews.create({ residentId: resident.id, name: "Act", colour: "pearl", invite: invite(), now: T });
      const state = await fx.world.quarter(quarter.id);
      await fx.world.commitBuild({ residentId: resident.id, quarterId: quarter.id, version: state.quarter.version, slot: 1, kind: "home", level: 1, modules: ["base.stone"], day: "2026-10-29", progress: [], taskPoints: 10, now: T });
      const mine = await fx.crews.mine({ residentId: resident.id, day: "2026-10-29", since: week });
      assert.deepEqual(mine.actions.map((a) => [a.residentId, a.day, a.kind]), [[resident.id, "2026-10-29", "build"]]);
      const later = await fx.crews.mine({ residentId: resident.id, day: "2026-10-29", since: new Date("2026-11-02T00:00:00Z") });
      assert.deepEqual(later.actions, []);
    });

    if (name === "postgres") {
      test("the secret is required and the browser roles read no crew table", async () => {
        const wrong = await fx.db.rpc("world_crew_streets", {}, "not-the-secret");
        assert.equal(wrong.ok, false);
        for (const role of ["anon", "authenticated"]) {
          await fx.db.client.query(`set role ${role}`);
          for (const table of ["private.world_crews", "private.world_crew_members", "private.world_crew_gifts"]) await assert.rejects(fx.db.client.query(`select * from ${table}`));
          await fx.db.client.query("reset role");
        }
      });
    }
  });
}

suite("memory", memoryFixture);
suite("postgres", pgFixture, !process.env.WORLD_TEST_DATABASE_URL);
