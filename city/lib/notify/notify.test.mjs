import assert from "node:assert/strict";
import test from "node:test";

import { KINDS, kindOf, kindsIn } from "./kinds.ts";
import { decide } from "./gate.ts";
import { defaultPrefs, inQuiet, NOTIFY_KEY, readPrefs, routeShown, sanitizePrefs, setCap, setQuiet, setRoute, writePrefs } from "./prefs.ts";
import { hydrateNotify, MAX_BANNERS, notify, resetNotify, routeNow, flashNow, useNotify } from "./store.ts";
import { createChannels, withProof } from "./channels.ts";
import { liveLink, resetChannels, setChannelsEnv, useChannels } from "./channels-store.ts";
import { hydrateFeed, resetFeed, useFeed } from "../feed/store.ts";

/* CITY-87: the notification centre — every kind to the city, the computer, Telegram or nowhere, kept on this device;
   the liquidation risk is never off (decision 88). */

const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
};
const refusing = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceededError"); } };

const NOON = new Date(2026, 9, 31, 12, 0);
const MIDNIGHT = new Date(2026, 9, 31, 0, 30);
const at = (date) => ({ now: date.getTime(), clock: date, last: null, desk: false });

function freshPage({ storage = memoryStorage(), desk = "default", shown = [] } = {}) {
  resetFeed();
  resetNotify();
  hydrateFeed({ storage, reducedMotion: false, phone: false });
  let clock = NOON.getTime();
  hydrateNotify({ storage, now: () => clock, desk: () => desk, ask: async () => "granted", show: (title, body, tag) => (shown.push({ title, body, tag }), true), open: () => undefined });
  return { storage, shown, tick: (ms) => (clock += ms) };
}

test("the kinds: the market's five, yours three, Earn's three, and Guard's two — which have no «off»", async () => {
  assert.deepEqual(kindsIn("market").map((k) => k.id), ["gainers", "losers", "inflows", "coins", "pools"]);
  assert.deepEqual(kindsIn("yours").map((k) => k.id), ["trades", "stops", "beacons"]);
  // CITY-100: out of range, the exchange's weekend, dividend dates — and a loan's health, Guard's.
  assert.deepEqual(kindsIn("earn").map((k) => k.id), ["range", "weekend", "dividend"]);
  assert.deepEqual(kindsIn("safety").map((k) => k.id), ["liquidation", "loan"]);
  for (const id of ["liquidation", "loan"]) {
    const risk = kindOf(id);
    assert.equal(risk.locked, true);
    assert.ok(!risk.places.includes("off"), `${id} cannot be sent nowhere`);
  }
  // Telegram is the server's, never a place the page picks: it is shown beside a reached stop and a lit beacon.
  assert.ok(KINDS.every((k) => !k.places.includes("telegram")));
  // Only where this build's server keeps them: stops on the engine, beacons on the server (the window also asks each
  // beacon's own Telegram switch).
  // CITY-100: Earn's, where Earn is open — Ryntra's server watches them for the phone and Telegram.
  const { STOPS_ENGINE } = await import("../trade/gates.ts");
  const { BEACONS } = await import("../beacon/switch.ts");
  const { EARN_LOANS, EARN_OPEN } = await import("../earn/flag.ts");
  const earn = EARN_OPEN ? ["range", "weekend", "dividend"] : [];
  assert.deepEqual(KINDS.filter((k) => k.telegram).map((k) => k.id), [...(STOPS_ENGINE ? ["stops"] : []), ...(BEACONS === "open" ? ["beacons"] : []), ...earn, ...(EARN_OPEN && EARN_LOANS ? ["loan"] : [])]);
  assert.ok(KINDS.filter((k) => k.telegram).every((k) => ["stops", "beacons", "range", "weekend", "dividend", "loan"].includes(k.id)), "no other kind claims Telegram");
  // Earn closed: none of its kinds is listed in the window.
  if (!EARN_OPEN) assert.ok(KINDS.filter((k) => ["range", "weekend", "dividend", "loan"].includes(k.id)).every((k) => !k.door));
  for (const kind of KINDS) assert.ok(kind.places.includes(kind.start), `${kind.id} starts somewhere it can go`);
});

