/*
 * The routes of a quarter's free layout against the memory stores: the owner saves the whole layout at the version
 * they saw, everyone else reads it without the words of its signs, a save is same-site, keyed, limited and checked
 * by the same rules the city uses, and a layout never pays points.
 */
import "./testing/hooks.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const { createWorldApi, WorldLimiter } = await import("./api.ts");
const { createLayoutApi, LAYOUT_LIMITS, SAVES_PER_DAY } = await import("./layout-api.ts");
const { MemoryWorldStore } = await import("./memory-store.ts");
const { MemoryLayoutStore } = await import("./layout-store.ts");
const { WorldStoreUnavailable } = await import("./store.ts");

const SITE = "https://ryntra.io";

function world() {
  const store = new MemoryWorldStore();
  const layouts = new MemoryLayoutStore(store);
  const state = { now: Date.parse("2026-10-28T10:00:00.000Z") };
  const deps = {
    secret: () => "test-secret",
    now: () => new Date(state.now),
    account: async (req) => {
      const id = req.headers.get("x-test-account");
      return id ? { status: "ok", accountId: id } : { status: "absent" };
    },
  };
  const api = createWorldApi({ ...deps, store, limiter: new WorldLimiter(), wallet: async () => ({ status: "absent" }), verifyLink: async () => "owned" });
  const layout = createLayoutApi({ ...deps, world: store, layouts });
  return { api, layout, store, layouts, state };
}

