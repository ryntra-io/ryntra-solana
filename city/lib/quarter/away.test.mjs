// Run from repo root: node --test city/lib/quarter/away.test.mjs
import "../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";

const { reelOf, marketLines, lineOfBeat, poseOf, ticker, worthPlaying, sinceOf, percent, ago, awayFor, REEL_MS, LINE_MIN_MS, LINE_MAX_MS, MAX_LINES, AWAY_MIN_MS, SOURCE_LABEL } = await import("./away.ts");
const { createAwayStore, SEEN_KEY, CONSENT_LINES } = await import("./away-store.ts");
const { createHttpWorld } = await import("./http.ts");
const { createMockWorld } = await import("./mock.ts");
const { lotOf } = await import("./plot.ts");
const { WorldError } = await import("./types.ts");
const { createWorldApi, WorldLimiter } = await import("../../../lib/world/api.ts");
const { MemoryWorldStore } = await import("../../../lib/world/memory-store.ts");
const { recordWorldEvent } = await import("../../../lib/world/award.ts");

/**
 * «While you were away» in the city: the world's report and the market's live read become at most six lines that
 * share twenty seconds, mine first, every one with its source and time; the camera has a place for each; the reel
 * plays once per return and its end is the next «since»; consent is a switch on the server and nothing more.
 */

const NOW = Date.parse("2026-10-27T10:00:00.000Z");
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60_000).toISOString();
const MINT = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
const HELD = "HeLd1111111111111111111111111111111111pump";

const quarter = { id: "7d3f8a52-0c8e-4f43-9f5e-6a1b2c3d4e5f", ownerId: "r1", district: "arrivals", street: "arrivals-1", cell: { x: 3, z: 0 }, level: 3, version: 7, updatedAt: iso(0) };
const me = {
  resident: { id: "r1", accountId: "a1", displayName: null, homeQuarterId: quarter.id, createdAt: iso(9000) },
  quarter,
  buildings: [{ id: "b1", quarterId: quarter.id, slot: 2, kind: "coin_tower", level: 2, modules: ["base.stone"], link: { kind: "mint", mint: MINT }, updatedAt: iso(0) }],
  quarters: [quarter],
  points: { total: 120, recent: [] },
  tasks: [],
};

const tower = (id, symbol, change24h, more = {}) => ({ id, symbol, verified: true, change24h, liquidity: 400_000, ...more });
const market = (towers, source = "live") => ({ towers, fetchedAt: iso(1), source });

const beat = (about, kind, source, subject, count, more = {}) => ({
  id: `${about}-${kind}-${subject}`, about, kind, source, subject, count, at: iso(30), from: iso(90), street: about === "district" ? "arrivals-2" : null, detail: {}, eventIds: [], ...more,
});
const report = (beats) => ({ beats, counts: { quarter: 0, object: 0, district: 0, city: 0 } });

