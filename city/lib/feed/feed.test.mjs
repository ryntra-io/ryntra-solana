import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { advance, directionOf, emptyFeed, FEED, fallOf, freshRead, gainers, inflows, losers, newCoins, newPools, riseOf, visibleEvents } from "./feed.ts";
import { ago, money, move } from "./format.ts";
import { FEED_KINDS } from "./settings.ts";

/* CITY-66: the home's live event feed — what it picks, in what order, from which reads, and what it never says. */

const NOW = Date.parse("2026-10-28T12:00:00Z");
const MIN = 60_000;
const ALL = new Set(FEED_KINDS);

let n = 0;
const mint = () => `Mint${String(++n).padStart(40, "x")}`;

const tower = (over = {}) => ({
  id: mint(),
  symbol: "COIN",
  name: "Coin",
  icon: "https://example.com/coin.png",
  district: "strip",
  price: 1,
  mcap: 50_000_000,
  liquidity: 2_000_000,
  holders: 10_000,
  change5m: 0,
  change1h: 0,
  change24h: 0,
  volume24h: 0,
  traders1h: 100,
  organic: 80,
  verified: true,
  launchedAt: null,
  ...over,
});

const launch = (over = {}) => ({
  token: mint(),
  symbol: "NOVA",
  name: "Nova",
  image: "/api/launch/image/" + "a".repeat(64),
  launchedAt: new Date(NOW - 30 * MIN).toISOString(),
  creator: null,
  preset: "classic",
  graduationUsd: 75_000,
  progress: 12,
  migrated: false,
  marketCapUsd: 9_000,
  liquidityUsd: 4_000,
  holders: 12,
  holdersAtLeast: false,
  checks: ["pending", "pending", "pending"],
  phase: "ascent",
  crew: 0,
  ryntraTest: false,
  network: "solana:mainnet",
  mine: false,
  ...over,
});

const pool = (over = {}) => ({
  kind: "dlmm",
  address: mint(),
  pair: "SOL-USDC",
  x: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9, priceUsd: 180 },
  y: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, priceUsd: 1 },
  price: 180,
  tvlUsd: 8_100_000,
  volume24hUsd: 2_400_000,
  fees24hUsd: 3_000,
  lpFees24hUsd: 2_700,
  feePct: 0.1,
  binStepBps: 10,
  band: null,
  ...over,
});

const read = (towers, readAt = NOW - 10_000, live = true) => ({ towers, readAt, live });
const input = (over = {}) => ({ now: NOW, city: null, launches: null, pools: null, ...over });

test("thresholds: a rise needs +2% in the hour or +5% in the day; a fall −2% or −5%; the stronger by its bar wins", () => {
  assert.equal(riseOf({ change1h: 1.9, change24h: 4.9 }), null);
  assert.deepEqual(riseOf({ change1h: 2, change24h: 0 }), { window: "1h", change: 2, score: 1 });
  assert.deepEqual(riseOf({ change1h: 0, change24h: 5 }), { window: "24h", change: 5, score: 1 });
  // +6% in the hour is three bars; +10% in the day is two: the hour speaks.
  assert.equal(riseOf({ change1h: 6, change24h: 10 }).window, "1h");
  assert.equal(riseOf({ change1h: 2.5, change24h: 30 }).window, "24h");
  assert.equal(fallOf({ change1h: -1.9, change24h: -4.9 }), null);
  assert.deepEqual(fallOf({ change1h: -2, change24h: 3 }), { window: "1h", change: -2, score: 1 });
  assert.equal(fallOf({ change1h: -1, change24h: -12 }).window, "24h");
  // A rise is never a fall.
  assert.equal(fallOf({ change1h: 8, change24h: 20 }), null);
  assert.equal(riseOf({ change1h: -8, change24h: -20 }), null);
  // Missing or broken numbers move nothing.
  assert.equal(riseOf({ change1h: NaN, change24h: undefined }), null);
});

