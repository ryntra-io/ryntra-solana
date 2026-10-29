/*
 * Every route of /api/world against the memory store: who may do what, the
 * guest key and its joining an account, limits, Idempotency-Key, 409 with the
 * quarter as it is now, 422 with the reason, and what anyone may read.
 */
import "./testing/hooks.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";

const { createWorldApi, WorldLimiter, LIMITS, NEW_GUESTS_PER_HOUR } = await import("./api.ts");
const { MemoryWorldStore } = await import("./memory-store.ts");
const { WorldStoreUnavailable } = await import("./store.ts");
const { freezeWorldVersion, recordWorldEvent } = await import("./award.ts");
const { guestKey } = await import("./guest.ts");

const SITE = "https://ryntra.io";
const MINT = "So11111111111111111111111111111111111111112";
const WALLET = "4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n";

/** A world with a settable clock, accounts, wallets and engine answers. */
function world(options = {}) {
  const store = options.store ?? new MemoryWorldStore();
  const state = { now: Date.parse("2026-10-27T10:00:00.000Z"), verdict: "owned", accountDown: false, verified: [] };
  const api = createWorldApi({
    store,
    secret: () => ("secret" in options ? options.secret : "test-secret"),
    now: () => new Date(state.now),
    limiter: new WorldLimiter(),
    account: async (req) => {
      if (state.accountDown) return { status: "unavailable" };
      const id = req.headers.get("x-test-account");
      return id ? { status: "ok", accountId: id } : { status: "absent" };
    },
    wallet: async (req) => {
      const address = req.headers.get("x-test-wallet");
      return address === "down" ? { status: "unavailable" } : address ? { status: "ok", address } : { status: "absent" };
    },
    verifyLink: async (input) => {
      state.verified.push(input);
      return state.verdict;
    },
  });
  return { api, store, state };
}