describe("the reel", () => {
  test("mine first, around me after, at most six lines that share twenty seconds", () => {
    const lines = reelOf({
      report: report([
        beat("quarter", "visit", "world", quarter.id, 3, { detail: { verified: 2 } }),
        beat("object", "graduate", "engine", MINT, 1, { detail: { linkKind: "mint", building: "coin_tower", slot: 2 } }),
        beat("district", "claim", "world", "arrivals-2", 4),
        beat("district", "build", "world", "arrivals-2", 2),
        beat("city", "pump", "market", "CityMint", 1, { detail: { change: 0.31 } }),
      ]),
      me,
      market: market([tower(MINT, "ORB", 12), tower(HELD, "HLD", -8.5), tower("CityMint", "CTY", 31), tower("Riser", "RSE", 44), tower("Thin", "THN", 90, { liquidity: 1_000 })]),
      held: new Set([HELD]),
    });
    assert.deepEqual(lines.map((l) => [l.tone, l.text]), [
      ["mine", "3 visitors came by your quarter"],
      ["mine", "$ORB graduated to its pool"],
      ["mine", "Your coin $HLD fell −8.5%"],
      ["around", "4 newcomers settled on Street 2"],
      ["around", "Neighbours built 2 times on Street 2"],
      ["around", "Rising: $RSE +44.0%"],
    ]);
    assert.equal(lines.length, MAX_LINES, "the city's pump waits for a quieter day");
    assert.equal(lines[0].sub, "2 of them signed in with a wallet");
    assert.equal(lines[2].sub, "over 24H", "the window is the read's own");
    assert.equal(lines[5].sub, "then $CTY +31.0% · over 24H", "the thin pool is never a riser");
    for (const l of lines) {
      assert.ok(l.source && Number.isFinite(Date.parse(l.at)), `${l.text}: a source and a time`);
      assert.ok(l.ms >= LINE_MIN_MS && l.ms <= LINE_MAX_MS);
    }
    assert.ok(lines.reduce((sum, l) => sum + l.ms, 0) <= REEL_MS + 200, "twenty seconds");
    assert.deepEqual(lines.map((l) => l.source), [SOURCE_LABEL.world, SOURCE_LABEL.engine, SOURCE_LABEL.jupiter, SOURCE_LABEL.world, SOURCE_LABEL.world, SOURCE_LABEL.jupiter]);
    assert.deepEqual(lines.map((l) => l.focus.kind), ["quarter", "tower", "tower", "street", "street", "tower"]);
    assert.deepEqual(lines[3].focus, { kind: "street", z: 0 }, "a street past mine is not drawn: the camera shows mine");
    const north = lineOfBeat(beat("district", "claim", "world", "arrivals-1", 2, { street: "arrivals-1" }), { ...me, quarter: { ...quarter, cell: { x: 1, z: 2 } } }, null);
    assert.deepEqual(north.focus, { kind: "street", z: 0 }, "a street nearer the island is drawn");
  });

  test("the coin my building shows, already told by the world, is not told twice by the market", () => {
    const lines = reelOf({
      report: report([beat("object", "pump", "market", MINT, 2, { detail: { linkKind: "mint", change: 0.18 } })]),
      me,
      market: market([tower(MINT, "ORB", 12)]),
      held: new Set(),
    });
    assert.deepEqual(lines.map((l) => [l.text, l.sub]), [["$ORB is pumping", "+18.0% · 2 times"]]);
    assert.equal(lines[0].ms, LINE_MAX_MS, "one line holds as long as a line may, not twenty seconds");
  });

  test("a bundled snapshot is not news; a quiet coin is not news; an unnamed coin is never named", () => {
    assert.deepEqual(marketLines({ market: market([tower(MINT, "ORB", 30)], "snapshot"), mine: new Set([MINT]), covered: new Set() }), []);
    assert.deepEqual(marketLines({ market: market([tower(MINT, "ORB", 1.2)]), mine: new Set([MINT]), covered: new Set() }), []);
    assert.deepEqual(marketLines({ market: null, mine: new Set(), covered: new Set() }), []);
    const city = lineOfBeat(beat("city", "flare", "market", "Anon", 1, { detail: { change: -0.2 } }), me, market([tower("Anon", "ANON", -20, { verified: false })]));
    assert.equal(city.text, "A coin took a hit");
    assert.equal(city.sub, "−20.0%");
    assert.deepEqual(reelOf({ report: report([]), me, market: null, held: new Set() }), []);
  });

  test("engine objects without a tower look at the quarter; a lone visit and a lone newcomer read as one", () => {
    const team = lineOfBeat(beat("object", "war", "engine", "6719f2c4a1b2c3d4e5f60718", 1, { detail: { linkKind: "team" } }), me, null);
    assert.equal(team.text, "Your crew joined the district war");
    assert.deepEqual(team.focus, { kind: "quarter", cell: quarter.cell });
    assert.equal(lineOfBeat(beat("quarter", "visit", "world", quarter.id, 1), me, null).text, "Someone came by your quarter");
    assert.equal(lineOfBeat(beat("district", "claim", "world", "arrivals-2", 1), me, null).text, "A newcomer settled on Street 2");
    assert.deepEqual(lineOfBeat(beat("city", "launch", "engine", "Unknown", 1), me, market([])).focus, { kind: "city" });
  });

  test("figures and times read as people read them", () => {
    assert.equal(ticker("$WIF"), "$WIF");
    assert.equal(ticker("BONK"), "$BONK");
    assert.equal(percent(0.184), "+18.4%");
    assert.equal(percent(-0.03), "−3.0%");
    assert.equal(percent(2.5), "+250%");
    assert.equal(ago(iso(0.2), NOW), "just now");
    assert.equal(ago(iso(5), NOW), "5 min ago");
    assert.equal(ago(iso(180), NOW), "3 h ago");
    assert.equal(ago(iso(60 * 30), NOW), "yesterday");
    assert.equal(ago(iso(60 * 24 * 3), NOW), "3 days ago");
    assert.equal(awayFor(iso(180), iso(0)), "3 h");
    assert.equal(awayFor(iso(25), iso(0)), "25 min");
    assert.equal(awayFor(iso(60 * 24 * 2), iso(0)), "2 d");
  });

  test("the camera has a place for every line: over the lot, outside a tower looking in, high over a street, the skyline", () => {
    const lot = lotOf(quarter.cell);
    const q = poseOf({ kind: "quarter", cell: quarter.cell }, [], false);
    assert.deepEqual(q.target, { x: lot.x, y: 0, z: lot.z });
    assert.ok(q.position.y > 15, "above the lot");
    const placed = [{ tower: { id: MINT }, x: 30, z: -40, height: 50 }];
    const t = poseOf({ kind: "tower", mint: MINT }, placed, false);
    assert.equal(t.target.x, 30);
    assert.ok(Math.hypot(t.position.x, t.position.z) > Math.hypot(30, 40), "from outside the island");
    const portrait = poseOf({ kind: "tower", mint: MINT }, placed, true);
    assert.ok(Math.hypot(portrait.position.x - 30, portrait.position.z + 40) > Math.hypot(t.position.x - 30, t.position.z + 40), "farther back on a phone");
    assert.equal(poseOf({ kind: "tower", mint: "gone" }, placed, false).position.z, 172, "a tower not in the city: the skyline");
    const street = poseOf({ kind: "street", z: 1 }, [], false);
    assert.equal(street.target.z, lotOf({ x: 0, z: 1 }).z);
    assert.ok(street.position.y > q.position.y, "a street is seen from higher than a lot");
  });

  test("a return is worth a reel after twenty minutes away; «since» is the last moment seen, or a day back", () => {
    assert.equal(worthPlaying(null, NOW), true);
    assert.equal(worthPlaying(iso(5), NOW), false);
    assert.equal(worthPlaying(new Date(NOW - AWAY_MIN_MS).toISOString(), NOW), true);
    assert.equal(worthPlaying("garbage", NOW), true);
    assert.equal(sinceOf(iso(90), NOW), iso(90));
    assert.equal(sinceOf(null, NOW), iso(60 * 24));
    assert.equal(sinceOf(new Date(NOW + 60_000).toISOString(), NOW), iso(60 * 24), "a time from the future is not trusted");
    assert.equal(worthPlaying(null, NOW, iso(3)), false, "a resident who just moved in was never away");
    assert.equal(worthPlaying(null, NOW, iso(600)), true);
    assert.equal(sinceOf(null, NOW, iso(600)), iso(600), "never before the resident moved in");
    assert.equal(sinceOf(iso(90), NOW, iso(600)), iso(90));
  });
});

