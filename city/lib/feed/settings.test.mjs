import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SETTINGS, defaultSettings, FEED_KINDS, readSettings, SETTINGS_GROUPS, SETTINGS_KEY, shownKinds, SWITCHES, toggled, touchedIn, writeSettings } from "./settings.ts";
import { flashingOn, hydrateFeed, resetFeed, useFeed } from "./store.ts";

/* CITY-66: «Show on home» — five kinds and the flashing, each a switch kept on this device. */

const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
};

const refusing = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceededError"); } };

test("the panel lists the five kinds, the flashing and the two cards, in the mock's order and words", () => {
  assert.deepEqual(SWITCHES.map((s) => s.label), ["Gainers", "Losers", "Volume", "New coins", "New pools", "Flashing effects", "Hot now card", "Arrivals card"]);
  assert.deepEqual(FEED_KINDS, ["gainers", "losers", "inflows", "coins", "pools"]);
});

test("on a phone the «Hot now» card starts off — it covered half the screen (Owner 28.10) — and a kept choice wins", () => {
  assert.equal(defaultSettings(false, true).hot, false);
  assert.equal(defaultSettings(false, false).hot, true);
  assert.equal(readSettings(null, false, true).hot, false);
  const store = new Map([[SETTINGS_KEY, JSON.stringify({ hot: true })]]);
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(readSettings(storage, false, true).hot, true);
});

test("by default everything is on; a device asking for reduced motion starts with the flashing off", () => {
  assert.deepEqual(defaultSettings(false), DEFAULT_SETTINGS);
  assert.ok(Object.values(DEFAULT_SETTINGS).every(Boolean));
  assert.deepEqual(defaultSettings(true), { ...DEFAULT_SETTINGS, flashing: false });
  assert.deepEqual(readSettings(memoryStorage(), true), { ...DEFAULT_SETTINGS, flashing: false });
  assert.deepEqual(readSettings(null, false), DEFAULT_SETTINGS);
});

test("a switch flipped is kept and read back; only the switches the person touched are written", () => {
  const storage = memoryStorage();
  const off = toggled(toggled(DEFAULT_SETTINGS, "losers", false), "flashing", false);
  assert.equal(writeSettings(storage, off, new Set(["losers", "flashing"])), true);
  assert.deepEqual(JSON.parse(storage.data.get(SETTINGS_KEY)), { losers: false, flashing: false });
  assert.deepEqual(readSettings(storage, false), { ...DEFAULT_SETTINGS, losers: false, flashing: false });
  assert.deepEqual([...touchedIn(storage)].sort(), ["flashing", "losers"]);
  assert.deepEqual([...shownKinds(readSettings(storage, false))], ["gainers", "inflows", "coins", "pools"]);
});

test("reduced motion decides the flashing until the person sets it; the person's own choice then wins", () => {
  const untouched = memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ gainers: false }) });
  assert.equal(readSettings(untouched, true).flashing, false);
  assert.equal(readSettings(untouched, false).flashing, true);
  const chosen = memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ flashing: true }) });
  assert.equal(readSettings(chosen, true).flashing, true);
});

test("a broken or foreign kept value falls back to the defaults, switch by switch", () => {
  for (const raw of ["{", "null", "[]", '"on"', "42", JSON.stringify({ gainers: "no", pools: 0, flashing: null })]) {
    assert.deepEqual(readSettings(memoryStorage({ [SETTINGS_KEY]: raw }), false), DEFAULT_SETTINGS, raw);
  }
  assert.deepEqual(readSettings(memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ pools: false, extra: false }) }), false), { ...DEFAULT_SETTINGS, pools: false });
});

test("a device that refuses storage keeps the defaults and the choice for this visit only", () => {
  assert.deepEqual(readSettings(refusing, true), { ...DEFAULT_SETTINGS, flashing: false });
  assert.equal(writeSettings(refusing, DEFAULT_SETTINGS, new Set(["gainers"])), false);
  assert.equal(writeSettings(null, DEFAULT_SETTINGS, new Set()), false);
  assert.equal(touchedIn(refusing).size, 0);
});