test("gainers and losers: named, deep towers only, strongest first, the figure and its window as read", () => {
  const bonk = tower({ symbol: "Bonk", change1h: 12.4, change24h: 20 });
  const wif = tower({ symbol: "$WIF", change24h: 9 });
  const jup = tower({ symbol: "JUP", change1h: -6.1 });
  const thin = tower({ symbol: "THIN", change1h: 40, liquidity: 99_000 });
  const anon = tower({ symbol: "ANON", change1h: 40, verified: false });
  const dock = tower({ symbol: "DOCK", change1h: 40, district: "docks" });
  const noPrice = tower({ symbol: "ZERO", change1h: 40, price: 0 });
  const towers = [wif, bonk, jup, thin, anon, dock, noPrice];
  const up = gainers(towers, NOW);
  assert.deepEqual(up.map((e) => e.title), ["Bonk", "WIF"]);
  assert.equal(up[0].line, "+12.4% · 1h");
  assert.equal(up[1].line, "+9.0% · 24h");
  assert.equal(up[0].tone, "up");
  assert.equal(up[0].source, "Jupiter");
  assert.equal(up[0].at, NOW);
  assert.deepEqual(up[0].target, { tower: bonk.id });
  assert.equal(up[0].image, `/api/icon/${bonk.id}`);
  const down = losers(towers, NOW);
  assert.deepEqual(down.map((e) => e.title), ["JUP"]);
  assert.equal(down[0].line, "−6.1% · 1h");
  assert.equal(down[0].tone, "down");
  assert.ok(up.length <= FEED.candidates && down.length <= FEED.candidates);
});

test("one way per coin: a coin up in the hour and down in the day is said once, by its stronger move", () => {
  // +10.3% in the hour is 5.15 bars; −16% in the day is 3.2 bars: a gainer, never also a loser.
  const dope = tower({ symbol: "DOPE", change1h: 10.3, change24h: -16 });
  // −3% in the hour is 1.5 bars; +30% in the day is 6 bars: a gainer by its day.
  const swing = tower({ symbol: "SWING", change1h: -3, change24h: 30 });
  const slide = tower({ symbol: "SLIDE", change1h: 2.2, change24h: -40 });
  assert.equal(directionOf(dope), "up");
  assert.equal(directionOf(swing), "up");
  assert.equal(directionOf(slide), "down");
  assert.equal(directionOf({ change1h: 1, change24h: -1 }), null);
  const towers = [dope, swing, slide];
  assert.deepEqual(gainers(towers, NOW).map((e) => `${e.title} ${e.line}`), ["SWING +30.0% · 24h", "DOPE +10.3% · 1h"]);
  assert.deepEqual(losers(towers, NOW).map((e) => `${e.title} ${e.line}`), ["SLIDE −40.0% · 24h"]);
});

test("inflows say what the engine has — 24h volume on the card, liquidity behind the «i» — never «inflow»; stablecoins are not money going somewhere", () => {
  const sol = tower({ symbol: "SOL", volume24h: 900_000_000, liquidity: 800_000_000 });
  const usdc = tower({ symbol: "USDC", volume24h: 2_000_000_000 });
  const small = tower({ symbol: "TINY", volume24h: 200_000 });
  const deep = pool({ volume24hUsd: 2_400_000, tvlUsd: 8_100_000 });
  const flows = inflows([usdc, small, sol], NOW, { pools: [deep, pool({ volume24hUsd: null })], at: NOW - MIN });
  assert.deepEqual(flows.map((e) => e.key), [`inflows:${sol.id}`, `inflows:pool:${deep.address}`]);
  assert.equal(flows[0].title, "$900.0M · 24h volume");
  assert.equal(flows[0].line, "SOL");
  assert.equal(flows[0].detail, "$800.0M liquidity");
  assert.equal(flows[1].title, "$2.4M · 24h volume");
  assert.equal(flows[1].line, "SOL-USDC pool");
  assert.equal(flows[1].detail, "$8.1M liquidity");
  assert.equal(flows[1].source, "Meteora DLMM");
  assert.deepEqual(flows[1].target, { pool: deep.address });
  assert.equal(flows[1].at, NOW - MIN);
  for (const e of flows) {
    assert.doesNotMatch(`${e.title} ${e.line} ${e.detail}`, /inflow/i);
    // One figure on the card: the volume.
    assert.doesNotMatch(e.line, /\$/);
  }
  // No Harbor read: the coins alone.
  assert.equal(inflows([sol], NOW, null).length, 1);
});

