// Run from repo root: node --test city/lib/quarter/contract.test.mjs
import "../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { createWorldApi, WorldLimiter } = await import("../../../lib/world/api.ts");
const { MemoryWorldStore } = await import("../../../lib/world/memory-store.ts");
const { createHttpWorld } = await import("./http.ts");
const { createMockWorld } = await import("./mock.ts");
const { moduleById } = await import("./modules.ts");
const { WorldError } = await import("./types.ts");

/**
 * The city's client against the world's own server, in this process: the real routes of /api/world over the
 * memory store, the guest's key kept in a cookie jar like a browser keeps it. Every answer the screens read is
 * parsed, every refusal becomes a WorldError with its code, and the mock this device uses answers the same moves
 * with the same shapes, versions, tasks and points.
 */

const SITE = "https://ryntra.io";
const NOW = Date.parse("2026-10-27T10:00:00.000Z");

function server() {
  const api = createWorldApi({
    store: new MemoryWorldStore(),
    secret: () => "test-secret",
    now: () => new Date(NOW),
    limiter: new WorldLimiter(),
    account: async () => ({ status: "absent" }),
    wallet: async () => ({ status: "absent" }),
    verifyLink: async () => "owned",
  });
  const jar = { rwg: null };
  const fetch = async (url, init) => {
    const u = new URL(url, SITE);
    const headers = new Headers(init.headers);
    headers.set("origin", SITE);
    headers.set("x-forwarded-for", "198.51.100.7");
    if (jar.rwg) headers.set("cookie", `rwg=${jar.rwg}`);
    const [name, id] = u.pathname.replace(/^\/api\/world\//, "").split("/");
    const req = new Request(u, { method: init.method, headers, body: init.body });
    const res = id ? await api[name](req, decodeURIComponent(id)) : await api[name](req);
    const cookie = res.headers.get("set-cookie");
    if (cookie?.startsWith("rwg=")) jar.rwg = cookie.slice(4, cookie.indexOf(";")) || null;
    return res;
  };
  return createHttpWorld({ fetch });
}

const mock = () => createMockWorld({ storage: null, now: () => new Date(NOW) });

const HOME = moduleById("home");
const LAMP = moduleById("lamp");
const build = (quarter, slot, def, version = quarter.version) => ({ quarterId: quarter.id, slot, kind: def.kind, modules: [...def.modules], version });

async function refused(promise, status, code, more = {}) {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof WorldError, `a WorldError, not ${e}`);
    assert.equal(e.status, status);
    assert.equal(e.code, code);
    for (const [k, v] of Object.entries(more)) assert.deepEqual(e[k], v, k);
    return true;
  });
}

/** A day of the quarter, the same on both worlds: what the screens would see after each step. */
async function day(world) {
  const seen = [];
  seen.push(["newcomer", await world.me()]);
  const claimed = await world.claim();
  seen.push(["claim", { created: claimed.created, district: claimed.quarter.district, street: claimed.quarter.street, level: claimed.quarter.level, version: claimed.quarter.version }]);
  const again = await world.claim();
  seen.push(["again", { created: again.created, same: again.quarter.id === claimed.quarter.id }]);
  const me = await world.me();
  seen.push(["me", { buildings: me.buildings, points: me.points.total, tasks: me.tasks.map((t) => [t.kind, t.progress, t.goal]) }]);
  const home = await world.build(build(me.quarter, 1, HOME));
  seen.push(["home", { version: home.quarter.version, building: [home.building.slot, home.building.kind, home.building.level, home.building.modules], points: home.points.total, tasks: home.tasks.map((t) => [t.kind, t.progress]) }]);
  const lamp = await world.build(build(home.quarter, 0, LAMP), "lamp-tap-1");
  seen.push(["lamp", { version: lamp.quarter.version, building: [lamp.building.kind, lamp.building.modules], points: lamp.points.total, light: lamp.tasks.find((t) => t.kind === "light_street") }]);
  const retry = await world.build(build(home.quarter, 0, LAMP), "lamp-tap-1");
  seen.push(["retry", { same: retry.quarter.version === lamp.quarter.version && retry.building.id === lamp.building.id }]);
  const after = await world.me();
  seen.push(["after", { buildings: after.buildings.map((b) => [b.slot, b.kind, b.level]), points: after.points.total, level: after.quarter.level }]);
  const read = await world.quarter(after.quarter.id);
  seen.push(["public", read.buildings.map((b) => [b.slot, b.kind])]);
  const district = await world.district("arrivals");
  seen.push(["district", { mine: district.quarters.some((q) => q.id === after.quarter.id), next: district.nextCursor }]);
  return { seen, quarter: after.quarter };
}