let ipCounter = 0;
/** One browser: it keeps the cookie the world sets and sends it back. */
function browser(w, extra = {}) {
  const jar = { rwg: null };
  const ip = extra.ip ?? `198.51.100.${++ipCounter % 250}`;
  const send = async (route, init = {}) => {
    const headers = new Headers({ origin: SITE, "x-forwarded-for": ip, ...(init.headers ?? {}) });
    if (jar.rwg) headers.set("cookie", `other=1; rwg=${jar.rwg}`);
    if (extra.account) headers.set("x-test-account", extra.account);
    if (extra.wallet) headers.set("x-test-wallet", extra.wallet);
    const method = init.method ?? "GET";
    if (method === "POST" && !headers.has("idempotency-key") && init.key !== null) headers.set("idempotency-key", init.key ?? `key-${randomUUID()}`);
    const req = new Request(`${SITE}/api/world/${route}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    const [name, id] = route.split("?")[0].split("/");
    const res = id ? await w.api[name](req, id) : await w.api[name](req);
    const cookie = res.headers.get("set-cookie");
    if (cookie?.startsWith("rwg=")) jar.rwg = cookie.slice(4, cookie.indexOf(";")) || null;
    return { status: res.status, body: await res.json(), headers: res.headers, cookie };
  };
  return {
    jar,
    get: (route, init = {}) => send(route, init),
    post: (route, body, init = {}) => send(route, { ...init, method: "POST", body }),
  };
}

async function settled(w, extra) {
  const b = browser(w, extra);
  const claimed = await b.post("claim", {});
  return { b, resident: claimed.body.resident, quarter: claimed.body.quarter };
}

describe("POST /api/world/claim", () => {
  test("a newcomer gets a guest, a quarter on the newcomers' street and an HttpOnly key", async () => {
    const w = world();
    const b = browser(w);
    const res = await b.post("claim", { displayName: "Ann" });
    assert.equal(res.status, 201);
    assert.equal(res.body.created, true);
    assert.equal(res.body.resident.accountId, null);
    assert.equal(res.body.resident.displayName, "Ann");
    assert.equal(res.body.quarter.district, "arrivals");
    assert.match(res.cookie, /^rwg=v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure$/);
    assert.equal(res.body.resident.guestSalt, undefined, "the salt never leaves the server");
    assert.match(res.headers.get("cache-control"), /no-store/);
    const again = await b.post("claim", {});
    assert.equal(again.status, 200);
    assert.equal(again.body.created, false);
    assert.equal(again.body.quarter.id, res.body.quarter.id);
  });

  test("a retried claim whose answer was lost gives back the same place and the same key", async () => {
    const w = world();
    const first = browser(w, { ip: "203.0.113.7" });
    const lost = await first.post("claim", {}, { key: "claim-key-0001" });
    const retry = browser(w, { ip: "203.0.113.7" });
    const res = await retry.post("claim", {}, { key: "claim-key-0001" });
    assert.equal(res.status, 201);
    assert.equal(res.headers.get("idempotent-replayed"), "true");
    assert.equal(res.body.resident.id, lost.body.resident.id);
    assert.equal(retry.jar.rwg, first.jar.rwg);
    const other = await browser(w, { ip: "203.0.113.7" }).post("claim", { displayName: "Bob" }, { key: "claim-key-0001" });
    assert.equal(other.status, 422);
    assert.equal(other.body.error.code, "IDEMPOTENCY_KEY_REUSED");
  });

  test("a write needs this site, a key and a sane body", async () => {
    const w = world();
    const b = browser(w);
    assert.equal((await b.post("claim", {}, { key: null })).body.error.code, "IDEMPOTENCY_KEY_REQUIRED");
    assert.equal((await b.post("claim", {}, { key: "short" })).status, 400);
    const cross = await b.post("claim", {}, { headers: { origin: "https://evil.example" } });
    assert.equal(cross.status, 403);
    assert.equal(cross.body.error.code, "FORBIDDEN");
    assert.equal((await b.post("claim", { displayName: "<script>" })).status, 400);
    assert.equal((await b.post("claim", { displayName: "x".repeat(5000) })).status, 413);
    assert.equal((await b.post("claim", [1, 2])).status, 400);
  });

  test("without the server secret no guest is made", async () => {
    const w = world({ secret: null });
    const res = await browser(w).post("claim", {});
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, "UNAVAILABLE");
  });

  test("a signed-in account claims for itself, without a guest key", async () => {
    const w = world();
    const account = randomUUID();
    w.store.accounts.add(account);
    const b = browser(w, { account });
    const res = await b.post("claim", {});
    assert.equal(res.status, 201);
    assert.equal(res.body.resident.accountId, account);
    assert.equal(res.cookie, null);
    assert.equal((await b.post("claim", {})).status, 200);
  });

  test("new guests are limited per address per minute and per hour", async () => {
    const w = world();
    const ip = "192.0.2.77";
    let last;
    for (let i = 0; i <= LIMITS.claim.ip; i += 1) last = await browser(w, { ip }).post("claim", {});
    assert.equal(last.status, 429);
    assert.equal(last.body.error.code, "RATE_LIMITED");
    assert.ok(Number(last.headers.get("retry-after")) > 0);
    let made = LIMITS.claim.ip;
    let hourly;
    for (let minute = 1; made <= NEW_GUESTS_PER_HOUR; minute += 1) {
      w.state.now += 60_000;
      hourly = await browser(w, { ip }).post("claim", {});
      made += 1;
    }
    assert.equal(hourly.status, 429, "the database counts new guests per hour across instances");
  });

  test("a forged or stale key is dropped and the browser told to forget it", async () => {
    const w = world();
    const { b, resident } = await settled(w);
    b.jar.rwg = `v1.${resident.id}.${"A".repeat(43)}`;
    const res = await b.get("me");
    assert.equal(res.status, 401);
    assert.match(res.cookie, /^rwg=; Path=\/; Max-Age=0/);
  });
});

describe("GET /api/world/me", () => {
  test("nobody yet: claim first", async () => {
    const res = await browser(world()).get("me");
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "NO_RESIDENT");
  });

  test("a guest sees the resident, the home quarter, points and the day's three tasks", async () => {
    const w = world();
    const { b, resident, quarter } = await settled(w);
    const res = await b.get("me");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control"), /private, no-store/);
    assert.equal(res.body.resident.id, resident.id);
    assert.equal(res.body.quarter.id, quarter.id);
    assert.deepEqual(res.body.quarters.map((q) => q.id), [quarter.id]);
    assert.deepEqual(res.body.points, { total: 0, recent: [] });
    assert.deepEqual(res.body.tasks.map((t) => [t.kind, t.progress, t.goal, t.day]), [
      ["add_floor", 0, 1, "2026-10-27"], ["light_street", 0, 1, "2026-10-27"], ["visit_quarters", 0, 3, "2026-10-27"],
    ]);
  });

  test("after a wallet sign-in the guest joins the account: same quarter, key cleared and dead", async () => {
    const w = world();
    const { b, resident, quarter } = await settled(w);
    const account = randomUUID();
    w.store.accounts.add(account);
    const key = b.jar.rwg;
    const signedIn = browser(w, { account });
    signedIn.jar.rwg = key;
    const res = await signedIn.get("me");
    assert.equal(res.status, 200);
    assert.equal(res.body.resident.id, resident.id);
    assert.equal(res.body.resident.accountId, account);
    assert.equal(res.body.quarter.id, quarter.id);
    assert.match(res.cookie, /^rwg=; Path=\/; Max-Age=0/);
    const oldKey = browser(w);
    oldKey.jar.rwg = key;
    assert.equal((await oldKey.get("me")).status, 401, "the guest key stops working the moment it joins");
  });

  test("a store or a session store that does not answer is 503, never a signed-out person", async () => {
    const broken = new MemoryWorldStore();
    broken.me = async () => { throw new WorldStoreUnavailable(); };
    const w = world({ store: broken });
    const { b } = await settled(w);
    assert.equal((await b.get("me")).status, 503);
    const w2 = world();
    const { b: b2 } = await settled(w2);
    w2.state.accountDown = true;
    assert.equal((await b2.get("me")).status, 503);
  });
});

describe("GET /api/world/quarter/:id and /district/:id", () => {
  test("anyone reads a quarter and its buildings, cached briefly", async () => {
    const w = world();
    const { b, quarter } = await settled(w);
    await b.post("build", { quarterId: quarter.id, slot: 0, kind: "home", modules: ["base.stone"], version: 1 });
    const res = await browser(w).get(`quarter/${quarter.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.quarter.id, quarter.id);
    assert.equal(res.body.buildings.length, 1);
    assert.match(res.headers.get("cache-control"), /public/);
    assert.equal((await browser(w).get("quarter/nope")).status, 404);
    assert.equal((await browser(w).get(`quarter/${randomUUID()}`)).body.error.code, "NOT_FOUND");
  });

  test("a district reads in pages; an unknown district or cursor is refused", async () => {
    const w = world();
    for (let i = 0; i < 3; i += 1) await settled(w);
    const res = await browser(w).get("district/arrivals");
    assert.equal(res.status, 200);
    assert.equal(res.body.district, "arrivals");
    assert.equal(res.body.quarters.length, 3);
    assert.equal(res.body.nextCursor, null);
    const after = await browser(w).get(`district/arrivals?cursor=${res.body.quarters[0].id}`);
    assert.equal(after.body.quarters.length, 2);
    assert.equal((await browser(w).get("district/moon")).status, 404);
    assert.equal((await browser(w).get("district/arrivals?cursor=zzz")).status, 400);
  });
});