test("the choices are kept on the device and read back the same", () => {
  const storage = memoryStorage();
  let prefs = defaultPrefs();
  prefs = setRoute(prefs, "stops", "desk");
  prefs = setRoute(prefs, "beacons", "off");
  prefs = setCap(prefs, "trades", "rare");
  prefs = setQuiet(prefs, { on: true, from: "22:30", to: "07:15" });
  prefs = { ...prefs, corner: "bottom-left", feed: "left", flash: "small", muted: true };
  assert.equal(writePrefs(storage, prefs), true);
  assert.deepEqual(readPrefs(storage), prefs);
  assert.equal(JSON.parse(storage.data.get(NOTIFY_KEY)).v, 1);
});

test("anything unreadable is the start, never an error; a device that will not keep it says so", () => {
  assert.deepEqual(readPrefs(null), defaultPrefs());
  assert.deepEqual(readPrefs(refusing), defaultPrefs());
  assert.deepEqual(readPrefs(memoryStorage({ [NOTIFY_KEY]: "{broken" })), defaultPrefs());
  assert.deepEqual(readPrefs(memoryStorage({ [NOTIFY_KEY]: "[1,2]" })), defaultPrefs());
  assert.equal(writePrefs(refusing, defaultPrefs()), false);
  assert.equal(writePrefs(null, defaultPrefs()), false);
  const odd = sanitizePrefs({ routes: { stops: "telegram", trades: "fax" }, caps: { gainers: "often" }, corner: "middle", quiet: { on: "yes", from: "25:00", to: "7:00" } });
  assert.equal(odd.routes.stops, "city");
  assert.equal(odd.routes.trades, "city", "a place the kind cannot go is its start");
  assert.equal(odd.caps.gainers, "few");
  assert.equal(odd.corner, "top-right");
  assert.deepEqual(odd.quiet, defaultPrefs().quiet);
});

test("a loan's health is Guard's like the liquidation risk: never off, never capped, never muted (CITY-100)", () => {
  const prefs = defaultPrefs();
  assert.equal(setRoute(prefs, "loan", "off"), prefs);
  assert.equal(setCap(prefs, "loan", "rare"), prefs);
  const kept = memoryStorage({ [NOTIFY_KEY]: JSON.stringify({ routes: { loan: "off" }, caps: { loan: "rare" } }) });
  assert.equal(readPrefs(kept).routes.loan, "city");
  assert.deepEqual(decide({ kind: "loan", title: "Loan at risk · TSLAx" }, "city", { ...prefs, muted: true }, at(NOON)), { banner: true, desk: false, why: "locked" });
  // Earn's own three go where the person says, «off» included.
  assert.equal(setRoute(prefs, "range", "off").routes.range, "off");
  assert.equal(decide({ kind: "dividend", title: "Dividend date · TSLAx" }, "city", prefs, at(NOON)).why, "city");
});

test("the liquidation risk cannot be turned off: not by a choice, not by a kept value, not by a cap", () => {
  const prefs = defaultPrefs();
  assert.equal(setRoute(prefs, "liquidation", "off"), prefs, "«off» changes nothing");
  assert.equal(setRoute(prefs, "liquidation", "telegram"), prefs, "nor a place it cannot go");
  assert.equal(setRoute(prefs, "liquidation", "desk").routes.liquidation, "desk", "the computer as well as the city");
  assert.equal(setCap(prefs, "liquidation", "rare"), prefs, "it speaks every time");
  const kept = memoryStorage({ [NOTIFY_KEY]: JSON.stringify({ routes: { liquidation: "off" }, caps: { liquidation: "rare" } }) });
  assert.equal(readPrefs(kept).routes.liquidation, "city", "a kept «off» reads as its start");
  assert.equal(readPrefs(kept).caps.liquidation, "all");
});

test("the gate: «Mute all», the quiet hours and a cap hold every kind — but the liquidation risk", () => {
  const prefs = { ...defaultPrefs(), muted: true };
  assert.deepEqual(decide({ kind: "stops", title: "Stop" }, "city", prefs, at(NOON)), { banner: false, desk: false, why: "muted" });
  assert.deepEqual(decide({ kind: "liquidation", title: "Risk" }, "city", prefs, at(NOON)), { banner: true, desk: false, why: "locked" });

  const quiet = setQuiet(defaultPrefs(), { on: true, from: "23:00", to: "08:00" });
  assert.equal(decide({ kind: "beacons", title: "Beacon" }, "city", quiet, at(MIDNIGHT)).why, "quiet");
  assert.equal(decide({ kind: "beacons", title: "Beacon" }, "city", quiet, at(NOON)).why, "city");
  assert.equal(decide({ kind: "liquidation", title: "Risk" }, "desk", quiet, { ...at(MIDNIGHT), desk: true }).desk, true, "the risk wakes the computer in the quiet hours");

  const capped = setCap(defaultPrefs(), "trades", "few");
  assert.equal(decide({ kind: "trades", title: "Bought" }, "city", capped, { ...at(NOON), last: NOON.getTime() - 60_000 }).why, "capped");
  assert.equal(decide({ kind: "trades", title: "Bought" }, "city", capped, { ...at(NOON), last: NOON.getTime() - 11 * 60_000 }).why, "city");
  assert.equal(decide({ kind: "liquidation", title: "Risk" }, "city", defaultPrefs(), { ...at(NOON), last: NOON.getTime() - 1 }).banner, true);
});