test("the store: hydrated once from the device, a flip is kept, and the flashing question follows the switch", () => {
  resetFeed();
  const storage = memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ inflows: false }) });
  hydrateFeed({ storage, reducedMotion: true });
  let st = useFeed.getState();
  assert.equal(st.ready, true);
  assert.equal(st.settings.inflows, false);
  assert.equal(st.settings.flashing, false);
  assert.equal(flashingOn(), false);
  // A second hydration does nothing: the page reads the device once.
  hydrateFeed({ storage: memoryStorage(), reducedMotion: false });
  assert.equal(useFeed.getState().settings.inflows, false);
  st.set("flashing", true);
  st = useFeed.getState();
  assert.equal(flashingOn(), true);
  assert.deepEqual(JSON.parse(storage.data.get(SETTINGS_KEY)), { inflows: false, flashing: true });
  st.set("gainers", false);
  assert.deepEqual(readSettings(storage, true), { ...DEFAULT_SETTINGS, inflows: false, gainers: false, flashing: true });

  resetFeed();
  hydrateFeed({ storage: refusing, reducedMotion: false });
  useFeed.getState().set("pools", false);
  assert.equal(useFeed.getState().settings.pools, false, "the choice holds for this visit");
  resetFeed();
});

test("the store's step makes events only for the kinds switched on", () => {
  resetFeed();
  hydrateFeed({ storage: memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ gainers: false }) }), reducedMotion: false });
  const now = Date.parse("2026-10-28T12:00:00Z");
  const t = (over) => ({ id: `M${over.symbol}`.padEnd(44, "1"), name: over.symbol, icon: null, district: "strip", price: 1, mcap: 1e8, liquidity: 1e7, holders: 1, change5m: 0, change1h: 0, change24h: 0, volume24h: 0, traders1h: 1, organic: 90, verified: true, launchedAt: null, ...over });
  useFeed.getState().step({ now, city: { towers: [t({ symbol: "UP", change1h: 8 }), t({ symbol: "DN", change1h: -8 })], readAt: now, live: true }, launches: null, pools: null });
  assert.deepEqual(useFeed.getState().memory.events.map((e) => e.kind), ["losers"]);
  resetFeed();
});

/* «Arrivals» — «what is it, I cannot turn it off». A switch beside «Hot now card». */

test("the «Arrivals» card starts off on a phone and on at a desk; a kept choice wins either way", () => {
  assert.equal(defaultSettings(false, true).arrivals, false);
  assert.equal(defaultSettings(false, false).arrivals, true);
  assert.equal(readSettings(null, false, true).arrivals, false);
  assert.equal(readSettings(memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ arrivals: true }) }), false, true).arrivals, true);
  assert.equal(readSettings(memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ arrivals: false }) }), false, false).arrivals, false);
});

test("closing «Arrivals» on a desk sticks: the switch is kept off, and the next visit reads it off", () => {
  resetFeed();
  const storage = memoryStorage();
  hydrateFeed({ storage, reducedMotion: false, phone: false });
  assert.equal(useFeed.getState().settings.arrivals, true, "a desk shows it once");
  // The card's close: the switch off on this device.
  useFeed.getState().set("arrivals", false);
  assert.deepEqual(JSON.parse(storage.data.get(SETTINGS_KEY)), { arrivals: false });
  resetFeed();
  hydrateFeed({ storage, reducedMotion: false, phone: false });
  assert.equal(useFeed.getState().settings.arrivals, false, "a reload keeps it closed");
  // The settings bring it back.
  useFeed.getState().set("arrivals", true);
  assert.equal(readSettings(storage, false, false).arrivals, true);
  resetFeed();
});

test("a phone that never set it keeps «Arrivals» off; a device that keeps nothing still closes it for the visit", () => {
  resetFeed();
  hydrateFeed({ storage: memoryStorage(), reducedMotion: false, phone: true });
  assert.equal(useFeed.getState().settings.arrivals, false);
  resetFeed();
  hydrateFeed({ storage: refusing, reducedMotion: false, phone: false });
  useFeed.getState().set("arrivals", false);
  assert.equal(useFeed.getState().settings.arrivals, false);
  resetFeed();
});

test("the menu's «Settings» groups every switch exactly once: the feed's kinds, the two cards, the flashing", () => {
  const flat = SETTINGS_GROUPS.flat();
  assert.deepEqual([...flat].sort(), SWITCHES.map((s) => s.id).sort());
  assert.equal(new Set(flat).size, flat.length);
  assert.deepEqual(SETTINGS_GROUPS[1], ["hot", "arrivals"]);
  assert.deepEqual(SETTINGS_GROUPS[2], ["flashing"]);
});