describe("POST /api/world/build", () => {
  test("the owner builds at the version seen; a floor and a light finish two tasks and pay once each", async () => {
    const w = world();
    const { b, quarter } = await settled(w);
    const res = await b.post("build", { quarterId: quarter.id, slot: 0, kind: "home", modules: ["light.amber", "floor.glass", "base.stone"], version: 1 });
    assert.equal(res.status, 200);
    assert.equal(res.body.quarter.version, 2);
    assert.deepEqual(res.body.building.modules, ["base.stone", "floor.glass", "light.amber"], "kept in one order");
    assert.equal(res.body.building.level, 2);
    assert.equal(res.body.points.total, 20);
    assert.deepEqual(res.body.tasks.map((t) => [t.kind, t.progress, t.doneAt !== null]), [["add_floor", 1, true], ["light_street", 1, true], ["visit_quarters", 0, false]]);
    const more = await b.post("build", { quarterId: quarter.id, slot: 1, kind: "decor", modules: ["base.stone", "floor.glass"], version: 2 });
    assert.equal(more.body.points.total, 20, "the same task on the same day pays once");
  });

  test("a stale version is 409 with the quarter and buildings as they are now", async () => {
    const w = world();
    const { b, quarter } = await settled(w);
    await b.post("build", { quarterId: quarter.id, slot: 0, kind: "home", modules: ["base.stone"], version: 1 });
    const res = await b.post("build", { quarterId: quarter.id, slot: 1, kind: "decor", modules: ["base.stone"], version: 1 });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "VERSION_CONFLICT");
    assert.equal(res.body.quarter.version, 2);
    assert.equal(res.body.buildings[0].kind, "home");
  });

  test("a closed module, slot, building or level is 422 with the reason and what opens it", async () => {
    const w = world();
    const { b, quarter } = await settled(w);
    const at = (slot, kind, modules) => b.post("build", { quarterId: quarter.id, slot, kind, modules, version: 1 });
    const cases = [
      [await at(0, "home", ["base.steel"]), "module", 4],
      [await at(5, "home", ["base.stone"]), "slot", 4],
      [await at(0, "garage", ["base.stone"]), "kind", 3],
      [await at(0, "home", ["base.stone", "floor.glass", "floor.glass"]), "level", 3],
    ];
    for (const [res, reason, level] of cases) {
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, "LOCKED");
      assert.equal(res.body.error.reason, reason);
      assert.equal(res.body.error.need.quarterLevel, level);
    }
    assert.equal(cases[0][0].body.error.module, "base.steel");
    await at(0, "home", ["base.stone"]);
    const second = await b.post("build", { quarterId: quarter.id, slot: 1, kind: "home", modules: ["base.stone"], version: 2 });
    assert.equal(second.body.error.reason, "limit");
    const unknown = await b.post("build", { quarterId: quarter.id, slot: 1, kind: "decor", modules: ["base.gold"], version: 2 });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error.code, "UNKNOWN_MODULE");
    assert.equal((await b.post("build", { quarterId: quarter.id, slot: 1, kind: "decor", modules: ["floor.glass"], version: 2 })).status, 400, "no base");
  });

  test("only the owner builds; nobody without a place builds at all", async () => {
    const w = world();
    const { quarter } = await settled(w);
    const { b: other } = await settled(w);
    const res = await other.post("build", { quarterId: quarter.id, slot: 0, kind: "home", modules: ["base.stone"], version: 1 });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, "NOT_OWNER");
    const nobody = await browser(w).post("build", { quarterId: quarter.id, slot: 0, kind: "home", modules: ["base.stone"], version: 1 });
    assert.equal(nobody.status, 401);
    assert.equal((await other.post("build", { quarterId: randomUUID(), slot: 0, kind: "home", modules: ["base.stone"], version: 1 })).status, 404);
  });

  test("the same Idempotency-Key replays the answer without building twice", async () => {
    const w = world();
    const { b, quarter } = await settled(w);
    const body = { quarterId: quarter.id, slot: 0, kind: "home", modules: ["base.stone"], version: 1 };
    const first = await b.post("build", body, { key: "build-key-0001" });
    const again = await b.post("build", body, { key: "build-key-0001" });
    assert.equal(again.status, 200);
    assert.equal(again.headers.get("idempotent-replayed"), "true");
    assert.deepEqual(again.body, first.body);
    assert.equal((await browser(w).get(`quarter/${quarter.id}`)).body.quarter.version, 2);
  });

  test("a resident is limited per minute across addresses", async () => {
    const w = world();
    const { b, quarter } = await settled(w);
    let res;
    for (let i = 0; i <= LIMITS.build.device; i += 1) res = await b.post("build", { quarterId: quarter.id, slot: 0, kind: "home", modules: ["base.stone"], version: 1 + i });
    assert.equal(res.status, 429);
  });
});