test("the gate: the computer falls back to a banner, a market kind in the city is the feed", () => {
  const prefs = defaultPrefs();
  assert.deepEqual(decide({ kind: "stops", title: "Stop" }, "desk", prefs, { ...at(NOON), desk: true }), { banner: false, desk: true, why: "desk" });
  assert.deepEqual(decide({ kind: "stops", title: "Stop" }, "desk", prefs, at(NOON)), { banner: true, desk: false, why: "deskRefused" });
  assert.equal(decide({ kind: "gainers", title: "BONK +40%" }, "city", prefs, at(NOON)).why, "feed");
  assert.equal(decide({ kind: "gainers", title: "BONK +40%" }, "desk", prefs, { ...at(NOON), desk: true }).desk, true);
  assert.equal(decide({ kind: "gainers", title: "BONK +40%" }, "desk", prefs, at(NOON)).banner, false, "the feed already shows it");
  assert.equal(decide({ kind: "trades", title: "Bought", onScreen: true }, "city", prefs, at(NOON)).why, "onScreen");
  assert.equal(decide({ kind: "stops", title: "Stop" }, "off", prefs, at(NOON)).why, "off");
});

test("the quiet hours cross midnight, and a window from a time to itself is none", () => {
  const night = { on: true, from: "23:00", to: "08:00" };
  assert.equal(inQuiet(night, new Date(2026, 9, 31, 23, 0)), true);
  assert.equal(inQuiet(night, new Date(2026, 9, 31, 7, 59)), true);
  assert.equal(inQuiet(night, new Date(2026, 9, 31, 8, 0)), false);
  assert.equal(inQuiet({ on: true, from: "13:00", to: "14:00" }, new Date(2026, 9, 31, 13, 30)), true);
  assert.equal(inQuiet({ on: true, from: "09:00", to: "09:00" }, NOON), false);
  assert.equal(inQuiet({ ...night, on: false }, MIDNIGHT), false);
});

test("a market kind's «off» is the feed's own switch, so the feed and its old key stay one truth", () => {
  const { storage } = freshPage();
  useNotify.getState().setRoute("losers", "off");
  assert.equal(useFeed.getState().settings.losers, false);
  assert.equal(routeNow("losers"), "off");
  assert.equal(JSON.parse(storage.data.get("ryntra.city.feed")).losers, false, "kept where CITY-66 keeps it");
  useNotify.getState().setRoute("losers", "desk");
  assert.equal(useFeed.getState().settings.losers, true);
  assert.equal(routeNow("losers"), "desk");
  assert.equal(routeShown(useNotify.getState().prefs, "gainers", () => false), "off");
});

test("the flashes: off is the feed's flashing switch; small and cinema are kept here", () => {
  const { storage } = freshPage();
  useNotify.getState().setFlash("off");
  assert.equal(useFeed.getState().settings.flashing, false);
  assert.equal(flashNow(), "off");
  useNotify.getState().setFlash("small");
  assert.equal(useFeed.getState().settings.flashing, true);
  assert.equal(flashNow(), "small");
  assert.equal(JSON.parse(storage.data.get(NOTIFY_KEY)).flash, "small");
});

test("the store keeps every change at once and reads it back on the next visit", () => {
  const storage = memoryStorage();
  freshPage({ storage });
  const st = useNotify.getState();
  st.setRoute("beacons", "desk");
  st.setCorner("top");
  st.setFeedSide("hidden");
  st.setQuiet({ on: true, from: "22:00" });
  st.setMuted(true);
  st.setRoute("liquidation", "off");
  freshPage({ storage });
  const back = useNotify.getState().prefs;
  assert.equal(back.routes.beacons, "desk");
  assert.equal(back.corner, "top");
  assert.equal(back.feed, "hidden");
  assert.deepEqual(back.quiet, { on: true, from: "22:00", to: "08:00" });
  assert.equal(back.muted, true);
  assert.equal(back.routes.liquidation, "city", "still on after a reload");
});