test("new coins: Ryntra launches of the last day, newest first, never a test launch or a lost signal", () => {
  const fresh = launch({ symbol: "NOVA", launchedAt: new Date(NOW - 2 * 3_600_000).toISOString() });
  const newer = launch({ symbol: "PIP", launchedAt: new Date(NOW - 5 * MIN).toISOString() });
  const old = launch({ launchedAt: new Date(NOW - 25 * 3_600_000).toISOString() });
  const test1 = launch({ ryntraTest: true });
  const lost = launch({ phase: "lost" });
  const undated = launch({ launchedAt: null });
  const coins = newCoins([fresh, old, test1, lost, undated, newer], NOW);
  assert.deepEqual(coins.map((e) => e.line), ["$PIP launched on Ryntra", "$NOVA launched on Ryntra"]);
  assert.equal(coins[0].title, "New coin");
  assert.equal(coins[0].source, "Ryntra Launch");
  assert.equal(coins[1].at, NOW - 2 * 3_600_000);
  assert.deepEqual(coins[0].target, { tower: newer.token });
  assert.deepEqual(newCoins(null, NOW), []);
});

test("new pools come from the docks; an unverified coin stays unnamed, the city's way, and a Ryntra launch is not counted twice", () => {
  const anon = tower({ symbol: "SCAM", district: "docks", verified: false, liquidity: 40_000, launchedAt: new Date(NOW - 20 * MIN).toISOString() });
  const named = tower({ symbol: "JTO", district: "docks", verified: true, liquidity: 90_000, launchedAt: new Date(NOW - 90 * MIN).toISOString() });
  const ours = tower({ symbol: "NOVA", district: "docks", verified: false, launchedAt: new Date(NOW - 5 * MIN).toISOString() });
  const stale = tower({ district: "docks", launchedAt: new Date(NOW - 30 * 3_600_000).toISOString() });
  const pools = newPools([named, anon, ours, stale], new Set([ours.id]), NOW);
  assert.deepEqual(pools.map((e) => e.key), [`pools:${anon.id}`, `pools:${named.id}`]);
  assert.equal(pools[0].title, "New pool");
  assert.equal(pools[0].line, "Unverified · $40K liquidity");
  assert.equal(pools[0].image, null);
  assert.doesNotMatch(pools[0].line, /SCAM/);
  assert.equal(pools[1].line, "$JTO · $90K liquidity");
});