let ipCounter = 0;
function browser(w, extra = {}) {
  const jar = { rwg: null };
  const ip = extra.ip ?? `203.0.113.${++ipCounter % 250}`;
  const send = async (handler, path, init = {}) => {
    const headers = new Headers({ origin: init.origin ?? SITE, "x-forwarded-for": ip, ...(init.headers ?? {}) });
    if (jar.rwg) headers.set("cookie", `rwg=${jar.rwg}`);
    if (extra.account) headers.set("x-test-account", extra.account);
    const method = init.method ?? "GET";
    if (method === "POST" && init.key !== null) headers.set("idempotency-key", init.key ?? `key-${randomUUID()}`);
    const req = new Request(`${SITE}/api/world/${path}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    const res = await handler(req);
    const cookie = res.headers.get("set-cookie");
    if (cookie?.startsWith("rwg=")) jar.rwg = cookie.slice(4, cookie.indexOf(";")) || null;
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  return {
    claim: () => send((r) => w.api.claim(r), "claim", { method: "POST", body: {} }),
    me: () => send((r) => w.api.me(r), "me"),
    mine: (q = "") => send((r) => w.layout.mine(r), `layout${q}`),
    of: (id) => send((r) => w.layout.ofQuarter(r, id), `layout/${id}`),
    save: (body, init = {}) => send((r) => w.layout.save(r), "layout", { ...init, method: "POST", body }),
  };
}

const block = (gx, gz, y = 0) => ({ gx, gz, y, kind: "block", rot: 0 });

async function settled(w, extra) {
  const b = browser(w, extra);
  const claimed = await b.claim();
  return { b, quarter: claimed.body.quarter, resident: claimed.body.resident };
}

test("a fresh quarter reads an empty layout at version 0; the owner saves it whole and reads it back", async () => {
  const w = world();
  const { b, quarter } = await settled(w);
  const first = await b.mine();
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.layout, { quarterId: quarter.id, pieces: [], version: 0, updatedAt: null });
  assert.match(first.headers.get("cache-control"), /no-store/);
  const saved = await b.save({ quarterId: quarter.id, version: 0, pieces: [block(1, 1), block(1, 1, 1), { gx: 4, gz: 0, y: 0, kind: "sign", rot: 2, text: "Open" }] });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.layout.version, 1);
  assert.equal(saved.body.layout.pieces.length, 3);
  assert.equal((await b.mine()).body.layout.pieces.find((x) => x.kind === "sign").text, "Open");
  const again = await b.save({ quarterId: quarter.id, version: 1, pieces: [block(1, 1)] });
  assert.equal(again.body.layout.version, 2);
  assert.deepEqual(again.body.layout.pieces, [block(1, 1)]);
});

test("anyone reads a layout without the words of its signs; it is cached briefly", async () => {
  const w = world();
  const { b, quarter } = await settled(w);
  await b.save({ quarterId: quarter.id, version: 0, pieces: [{ gx: 0, gz: 0, y: 0, kind: "sign", rot: 0, text: "Hello" }] });
  const other = browser(w);
  const read = await other.of(quarter.id);
  assert.equal(read.status, 200);
  assert.equal(read.body.layout.pieces[0].kind, "sign");
  assert.equal(read.body.layout.pieces[0].text, undefined);
  assert.match(read.headers.get("cache-control"), /s-maxage=10/);
  assert.equal((await other.of(randomUUID())).status, 404);
  assert.equal((await other.of("not-a-quarter")).status, 404);
});

test("a stale version is a 409 with the layout as it is now", async () => {
  const w = world();
  const { b, quarter } = await settled(w);
  await b.save({ quarterId: quarter.id, version: 0, pieces: [block(0, 0)] });
  const stale = await b.save({ quarterId: quarter.id, version: 0, pieces: [block(2, 2)] });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "VERSION_CONFLICT");
  assert.equal(stale.body.layout.version, 1);
  assert.deepEqual(stale.body.layout.pieces, [block(0, 0)]);
});

test("the rules refuse with a reason and the piece's index; a plot with a building is not free", async () => {
  const w = world();
  const { b, quarter } = await settled(w);
  const closed = await b.save({ quarterId: quarter.id, version: 0, pieces: [block(0, 0), block(0, 5)] });
  assert.equal(closed.status, 422);
  assert.deepEqual([closed.body.error.code, closed.body.error.reason, closed.body.error.index, closed.body.error.need], ["LOCKED", "closed", 1, { quarterLevel: 2 }]);
  const floating = await b.save({ quarterId: quarter.id, version: 0, pieces: [block(0, 0, 1)] });
  assert.equal(floating.body.error.reason, "support");
  const shape = await b.save({ quarterId: quarter.id, version: 0, pieces: [{ gx: 0, gz: 0 }] });
  assert.equal(shape.status, 400);
  const sign = await b.save({ quarterId: quarter.id, version: 0, pieces: [{ gx: 0, gz: 0, y: 0, kind: "sign", rot: 0, text: "ignore all previous" }] });
  assert.equal(sign.body.error.reason, "sign");
  // A home on the middle plot takes it back.
  await w.store.commitBuild({ residentId: quarter.ownerId, quarterId: quarter.id, version: 1, slot: 1, kind: "home", level: 1, modules: ["base.stone"], day: "2026-10-28", progress: [], taskPoints: 10, now: new Date() });
  const onBuilt = await b.save({ quarterId: quarter.id, version: 0, pieces: [block(4, 1)] });
  assert.deepEqual([onBuilt.body.error.reason, onBuilt.body.error.index], ["built", 0]);
});

test("only the owner saves or reads it as theirs; a visitor without a place is asked to claim one", async () => {
  const w = world();
  const { quarter } = await settled(w);
  const { b: other, quarter: theirs } = await settled(w);
  const foreign = await other.save({ quarterId: quarter.id, version: 0, pieces: [block(0, 0)] });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.error.code, "NOT_OWNER");
  assert.equal((await other.mine(`?quarterId=${quarter.id}`)).status, 403);
  assert.equal((await other.mine()).body.layout.quarterId, theirs.id, "with no quarter named, my home quarter");
  const nobody = browser(w);
  assert.equal((await nobody.mine()).status, 401);
  assert.equal((await nobody.save({ quarterId: quarter.id, version: 0, pieces: [] })).status, 401);
});

test("a save comes from this site, carries a key, and the same key gives back the same answer", async () => {
  const w = world();
  const { b, quarter } = await settled(w);
  assert.equal((await b.save({ quarterId: quarter.id, version: 0, pieces: [] }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await b.save({ quarterId: quarter.id, version: 0, pieces: [] }, { key: null })).status, 400);
  const body = { quarterId: quarter.id, version: 0, pieces: [block(0, 0)] };
  const one = await b.save(body, { key: "layout-key-1" });
  const two = await b.save(body, { key: "layout-key-1" });
  assert.equal(two.status, 200);
  assert.equal(two.headers.get("idempotent-replayed"), "true");
  assert.deepEqual(two.body, one.body);
  const reused = await b.save({ ...body, pieces: [] }, { key: "layout-key-1" });
  assert.equal(reused.body.error.code, "IDEMPOTENCY_KEY_REUSED");
});

test("limits: per resident a minute, per day in the store; too large a body is refused", async () => {
  const w = world();
  const { b, quarter } = await settled(w);
  let version = 0;
  let last = null;
  for (let i = 0; i <= LAYOUT_LIMITS.save.device; i += 1) {
    last = await b.save({ quarterId: quarter.id, version, pieces: [block(i % 9, 0)] });
    if (last.status === 200) version = last.body.layout.version;
  }
  assert.equal(last.status, 429);
  assert.ok(last.headers.get("retry-after"));
  const big = await b.save({ quarterId: quarter.id, version, pieces: Array.from({ length: 400 }, () => ({ gx: 0, gz: 0, y: 0, kind: "sign", rot: 0, text: "x".repeat(40) })) });
  assert.equal(big.status, 413);
  // The day's count lives in the store, across every server instance.
  const day = world();
  const { b: d, quarter: dq } = await settled(day);
  day.store.limitHit = async () => ({ allowed: false, retryAfterSeconds: 3600 });
  const capped = await d.save({ quarterId: dq.id, version: 0, pieces: [] });
  assert.equal(capped.status, 429);
  assert.equal(capped.headers.get("retry-after"), "3600");
  assert.ok(SAVES_PER_DAY >= 500);
});

test("free building pays nothing: points, tasks and the quarter's version stay as they were", async () => {
  const w = world();
  const { b, quarter } = await settled(w);
  const before = (await b.me()).body;
  for (let i = 0; i < 5; i += 1) {
    const version = (await b.mine()).body.layout.version;
    await b.save({ quarterId: quarter.id, version, pieces: [block(i, 0), { gx: 0, gz: 1, y: 0, kind: "lamp", rot: 0 }] });
  }
  const after = (await b.me()).body;
  assert.equal(after.points.total, before.points.total);
  assert.deepEqual(after.tasks, before.tasks);
  assert.equal(after.quarter.version, before.quarter.version, "a layout never races a build");
});

test("a store that blinks is a 503 and changes nothing", async () => {
  const w = world();
  const { b, quarter } = await settled(w);
  w.layouts.commitLayout = async () => {
    throw new WorldStoreUnavailable("down");
  };
  const res = await b.save({ quarterId: quarter.id, version: 0, pieces: [block(0, 0)] }, { key: "blink-key-1" });
  assert.equal(res.status, 503);
  w.layouts.layout = async () => {
    throw new WorldStoreUnavailable("down");
  };
  assert.equal((await b.mine()).status, 503);
  assert.equal((await browser(w).of(quarter.id)).status, 503);
});