test("notify(): with everything muted the liquidation risk still stands, until it is closed", () => {
  const { shown, tick } = freshPage({ desk: "granted" });
  const st = useNotify.getState();
  st.setMuted(true);
  st.setRoute("liquidation", "desk");
  assert.equal(notify({ kind: "stops", title: "Stop reached · BONK" }).why, "muted");
  assert.equal(notify({ kind: "liquidation", title: "Liquidation risk · SOL-PERP" }).why, "locked");
  const [risk] = useNotify.getState().banners;
  assert.equal(risk.sticky, true);
  assert.equal(shown.length, 1, "and on the computer, as chosen");
  // Other banners come and go; the risk stays until the person closes it.
  st.setMuted(false);
  for (let i = 0; i < MAX_BANNERS + 2; i += 1) {
    tick(1000);
    notify({ kind: "beacons", title: `Beacon ${i}` });
  }
  const banners = useNotify.getState().banners;
  assert.equal(banners.length, MAX_BANNERS);
  assert.ok(banners.some((b) => b.kind === "liquidation"));
  st.dismiss(risk.id);
  assert.ok(!useNotify.getState().banners.some((b) => b.kind === "liquidation"));
});

test("notify(): on the computer with the browser's permission, a banner without it, the cap counted per kind", () => {
  const shown = [];
  freshPage({ desk: "granted", shown });
  useNotify.getState().setRoute("stops", "desk");
  notify({ kind: "stops", title: "Stop reached · BONK", line: "at $0.00002" });
  assert.deepEqual(shown, [{ title: "Stop reached · BONK", body: "at $0.00002", tag: "ryntra-stops" }]);
  assert.equal(useNotify.getState().banners.length, 0);
  freshPage({ desk: "denied" });
  useNotify.getState().setRoute("stops", "desk");
  notify({ kind: "stops", title: "Stop reached · BONK" });
  assert.equal(useNotify.getState().banners.length, 1);

  const { tick } = freshPage({ desk: "granted", shown: [] });
  useNotify.getState().setRoute("gainers", "desk");
  assert.equal(notify({ kind: "gainers", title: "BONK +40%" }).desk, true);
  tick(60_000);
  assert.equal(notify({ kind: "gainers", title: "WIF +30%" }).why, "capped", "a market kind on the computer at most once in ten minutes");
  tick(10 * 60_000);
  assert.equal(notify({ kind: "gainers", title: "WIF +30%" }).desk, true);
});

/* ---------- The engine's channels ---------- */

function fakeEngine(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const answer = routes(url, init.method, calls.length);
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body };
  };
  return { calls, api: createChannels(fetchImpl) };
}

test("channels: the engine's routes, unchanged, with the v1 header and the wallet's proof cookie", async () => {
  const { calls, api } = fakeEngine((url, method) => {
    if (url === "/api/v1/notifications/telegram" && method === "GET") return { status: 200, body: { telegram: { connected: true, username: "anna", connectedAt: "2026-10-31T10:00:00.000Z" } } };
    if (url === "/api/v1/notifications/devices" && method === "GET") return { status: 200, body: { devices: [{ deviceId: "dev_0123456789abcdef01234567", platform: "android", appVersion: "1.18.1", locale: "uk", registeredAt: "2026-10-30T10:00:00.000Z" }] } };
    if (method === "DELETE") return { status: 200, body: { ok: true } };
    return { status: 404, body: null };
  });
  assert.deepEqual(await api.telegram(), { ok: true, value: { connected: true, username: "anna" } });
  const devices = await api.devices();
  assert.equal(devices.ok && devices.value[0].appVersion, "1.18.1");
  assert.deepEqual(await api.removeDevice("dev_0123456789abcdef01234567"), { ok: true, value: true });
  assert.deepEqual(await api.removeDevice("../../admin"), { ok: false, failure: "failed" }, "never a path of its own");
  assert.ok(calls.every((c) => c.headers["X-Ryntra-API"] === "1"));
  assert.equal(calls.at(-1).url, "/api/v1/notifications/devices/dev_0123456789abcdef01234567");
});