describe("POST /api/world/link", () => {
  async function tower(w, extra) {
    const s = await settled(w, extra);
    await s.b.post("build", { quarterId: s.quarter.id, slot: 0, kind: "coin_tower", modules: ["base.stone"], version: 1 });
    return s;
  }

  test("linking needs the wallet's own signature", async () => {
    const w = world();
    const { b, quarter } = await tower(w);
    const res = await b.post("link", { quarterId: quarter.id, slot: 0, link: { kind: "mint", mint: MINT }, version: 2 });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "WALLET_REQUIRED");
  });

  test("the server checks the object is yours before it is shown; one object, one building", async () => {
    const w = world();
    const { b, quarter } = await tower(w, { wallet: WALLET });
    const res = await b.post("link", { quarterId: quarter.id, slot: 0, link: { kind: "mint", mint: MINT }, version: 2 });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.building.link, { kind: "mint", mint: MINT });
    assert.equal(res.body.quarter.version, 3);
    assert.deepEqual(w.state.verified[0], { link: { kind: "mint", mint: MINT }, accountId: null, wallet: WALLET });
    const { b: b2, quarter: q2 } = await tower(w, { wallet: WALLET });
    const taken = await b2.post("link", { quarterId: q2.id, slot: 0, link: { kind: "mint", mint: MINT }, version: 2 });
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error.code, "LINK_TAKEN");
    const off = await b.post("link", { quarterId: quarter.id, slot: 0, link: null, version: 3 });
    assert.equal(off.body.building.link, null);
  });

  test("not yours, not checkable, wrong building or engine down are refused", async () => {
    const w = world();
    const { b, quarter } = await tower(w, { wallet: WALLET });
    const link = (body) => b.post("link", { quarterId: quarter.id, slot: 0, version: 2, ...body });
    w.state.verdict = "not_owned";
    assert.equal((await link({ link: { kind: "mint", mint: MINT } })).body.error.reason, "not_yours");
    w.state.verdict = "unverifiable";
    assert.equal((await link({ link: { kind: "mint", mint: MINT } })).body.error.reason, "unverifiable");
    w.state.verdict = "unavailable";
    const down = await link({ link: { kind: "mint", mint: MINT } }, "link-key-0001");
    assert.equal(down.status, 503);
    const mismatch = await link({ link: { kind: "lp_position", position: MINT } });
    assert.equal(mismatch.status, 422);
    assert.equal(mismatch.body.error.reason, "kind_mismatch");
    assert.equal((await link({ link: { kind: "mint", mint: "not-an-address" } })).status, 400);
    assert.equal((await link({ link: { kind: "mint", mint: MINT, extra: 1 } })).status, 400);
    assert.equal((await b.post("link", { quarterId: quarter.id, slot: 4, version: 2, link: null })).status, 404);
    assert.equal((await b.post("link", { quarterId: quarter.id, slot: 0, version: 1, link: null })).status, 409);
  });

  test("a store answer of 503 is not kept: the same key runs again", async () => {
    const w = world();
    const { b, quarter } = await tower(w, { wallet: WALLET });
    w.state.verdict = "unavailable";
    const body = { quarterId: quarter.id, slot: 0, version: 2, link: { kind: "mint", mint: MINT } };
    assert.equal((await b.post("link", body, { key: "link-retry-0001" })).status, 503);
    w.state.verdict = "owned";
    assert.equal((await b.post("link", body, { key: "link-retry-0001" })).status, 200);
  });

  test("a prediction book is the account's own and is never shown to others with its account id", async () => {
    const w = world();
    const guest = await settled(w, { wallet: WALLET });
    await w.store.award({ residentId: guest.resident.id, reason: "survival_7", delta: 50, sourceRef: "m", key: "s7", now: new Date(w.state.now) });
    await guest.b.post("build", { quarterId: guest.quarter.id, slot: 0, kind: "oracle", modules: ["base.stone"], version: 1 });
    const refused = await guest.b.post("link", { quarterId: guest.quarter.id, slot: 0, version: 2, link: { kind: "prediction_book", accountId: randomUUID() } });
    assert.equal(refused.body.error.reason, "account_required");

    const account = randomUUID();
    w.store.accounts.add(account);
    const owner = await settled(w, { account, wallet: WALLET });
    await w.store.award({ residentId: owner.resident.id, reason: "survival_7", delta: 50, sourceRef: "m", key: "s7", now: new Date(w.state.now) });
    await owner.b.post("build", { quarterId: owner.quarter.id, slot: 0, kind: "oracle", modules: ["base.stone"], version: 1 });
    const someoneElses = await owner.b.post("link", { quarterId: owner.quarter.id, slot: 0, version: 2, link: { kind: "prediction_book", accountId: randomUUID() } });
    assert.equal(someoneElses.body.error.reason, "not_yours");
    const ok = await owner.b.post("link", { quarterId: owner.quarter.id, slot: 0, version: 2, link: { kind: "prediction_book", accountId: account } });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.building.link, { kind: "prediction_book", accountId: account });
    const seen = await browser(w).get(`quarter/${owner.quarter.id}`);
    assert.deepEqual(seen.body.buildings[0].link, { kind: "prediction_book" });
    assert.doesNotMatch(JSON.stringify(seen.body), new RegExp(account));
    const mine = await owner.b.get("me");
    assert.deepEqual(mine.body.buildings[0].link, { kind: "prediction_book", accountId: account });
  });
});