/* ------------------------------------------------------------- the store -- */

function memoryStorage() {
  const map = new Map();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

function fakeClient(over = {}) {
  const calls = [];
  const client = {
    async away(since) {
      calls.push(["away", since]);
      return { since, until: iso(0), events: [], report: report([beat("quarter", "visit", "world", quarter.id, 2), beat("district", "claim", "world", "arrivals-1", 1)]) };
    },
    async consent() {
      calls.push(["consent"]);
      return { consent: { telegram: false, push: false, updatedAt: null }, canConsent: true };
    },
    async setConsent(input, key) {
      calls.push(["setConsent", input, key]);
      return { consent: { telegram: input.telegram ?? false, push: input.push ?? false, updatedAt: iso(0) }, canConsent: true };
    },
    ...over,
  };
  return { client, calls };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the reel's store", () => {
  test("a return plays once; its end is the next «since»; a quick return is not a reel", async () => {
    const storage = memoryStorage();
    const { client, calls } = fakeClient();
    let clock = NOW;
    const store = createAwayStore({ client: () => client, storage, now: () => clock });
    storage.setItem(`${SEEN_KEY}:wallet:A`, iso(120));
    assert.equal(await store.getState().check({ owner: "wallet:A", me, market: null, held: new Set() }), true);
    await settle();
    assert.deepEqual(calls.slice(0, 2).map((c) => c[0]).sort(), ["away", "consent"]);
    assert.equal(calls.find((c) => c[0] === "away")[1], iso(120));
    const st = store.getState();
    assert.equal(st.status, "playing");
    assert.equal(st.lines.length, 2);
    assert.equal(storage.getItem(`${SEEN_KEY}:wallet:A`), iso(0), "the report's own «until»");
    assert.deepEqual(st.consent, { telegram: false, push: false, updatedAt: null, canConsent: true });
    assert.equal(await store.getState().check({ owner: "wallet:A", me, market: null, held: new Set() }), true, "the same account is not read twice");
    assert.equal(calls.filter((c) => c[0] === "away").length, 1);

    store.getState().next();
    assert.equal(store.getState().index, 1);
    clock = NOW + 30_000;
    store.getState().next();
    assert.equal(store.getState().status, "done", "past the last line the reel ends");
    assert.equal(storage.getItem(`${SEEN_KEY}:wallet:A`), new Date(NOW + 30_000).toISOString());

    store.getState().reset();
    clock = NOW + 60_000;
    assert.equal(await store.getState().check({ owner: "wallet:A", me, market: null, held: new Set() }), false, "back after a minute: nothing to tell");
    assert.equal(calls.filter((c) => c[0] === "away").length, 1);
  });

  test("seen never moves «since» before the report is read; skipping is the end; each account keeps its own", async () => {
    const storage = memoryStorage();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { client } = fakeClient({ async away(since) { await gate; return { since, until: iso(0), events: [], report: report([beat("quarter", "visit", "world", quarter.id, 1)]) }; } });
    const store = createAwayStore({ client: () => client, storage, now: () => NOW });
    storage.setItem(`${SEEN_KEY}:wallet:B`, iso(300));
    const checking = store.getState().check({ owner: "wallet:B", me, market: null, held: new Set() });
    store.getState().seen();
    assert.equal(storage.getItem(`${SEEN_KEY}:wallet:B`), iso(300));
    release();
    await checking;
    store.getState().finish();
    assert.equal(store.getState().status, "done");
    assert.equal(storage.getItem(`${SEEN_KEY}:wallet:A`), null);
  });

  test("a world out of reach leaves «since» where it was and shows nothing", async () => {
    const storage = memoryStorage();
    const { client } = fakeClient({ async away() { throw new WorldError(0, "OFFLINE"); }, async consent() { throw new WorldError(503, "UNAVAILABLE"); } });
    const store = createAwayStore({ client: () => client, storage, now: () => NOW });
    storage.setItem(`${SEEN_KEY}:wallet:C`, iso(300));
    assert.equal(await store.getState().check({ owner: "wallet:C", me, market: null, held: new Set() }), false);
    await settle();
    assert.equal(store.getState().status, "done");
    assert.equal(store.getState().consent, null, "no switches when the world cannot keep them");
    assert.equal(storage.getItem(`${SEEN_KEY}:wallet:C`), iso(300));
  });

  test("a switch is one write with one key, retried once on no answer; a refusal says so and changes nothing", async () => {
    let failures = 1;
    const { client, calls } = fakeClient({
      async setConsent(input, key) {
        calls.push(["setConsent", input, key]);
        if (failures-- > 0) throw new WorldError(0, "OFFLINE");
        return { consent: { telegram: true, push: false, updatedAt: iso(0) }, canConsent: true };
      },
    });
    const store = createAwayStore({ client: () => client, storage: memoryStorage(), now: () => NOW, newKey: () => "consent-key-1" });
    await store.getState().check({ owner: "wallet:D", me, market: null, held: new Set() });
    await settle();
    await store.getState().toggle("telegram");
    const writes = calls.filter((c) => c[0] === "setConsent");
    assert.deepEqual(writes, [["setConsent", { telegram: true }, "consent-key-1"], ["setConsent", { telegram: true }, "consent-key-1"]]);
    assert.equal(store.getState().consent.telegram, true);
    assert.equal(store.getState().consentBusy, null);

    const refusing = fakeClient({ async setConsent() { throw new WorldError(401, "WALLET_REQUIRED"); } });
    const other = createAwayStore({ client: () => refusing.client, storage: memoryStorage(), now: () => NOW });
    await other.getState().check({ owner: "wallet:E", me, market: null, held: new Set() });
    await settle();
    await other.getState().toggle("push");
    assert.equal(other.getState().consent.push, false);
    assert.equal(other.getState().consentError, CONSENT_LINES.refused);
  });

  test("a resident who just claimed sees no reel; the moment is remembered", async () => {
    const storage = memoryStorage();
    const { client, calls } = fakeClient();
    const store = createAwayStore({ client: () => client, storage, now: () => NOW });
    const fresh = { ...me, resident: { ...me.resident, createdAt: iso(2) } };
    assert.equal(await store.getState().check({ owner: "wallet:F", me: fresh, market: null, held: new Set() }), false);
    assert.equal(calls.filter((c) => c[0] === "away").length, 0);
    assert.equal(storage.getItem(`${SEEN_KEY}:wallet:F`), iso(0));
  });

  test("a guest's world keeps no consent: no switch is offered", async () => {
    const mock = createMockWorld({ storage: null, now: () => new Date(NOW) });
    const store = createAwayStore({ client: () => mock, storage: memoryStorage(), now: () => NOW });
    await mock.claim();
    await store.getState().check({ owner: "device", me, market: null, held: new Set() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(store.getState().consent.canConsent, false);
    await store.getState().toggle("telegram");
    assert.equal(store.getState().consent.telegram, false);
    await assert.rejects(mock.setConsent({ telegram: true }), (e) => e.code === "WALLET_REQUIRED");
  });
});

/* ------------------------------------------- the client on the real routes -- */

describe("the city's client on the world's own routes", () => {
  function server(account) {
    const store = new MemoryWorldStore();
    if (account) store.accounts.add(account);
    const api = createWorldApi({
      store, secret: () => "test-secret", now: () => new Date(NOW), limiter: new WorldLimiter(),
      account: async () => (account ? { status: "ok", accountId: account } : { status: "absent" }),
      wallet: async () => ({ status: "absent" }), verifyLink: async () => "owned",
    });
    const jar = { rwg: null };
    const fetch = async (url, init) => {
      const u = new URL(url, "https://ryntra.io");
      const headers = new Headers(init.headers);
      headers.set("origin", "https://ryntra.io");
      headers.set("x-forwarded-for", "198.51.100.9");
      if (jar.rwg) headers.set("cookie", `rwg=${jar.rwg}`);
      const name = u.pathname.replace(/^\/api\/world\//, "");
      const handler = name === "consent" && init.method === "POST" ? "setConsent" : name;
      const res = await api[handler](new Request(u, { method: init.method, headers, body: init.body }));
      const cookie = res.headers.get("set-cookie");
      if (cookie?.startsWith("rwg=")) jar.rwg = cookie.slice(4, cookie.indexOf(";")) || null;
      return res;
    };
    return { world: createHttpWorld({ fetch }), store };
  }

  test("away brings the report the reel stands on; consent reads off, turns on, and a guest is asked to sign in", async () => {
    const owner = server(randomUUID());
    const claimed = await owner.world.claim();
    await recordWorldEvent(owner.store, { source: "market", kind: "pump", subject: MINT, sourceAt: new Date(NOW - 60_000), payload: { change: 0.2 } });
    const away = await owner.world.away(iso(60));
    assert.deepEqual(away.report.beats.map((b) => [b.about, b.kind, b.source]), [["city", "pump", "market"]]);
    const lines = reelOf({ report: away.report, me: { ...me, quarter: claimed.quarter, quarters: [claimed.quarter], buildings: [] }, market: null, held: new Set() });
    assert.deepEqual(lines.map((l) => [l.text, l.sub, l.source]), [["A coin is pumping", "+20.0%", "Market feed"]]);
    assert.deepEqual(await owner.world.consent(), { consent: { telegram: false, push: false, updatedAt: null }, canConsent: true });
    assert.deepEqual((await owner.world.setConsent({ push: true })).consent, { telegram: false, push: true, updatedAt: iso(0) });

    const guest = server(null);
    await guest.world.claim();
    assert.equal((await guest.world.consent()).canConsent, false);
    await assert.rejects(guest.world.setConsent({ push: true }), (e) => e instanceof WorldError && e.status === 401 && e.code === "WALLET_REQUIRED");
  });
});