/** Ids and times differ between worlds; what a person sees does not. */
const plain = (value) => JSON.parse(JSON.stringify(value, (k, v) => (["id", "quarterId", "ownerId", "residentId", "updatedAt", "doneAt", "day", "at", "createdAt", "homeQuarterId"].includes(k) ? undefined : v)));

describe("the city's client on the world's server", () => {
  test("a newcomer is null, a claim makes a quarter on the newcomers' street, building moves the version", async () => {
    const world = server();
    const { seen } = await day(world);
    const get = (name) => seen.find(([n]) => n === name)[1];
    assert.equal(get("newcomer"), null);
    assert.deepEqual(get("claim"), { created: true, district: "arrivals", street: "arrivals-1", level: 1, version: 1 });
    assert.deepEqual(get("again"), { created: false, same: true });
    assert.deepEqual(get("me").buildings, []);
    assert.deepEqual(get("home").building, [1, "home", 1, ["base.stone", "roof.flat"]]);
    assert.equal(get("home").version, 2);
    assert.deepEqual(get("lamp").building, ["decor", ["base.stone", "light.amber"]]);
    assert.equal(get("lamp").points, 10, "lighting the street is the day's task and pays its points");
    assert.equal(get("lamp").light.doneAt !== null, true);
    assert.deepEqual(get("retry"), { same: true }, "the same key builds once");
    assert.deepEqual(get("after").buildings, [[0, "decor", 1], [1, "home", 1]]);
    assert.deepEqual(get("public"), [[0, "decor"], [1, "home"]]);
    assert.deepEqual(get("district"), { mine: true, next: null });
  });

  test("refusals carry the world's code, the reason, the level that opens it, and the quarter as it is now", async () => {
    const world = server();
    const { quarter } = await world.claim();
    await world.build(build(quarter, 1, HOME));
    await refused(world.build(build(quarter, 0, LAMP, 1)), 409, "VERSION_CONFLICT");
    const stale = await world.build(build(quarter, 0, LAMP, 1)).catch((e) => e);
    assert.equal(stale.current.quarter.version, 2, "the conflict brings the quarter's current version");
    assert.deepEqual(stale.current.buildings.map((b) => b.kind), ["home"]);
    const now = stale.current.quarter;
    await refused(world.build(build(now, 4, LAMP)), 422, "LOCKED", { reason: "slot", need: { quarterLevel: 3 } });
    await refused(world.build(build(now, 2, HOME)), 422, "LOCKED", { reason: "limit" });
    await refused(world.build(build(now, 2, moduleById("harbor"))), 422, "LOCKED", { reason: "kind", need: { quarterLevel: 2 } });
    await refused(world.build({ ...build(now, 2, LAMP), modules: ["home.cabin"] }), 400, "UNKNOWN_MODULE");
    await refused(world.link({ quarterId: now.id, slot: 1, link: null, version: now.version }), 401, "WALLET_REQUIRED");
    await refused(world.quarter("00000000-0000-4000-8000-000000000000"), 404, "NOT_FOUND");
  });

  test("a write without a resident is refused as no resident", async () => {
    const world = server();
    await refused(world.build({ quarterId: "00000000-0000-4000-8000-000000000000", slot: 1, kind: "home", modules: ["base.stone"], version: 1 }), 401, "NO_RESIDENT");
  });
});

describe("the mock answers like the server", () => {
  test("the same day gives the same answers, ids and times aside", async () => {
    const onServer = await day(server());
    const onDevice = await day(mock());
    assert.deepEqual(plain(onDevice.seen), plain(onServer.seen));
  });

  test("and the same refusals", async () => {
    const worlds = [server(), mock()];
    const codes = [];
    for (const world of worlds) {
      const { quarter } = await world.claim();
      await world.build(build(quarter, 1, HOME));
      const got = [];
      for (const attempt of [build(quarter, 0, LAMP, 1), build({ ...quarter, version: 2 }, 4, LAMP), build({ ...quarter, version: 2 }, 2, HOME), build({ ...quarter, version: 2 }, 2, moduleById("harbor"))]) {
        const e = await world.build(attempt).catch((err) => err);
        got.push([e.status, e.code, e.reason, e.need]);
      }
      const reused = await world.build(build({ ...quarter, version: 2 }, 0, LAMP), "same-key-1").then(() => world.build(build({ ...quarter, version: 3 }, 2, LAMP), "same-key-1")).catch((err) => err);
      got.push([reused.status, reused.code]);
      codes.push(got);
    }
    assert.deepEqual(codes[1], codes[0]);
  });
});