describe("POST /api/world/visit and GET /api/world/away", () => {
  test("a visit counts once a day, never one's own, and three visits finish the task", async () => {
    const w = world();
    const visitor = await settled(w);
    const hosts = [await settled(w), await settled(w), await settled(w)];
    assert.deepEqual((await visitor.b.post("visit", { quarterId: visitor.quarter.id })).body, { visit: null, counted: false, reason: "own_quarter" });
    const first = await visitor.b.post("visit", { quarterId: hosts[0].quarter.id });
    assert.equal(first.status, 200);
    assert.equal(first.body.counted, true);
    assert.equal(first.body.visit.verifiedHuman, false, "a guest is not a checked person");
    assert.equal((await visitor.b.post("visit", { quarterId: hosts[0].quarter.id })).body.reason, "already_today");
    await visitor.b.post("visit", { quarterId: hosts[1].quarter.id });
    await visitor.b.post("visit", { quarterId: hosts[2].quarter.id });
    const me = await visitor.b.get("me");
    assert.equal(me.body.points.total, 10);
    assert.equal(me.body.tasks.find((t) => t.kind === "visit_quarters").doneAt, "2026-10-27T10:00:00.000Z");
    assert.equal((await visitor.b.post("visit", { quarterId: randomUUID() })).status, 404);
    assert.equal((await browser(w).post("visit", { quarterId: hosts[0].quarter.id })).status, 401);
  });

  test("a visitor signed in with a wallet counts as a checked person", async () => {
    const w = world();
    const account = randomUUID();
    w.store.accounts.add(account);
    const visitor = await settled(w, { account });
    const host = await settled(w);
    assert.equal((await visitor.b.post("visit", { quarterId: host.quarter.id })).body.visit.verifiedHuman, true);
  });

  test("away tells the owner who came by and what the neighbours built, since a moment", async () => {
    const w = world();
    const host = await settled(w);
    const since = new Date(w.state.now).toISOString();
    w.state.now += 60_000;
    const neighbour = await settled(w);
    w.state.now += 60_000;
    await neighbour.b.post("build", { quarterId: neighbour.quarter.id, slot: 0, kind: "home", modules: ["base.stone"], version: 1 });
    w.state.now += 60_000;
    await neighbour.b.post("visit", { quarterId: host.quarter.id });
    await host.b.post("build", { quarterId: host.quarter.id, slot: 0, kind: "home", modules: ["base.stone"], version: 1 });
    const res = await host.b.get(`away?since=${encodeURIComponent(since)}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control"), /no-store/);
    assert.deepEqual(res.body.events.map((e) => e.kind), ["visit", "build", "claim"], "newest first, without the host's own build");
    assert.equal(res.body.since, since);
    assert.equal(res.body.until, new Date(w.state.now).toISOString());
    assert.equal((await host.b.get("away?since=yesterday")).status, 400);
    const week = await host.b.get("away?since=2020-01-01T00:00:00Z");
    assert.equal(week.body.since, new Date(w.state.now - 7 * 86_400_000).toISOString(), "at most a week back");
    assert.equal((await browser(w).get("away")).status, 401);
  });
});

describe("«While you were away»: the report and the consent", () => {
  test("the report folds the events into lines about my quarter, my coin, my street and the city, each with its source and time", async () => {
    const w = world();
    const account = randomUUID();
    w.store.accounts.add(account);
    const host = await settled(w, { account, wallet: WALLET });
    await host.b.post("build", { quarterId: host.quarter.id, slot: 0, kind: "coin_tower", modules: ["base.stone"], version: 1 });
    const linked = await host.b.post("link", { quarterId: host.quarter.id, slot: 0, link: { kind: "mint", mint: MINT }, version: 2 });
    assert.equal(linked.status, 200);
    const since = new Date(w.state.now).toISOString();
    w.state.now += 60_000;
    const signed = randomUUID();
    w.store.accounts.add(signed);
    const visitors = [await settled(w), await settled(w, { account: signed }), await settled(w)];
    for (const v of visitors) await v.b.post("visit", { quarterId: host.quarter.id });
    // The newest line of a kind leads: the newcomers came before the neighbour built.
    w.state.now -= 1_000;
    await visitors[0].b.post("build", { quarterId: visitors[0].quarter.id, slot: 0, kind: "home", modules: ["base.stone"], version: 1 });
    await recordWorldEvent(w.store, { source: "engine", kind: "graduate", subject: MINT, sourceAt: new Date(w.state.now - 30_000), payload: { pool: "damm_v2", nested: { no: 1 } } });
    await recordWorldEvent(w.store, { source: "market", kind: "pump", subject: "OtherMint111111111111111111111111111111111", sourceAt: new Date(w.state.now - 20_000), payload: { change: 0.21, window: "24h" } });
    await recordWorldEvent(w.store, { source: "market", kind: "pump", subject: "Late1111111111111111111111111111111111111", sourceAt: null, payload: {} });
    w.state.now += 60_000;
    const res = await host.b.get(`away?since=${encodeURIComponent(since)}`);
    assert.equal(res.status, 200);
    const { report } = res.body;
    assert.deepEqual(report.beats.map((b) => [b.about, b.kind, b.source, b.count]), [
      ["quarter", "visit", "world", 3],
      ["object", "graduate", "engine", 1],
      ["district", "claim", "world", 3],
      ["district", "build", "world", 1],
      ["city", "pump", "market", 1],
    ]);
    const [visits, coin, , , city] = report.beats;
    assert.equal(visits.subject, host.quarter.id);
    assert.equal(visits.detail.verified, 1, "one visitor signed in with a wallet");
    assert.equal(visits.eventIds.length, 3);
    assert.equal(coin.subject, MINT);
    assert.deepEqual(coin.detail, { pool: "damm_v2", slot: 0, building: "coin_tower", linkKind: "mint" }, "plain figures only, and the building that shows it");
    assert.deepEqual(city.detail, { change: 0.21, window: "24h" });
    assert.equal(report.beats[2].street, "arrivals-1");
    for (const b of report.beats) {
      assert.ok(Date.parse(b.at) > Date.parse(since) && Date.parse(b.from) <= Date.parse(b.at), "every line has its time");
      assert.ok(["world", "engine", "market"].includes(b.source), "and its source");
    }
    assert.deepEqual(report.counts, { quarter: 3, object: 1, district: 4, city: 1 }, "an event without a source time is never counted");
    assert.equal(res.body.events.length, 9);
  });

  test("consent: off at first, kept under an account, a guest is asked to sign in, and nothing else changes", async () => {
    const w = world();
    const guest = await settled(w);
    assert.deepEqual((await guest.b.get("consent")).body, { consent: { telegram: false, push: false, updatedAt: null }, canConsent: false });
    const refused = await guest.b.post("setConsent", { telegram: true });
    assert.equal(refused.status, 401);
    assert.equal(refused.body.error.code, "WALLET_REQUIRED");
    assert.equal((await browser(w).get("consent")).status, 401);

    const account = randomUUID();
    w.store.accounts.add(account);
    const owner = await settled(w, { account });
    assert.equal((await owner.b.get("consent")).body.canConsent, true);
    const on = await owner.b.post("setConsent", { telegram: true }, { key: "consent-key-001" });
    assert.equal(on.status, 200);
    assert.deepEqual(on.body, { consent: { telegram: true, push: false, updatedAt: "2026-10-27T10:00:00.000Z" }, canConsent: true });
    assert.equal((await owner.b.post("setConsent", { telegram: true }, { key: "consent-key-001" })).headers.get("idempotent-replayed"), "true");
    assert.deepEqual((await owner.b.post("setConsent", { push: true })).body.consent, { telegram: true, push: true, updatedAt: "2026-10-27T10:00:00.000Z" });
    assert.deepEqual((await owner.b.get("consent")).body.consent, { telegram: true, push: true, updatedAt: "2026-10-27T10:00:00.000Z" });
    for (const body of [{}, { telegram: "yes" }, { email: true }, { push: null }]) {
      assert.equal((await owner.b.post("setConsent", body)).status, 400, JSON.stringify(body));
    }
    const elsewhere = await owner.b.post("setConsent", { push: false }, { headers: { origin: "https://evil.example" } });
    assert.equal(elsewhere.status, 403);
  });

  test("consent answers 503 and changes nothing while its table is not there yet", async () => {
    const store = new MemoryWorldStore();
    store.consent = async () => { throw new WorldStoreUnavailable("world_consent: function does not exist"); };
    store.setConsent = async () => { throw new WorldStoreUnavailable("world_set_consent: function does not exist"); };
    const w = world({ store });
    const account = randomUUID();
    store.accounts.add(account);
    const owner = await settled(w, { account });
    assert.equal((await owner.b.get("consent")).status, 503);
    assert.equal((await owner.b.post("setConsent", { push: true })).status, 503);
    assert.equal((await owner.b.get("away")).status, 200, "the report does not need it");
  });
});

describe("GET /api/world/version/:id", () => {
  test("a frozen world is public and never changes", async () => {
    const w = world();
    const { version } = await freezeWorldVersion(w.store, { day: "2026-10-27", seed: "daily", towers: [{ mint: MINT }], now: new Date(w.state.now) });
    const res = await browser(w).get(`version/${version.id}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, version);
    assert.match(res.headers.get("cache-control"), /immutable/);
    assert.equal((await browser(w).get(`version/${randomUUID()}`)).status, 404);
    assert.equal((await browser(w).get("version/today")).status, 404);
  });
});

describe("the guest key", () => {
  test("the same resident and salt make the same key; another salt or secret does not", () => {
    const id = randomUUID();
    const salt = "0123456789abcdef0123456789abcdef";
    assert.equal(guestKey(id, salt, "a"), guestKey(id, salt, "a"));
    assert.notEqual(guestKey(id, salt, "a"), guestKey(id, "f".repeat(32), "a"));
    assert.notEqual(guestKey(id, salt, "a"), guestKey(id, salt, "b"));
    assert.equal(guestKey(id, null, "a"), null);
    assert.equal(guestKey(id, salt, null), null);
  });
});