test("the first fresh read fills the feed with one event of each kind, in the order of the switches", () => {
  const bonk = tower({ symbol: "BONK", change1h: 12.4, volume24h: 1_000_000 });
  const jup = tower({ symbol: "JUP", change1h: -6.1 });
  const sol = tower({ symbol: "SOL", volume24h: 900_000_000 });
  const dock = tower({ district: "docks", verified: false, launchedAt: new Date(NOW - 2 * 3_600_000).toISOString() });
  const coin = launch({ launchedAt: new Date(NOW - 2 * 3_600_000).toISOString() });
  const memory = advance(emptyFeed(), input({ city: read([bonk, jup, sol, dock]), launches: [coin] }), ALL);
  assert.deepEqual(
    memory.events.map((e) => e.kind),
    ["gainers", "losers", "inflows", "coins", "pools"],
  );
  assert.equal(memory.events[0].title, "BONK");
  assert.equal(memory.events[2].title, "$900.0M · 24h volume");
  // Arrival order: the top is the latest id.
  const ids = memory.events.map((e) => e.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
  assert.equal(new Set(ids).size, ids.length);
});

test("after the first read: one move a read in turn, a new event on top and the older ones moved down", () => {
  const a = tower({ symbol: "A", change1h: 9 });
  const b = tower({ symbol: "B", change1h: 5 });
  const c = tower({ symbol: "C", change1h: -7 });
  const d = tower({ symbol: "D", change1h: -3 });
  let memory = advance(emptyFeed(), input({ city: read([a, b, c, d], NOW - 2 * MIN) }), new Set(["gainers", "losers"]));
  assert.deepEqual(memory.events.map((e) => e.title), ["A", "C"]);
  memory = advance(memory, input({ city: read([a, b, c, d], NOW - MIN) }), new Set(["gainers", "losers"]));
  assert.deepEqual(memory.events.map((e) => e.title), ["B", "A", "C"]);
  memory = advance(memory, input({ city: read([a, b, c, d], NOW) }), new Set(["gainers", "losers"]));
  assert.deepEqual(memory.events.map((e) => e.title), ["D", "B", "A", "C"]);
  // Nothing new to say: a read that only repeats keeps the feed as it is.
  const quiet = advance(memory, input({ now: NOW + MIN, city: read([a, b, c, d], NOW + MIN) }), new Set(["gainers", "losers"]));
  assert.deepEqual(quiet.events.map((e) => e.title), ["D", "B", "A", "C"]);
});

test("a tower speaks once per repeat window, then may speak again with its new figure", () => {
  const a = tower({ symbol: "A", change1h: 9 });
  const shown = new Set(["gainers"]);
  let memory = advance(emptyFeed(), input({ city: read([a], NOW) }), shown);
  for (let k = 1; k <= 5; k += 1) memory = advance(memory, input({ now: NOW + k * MIN, city: read([a], NOW + k * MIN) }), shown);
  assert.equal(memory.events.length, 1);
  const later = NOW + FEED.repeatMs;
  memory = advance(memory, input({ now: later, city: read([{ ...a, change1h: 14 }], later) }), shown);
  assert.equal(memory.events.length, 2);
  assert.equal(memory.events[0].line, "+14.0% · 1h");
  assert.equal(memory.events[1].line, "+9.0% · 1h");
});

test("the same read twice makes nothing; a snapshot or a stale read makes no market event", () => {
  const a = tower({ symbol: "A", change1h: 9 });
  const once = advance(emptyFeed(), input({ city: read([a]) }), ALL);
  assert.equal(advance(once, input({ city: read([{ ...a, symbol: "B" }]) }), ALL), once);
  assert.equal(advance(emptyFeed(), input({ city: read([a], NOW, false) }), ALL).events.length, 0);
  assert.equal(advance(emptyFeed(), input({ city: read([a], NOW - FEED.staleMs - 1) }), ALL).events.length, 0);
  assert.equal(freshRead(read([a], NOW - FEED.staleMs), NOW), true);
  assert.equal(freshRead(null, NOW), false);
});

test("a device clock running behind the server still gets the market's events, dated now", () => {
  const a = tower({ symbol: "A", change1h: 9 });
  const memory = advance(emptyFeed(), input({ city: read([a], NOW + 10 * MIN) }), new Set(["gainers"]));
  assert.deepEqual(memory.events.map((e) => e.title), ["A"]);
  assert.equal(memory.events[0].at, NOW);
});

test("an older cached copy of the read is not a new read", () => {
  const a = tower({ symbol: "A", change1h: 9 });
  const b = tower({ symbol: "B", change1h: 5 });
  const shown = new Set(["gainers"]);
  const memory = advance(emptyFeed(), input({ city: read([a, b], NOW) }), shown);
  assert.equal(advance(memory, input({ now: NOW + MIN, city: read([a, b], NOW - MIN) }), shown), memory);
});

test("empty and broken answers: no towers, no launches, a Harbor that failed, junk rows — an empty feed, never a throw", () => {
  const junk = [null, undefined, {}, { id: 3 }, { id: mint(), symbol: "X", verified: true, district: "strip", liquidity: "lots", price: 1, change1h: "9" }];
  const empty = emptyFeed();
  assert.equal(advance(empty, input(), ALL), empty);
  for (const city of [read([]), read(junk), { towers: null, readAt: NOW, live: true }, { towers: [], readAt: NaN, live: true }]) {
    const memory = advance(emptyFeed(), input({ city, launches: [null, { token: 5 }, launch({ launchedAt: "not a date" })], pools: { pools: [null, { address: 1 }], at: NOW } }), ALL);
    assert.deepEqual(memory.events, []);
  }
  assert.deepEqual(inflows(null, NOW, { pools: null, at: NOW }), []);
  assert.deepEqual(newPools(undefined, new Set(), NOW), []);
});

test("a Harbor read older than ten minutes is not used for inflows", () => {
  const deep = pool();
  const fresh = advance(emptyFeed(), input({ city: read([]), pools: { pools: [deep], at: NOW - 9 * MIN } }), new Set(["inflows"]));
  assert.equal(fresh.events[0]?.key, `inflows:pool:${deep.address}`);
  const old = advance(emptyFeed(), input({ city: read([]), pools: { pools: [deep], at: NOW - 11 * MIN } }), new Set(["inflows"]));
  assert.equal(old.events.length, 0);
});

test("only the kinds switched on get events; a kind switched on later starts with its own first event", () => {
  const a = tower({ symbol: "A", change1h: 9 });
  const c = tower({ symbol: "C", change1h: -7 });
  let memory = advance(emptyFeed(), input({ city: read([a, c], NOW - MIN) }), new Set(["losers"]));
  assert.deepEqual(memory.events.map((e) => e.kind), ["losers"]);
  // Switched on between two reads: its first event comes from the read on screen, without waiting for the next.
  memory = advance(memory, input({ city: read([a, c], NOW - MIN) }), new Set(["losers", "gainers"]));
  assert.deepEqual(memory.events.map((e) => `${e.kind}:${e.title}`), ["gainers:A", "losers:C"]);
  // The read on screen moves nothing else.
  assert.equal(advance(memory, input({ city: read([a, c], NOW - MIN) }), new Set(["losers", "gainers"])), memory);
});

test("new coins and pools: the newest first, then only ones newer than the last said, a pool at most once in two minutes", () => {
  const older = launch({ symbol: "OLD", launchedAt: new Date(NOW - 3 * 3_600_000).toISOString() });
  const newest = launch({ symbol: "NEW", launchedAt: new Date(NOW - 3_600_000).toISOString() });
  let memory = advance(emptyFeed(), input({ launches: [older, newest] }), ALL);
  assert.deepEqual(memory.events.map((e) => e.line), ["$NEW launched on Ryntra"]);
  // The older launch was there from the start: it is not news later.
  memory = advance(memory, input({ now: NOW + 30_000, launches: [older, newest] }), ALL);
  assert.equal(memory.events.length, 1);
  const born = launch({ symbol: "BORN", launchedAt: new Date(NOW + 20_000).toISOString() });
  const twin = launch({ symbol: "TWIN", launchedAt: new Date(NOW + 25_000).toISOString() });
  memory = advance(memory, input({ now: NOW + 60_000, launches: [older, newest, born, twin] }), ALL);
  assert.deepEqual(memory.events.map((e) => e.line), ["$TWIN launched on Ryntra", "$BORN launched on Ryntra", "$NEW launched on Ryntra"]);

  const p1 = tower({ district: "docks", verified: false, launchedAt: new Date(NOW - 50 * MIN).toISOString() });
  const p0 = tower({ district: "docks", verified: false, launchedAt: new Date(NOW - 80 * MIN).toISOString() });
  let pools = advance(emptyFeed(), input({ city: read([p0, p1], NOW) }), new Set(["pools"]));
  assert.deepEqual(pools.events.map((e) => e.key), [`pools:${p1.id}`]);
  const p2 = tower({ district: "docks", verified: false, launchedAt: new Date(NOW - 10_000).toISOString() });
  pools = advance(pools, input({ now: NOW + MIN, city: read([p0, p1, p2], NOW + MIN) }), new Set(["pools"]));
  assert.equal(pools.events.length, 1, "within two minutes of the last pool");
  pools = advance(pools, input({ now: NOW + 2 * MIN, city: read([p0, p1, p2], NOW + 2 * MIN) }), new Set(["pools"]));
  assert.deepEqual(pools.events.map((e) => e.key), [`pools:${p2.id}`, `pools:${p1.id}`]);
});

test("the feed keeps a bounded memory, and the screen shows the switched-on kinds only, newest first", () => {
  const shown = new Set(["gainers", "losers"]);
  const towers = Array.from({ length: 80 }, (_, k) => tower({ symbol: `T${k}`, change1h: k % 2 ? 3 + k : -(3 + k) }));
  let memory = emptyFeed();
  for (let k = 0; k < 60; k += 1) memory = advance(memory, input({ now: NOW + k * FEED.repeatMs, city: read(towers, NOW + k * FEED.repeatMs) }), shown);
  for (const kind of shown) assert.ok(memory.events.filter((e) => e.kind === kind).length <= FEED.keep);
  assert.ok(memory.events.length <= FEED.keep * shown.size);
  assert.equal(visibleEvents(memory.events, new Set(["losers"]), 3).every((e) => e.kind === "losers"), true);
  assert.equal(visibleEvents(memory.events, shown, 5).length, 5);
  assert.deepEqual(visibleEvents(memory.events, new Set(), 5), []);
  assert.deepEqual(visibleEvents(memory.events, shown, -1), []);
  const top = visibleEvents(memory.events, shown, 5).map((e) => e.id);
  assert.deepEqual(top, [...top].sort((a, b) => b - a));
});

test("every event carries its time and its source, and every figure on it is one the reads gave", () => {
  const snapshot = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
  const readAt = NOW - 5_000;
  const memory = advance(emptyFeed(), input({ city: read(snapshot.towers, readAt) }), ALL);
  assert.ok(memory.events.length > 0);
  for (const e of memory.events) {
    assert.ok(Number.isFinite(e.at) && e.at <= NOW, `${e.key} has a time`);
    assert.ok(["Jupiter", "Ryntra Launch", "Meteora DLMM", "Meteora DAMM v2"].includes(e.source), `${e.key} has a source`);
    const t = snapshot.towers.find((x) => x.id === e.target.tower);
    assert.ok(t, `${e.key} points at a tower of the read`);
    if (e.kind === "gainers" || e.kind === "losers") {
      const m = e.kind === "gainers" ? riseOf(t) : fallOf(t);
      assert.equal(e.line, move(m.change, m.window));
    }
    if (e.kind === "inflows") assert.equal(e.title, `${money(t.volume24h)} · 24h volume`);
  }
});

test("a burst of launches is said over a few steps, none dropped", () => {
  const first = launch({ symbol: "ONE", launchedAt: new Date(NOW - 10 * MIN).toISOString() });
  let memory = advance(emptyFeed(), input({ launches: [first] }), ALL);
  const burst = ["B1", "B2", "B3"].map((symbol, k) => launch({ symbol, launchedAt: new Date(NOW + (k + 1) * 1_000).toISOString() }));
  const later = NOW + 10_000;
  memory = advance(memory, input({ now: later, launches: [first, ...burst] }), ALL);
  memory = advance(memory, input({ now: later + 30_000, launches: [first, ...burst] }), ALL);
  assert.deepEqual(memory.events.map((e) => e.line), ["$B3 launched on Ryntra", "$B2 launched on Ryntra", "$B1 launched on Ryntra", "$ONE launched on Ryntra"]);
});

test("a coin launched on devnet is not news of the market: only mainnet launches join, and the feed never says «devnet»", () => {
  const main = launch({ symbol: "MAIN" });
  const devnet = launch({ symbol: "TEST", network: "solana:devnet" });
  const unknown = launch({ symbol: "ODD", network: null });
  assert.deepEqual(newCoins([devnet, main, unknown], NOW).map((e) => e.line), ["$MAIN launched on Ryntra"]);
  assert.deepEqual(newCoins([devnet], NOW), []);
  const memory = advance(emptyFeed(), input({ launches: [devnet] }), ALL);
  assert.equal(memory.events.length, 0);
  for (const e of newCoins([main], NOW)) assert.doesNotMatch(`${e.title} ${e.line} ${e.source} ${e.detail ?? ""}`, /devnet/i);
});

test("the market's moves never push a launch out of memory", () => {
  const coin = launch({ symbol: "KEEP" });
  const towers = Array.from({ length: 80 }, (_, k) => tower({ symbol: `T${k}`, change1h: 3 + k }));
  let memory = advance(emptyFeed(), input({ launches: [coin] }), ALL);
  for (let k = 0; k < 60; k += 1) memory = advance(memory, input({ now: NOW + k * FEED.repeatMs, city: read(towers, NOW + k * FEED.repeatMs), launches: [coin] }), ALL);
  assert.deepEqual(visibleEvents(memory.events, new Set(["coins"]), 5).map((e) => e.line), ["$KEEP launched on Ryntra"]);
});

test("prices and spoken keys older than a day are let go", () => {
  const a = tower({ symbol: "A", change1h: 9 });
  const gone = tower({ symbol: "GONE", change1h: 0.5 });
  const shown = new Set(["gainers"]);
  let memory = advance(emptyFeed(), input({ city: read([a, gone], NOW) }), shown);
  assert.ok(memory.history.has(gone.id) && memory.spoke.has(`gainers:${a.id}`));
  const later = NOW + 26 * 3_600_000;
  memory = advance(memory, input({ now: later, city: read([], later) }), shown);
  assert.equal(memory.history.has(gone.id), false);
  assert.equal(memory.spoke.has(`gainers:${a.id}`), false);
});

test("time reads short: now, minutes, hours, days; a clock ahead is now", () => {
  assert.equal(ago(NOW, NOW), "now");
  assert.equal(ago(NOW + MIN, NOW), "now");
  assert.equal(ago(NOW - 44_000, NOW), "now");
  assert.equal(ago(NOW - 2 * MIN, NOW), "2m");
  assert.equal(ago(NOW - 2 * 3_600_000, NOW), "2h");
  assert.equal(ago(NOW - 50 * 3_600_000, NOW), "2d");
  assert.equal(ago(NOW - 59.5 * MIN, NOW), "59m");
  assert.equal(money(2_400_000), "$2.4M");
  assert.equal(money(999_600), "$1.0M");
  assert.equal(money(999.7), "$1K");
  assert.equal(money(999_999_000_0), "$10.00B");
  assert.equal(money(NaN), "$0");
});

test("a pool with no money in it is no news: «New pool · $0 liquidity» never stands in the feed (CITY-200)", () => {
  const empty = tower({ district: "docks", verified: false, liquidity: 0, launchedAt: new Date(NOW - 10 * MIN).toISOString() });
  const unread = tower({ district: "docks", verified: false, liquidity: undefined, launchedAt: new Date(NOW - 10 * MIN).toISOString() });
  const real = tower({ district: "docks", verified: false, liquidity: 5_000, launchedAt: new Date(NOW - 10 * MIN).toISOString() });
  assert.deepEqual(newPools([empty, unread, real], new Set(), NOW).map((e) => e.key), [`pools:${real.id}`]);
});