test("channels: a missing proof is asked for once, then the change again; the wallet's «no» is an answer", async () => {
  let proven = false;
  const { calls, api } = fakeEngine((url, method) => {
    if (!proven) return { status: 401, body: { error: { code: "UNAUTHORIZED" } } };
    if (method === "POST") return { status: 200, body: { link: "https://t.me/RyntraBot?start=ntf_abcdefghijklmnopqrstuv_1a2b_0123456789abcdef", expiresAt: "2026-10-31T12:15:00.000Z" } };
    return { status: 404, body: null };
  });
  let asked = 0;
  const link = await withProof(() => api.connectTelegram("uk"), async () => ((asked += 1), (proven = true), "ok"));
  assert.equal(asked, 1);
  assert.equal(link.ok && link.value.url.startsWith("https://t.me/RyntraBot?start="), true);
  assert.equal(link.ok && link.value.expiresAt, Date.parse("2026-10-31T12:15:00.000Z"));
  assert.deepEqual(JSON.parse(calls.at(-1).body), { locale: "uk" });
  proven = false;
  assert.deepEqual(await withProof(() => api.connectTelegram("en"), async () => "declined"), { ok: false, failure: "declined" });
  // A link of any other shape is never opened.
  const odd = fakeEngine(() => ({ status: 200, body: { link: "https://evil.example/?start=x" } }));
  assert.deepEqual(await odd.api.connectTelegram("en"), { ok: false, failure: "failed" });
});

test("channels: Telegram connects in the row — the bot's link opens and the row turns connected once Start is pressed", async () => {
  resetChannels();
  let started = false;
  const opened = [];
  const { api } = fakeEngine((url, method) => {
    if (method === "POST") return { status: 200, body: { link: "https://t.me/RyntraBot?start=ntf_abcdefghijklmnopqrstuv_1a2b_0123456789abcdef", expiresAt: "2026-10-31T12:15:00.000Z" } };
    if (url.endsWith("/telegram")) return { status: 200, body: { telegram: { connected: started, username: started ? "anna" : null, connectedAt: null } } };
    return { status: 401, body: null };
  });
  let polls = 0;
  setChannelsEnv({ api, open: (url) => (opened.push(url), true), pollMs: 1, polls: 5, now: () => Date.parse("2026-10-31T12:00:00.000Z"), wait: async () => { polls += 1; if (polls === 2) started = true; } });
  await useChannels.getState().read("Wallet111");
  assert.equal(useChannels.getState().telegram.status, "ready");
  assert.equal(useChannels.getState().devices.status, "signedOut", "a read never asks the wallet by itself");
  await useChannels.getState().connect("Wallet111", "en", async () => "ok");
  assert.equal(opened.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const telegram = useChannels.getState().telegram;
  assert.equal(telegram.status === "ready" && telegram.value.connected, true);
  assert.equal(telegram.status === "ready" && telegram.value.username, "anna");
  assert.equal(useChannels.getState().link, null);
  resetChannels();
});

test("channels: a bot link whose fifteen minutes ran out is never opened again — a fresh one is asked for", async () => {
  resetChannels();
  let clock = Date.parse("2026-10-31T12:00:00.000Z");
  let made = 0;
  const opened = [];
  const { api } = fakeEngine((url, method) => {
    if (method === "POST") {
      made += 1;
      return { status: 200, body: { link: `https://t.me/RyntraBot?start=ntf_abcdefghijklmnopqrstu${made}_1a2b_0123456789abcdef`, expiresAt: new Date(clock + 15 * 60_000).toISOString() } };
    }
    return { status: 200, body: { telegram: { connected: false, username: null, connectedAt: null } } };
  });
  setChannelsEnv({ api, open: (url) => (opened.push(url), true), pollMs: 1, polls: 0, now: () => clock, wait: async () => undefined });
  await useChannels.getState().read("Wallet222");
  await useChannels.getState().connect("Wallet222", "en", async () => "ok");
  await useChannels.getState().connect("Wallet222", "en", async () => "ok");
  assert.equal(made, 1, "within its time the kept link opens again");
  assert.equal(opened[0], opened[1]);
  clock += 20 * 60_000;
  assert.equal(liveLink(useChannels.getState().link), null, "the window no longer offers «Open Telegram»");
  await useChannels.getState().connect("Wallet222", "en", async () => "ok");
  assert.equal(made, 2);
  assert.notEqual(opened[2], opened[0]);
  resetChannels();
});

test("the window lists a kind only where something can say it: the liquidation risk where the Exchange stands", async () => {
  const { kindsShown } = await import("./kinds.ts");
  const { EXCHANGE_SHOWN } = await import("../exchange/flag.ts");
  assert.deepEqual(kindsShown("safety").map((k) => k.id), EXCHANGE_SHOWN ? ["liquidation"] : []);
  assert.equal(kindsShown("market").length, 5);
});
