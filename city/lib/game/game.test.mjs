import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CITY_ITEMS, GAME_ITEMS, GAME_WORDS, resetLayer, shownItems, useLayer } from "./layer.ts";
import { DISTRICT_FRAME, districtViews, mapPoint, MOVERS, resetGameMap, topMovers, useGameMap } from "./map.ts";

/* CITY-81, the «Play» layer: the first screen is money; the game is a layer. */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("every visit starts in City; the switch goes to Play and back", () => {
  resetLayer();
  assert.equal(useLayer.getState().layer, "city");
  useLayer.getState().set("play");
  assert.equal(useLayer.getState().layer, "play");
  useLayer.getState().set("city");
  assert.equal(useLayer.getState().layer, "city");
  resetLayer();
});

test("Play is the bottom layer of the city's «Back», not a history entry of its own (CITY-150)", () => {
  const hook = read("../../components/hud/useBackLayers.ts");
  const below = hook.slice(hook.indexOf("const EXTRA_BELOW"), hook.indexOf("];", hook.indexOf("const EXTRA_BELOW")));
  assert.match(below.split("\n").find((line) => line.includes("id: '")) ?? "", /id: 'play'/, "Play is listed first, under every other layer");
  assert.doesNotMatch(read("./layer.ts"), /pushState|history\.back/, "the layer keeps no history of its own");
  assert.doesNotMatch(read("../../components/game/play.ts"), /popstate/, "nor hears it");
});

test("a dock shows only the items whose switch is open, in its order — no «Soon», no lock", () => {
  assert.deepEqual(GAME_ITEMS, ["quarter", "ring", "vault", "hall", "run", "map"]);
  assert.deepEqual(CITY_ITEMS, ["launch", "harbor", "agents", "predict", "exchange"]);
  assert.deepEqual(shownItems(GAME_ITEMS, { quarter: true, ring: false, vault: true, hall: false, run: false, map: true }), ["quarter", "vault", "map"]);
  assert.deepEqual(shownItems(CITY_ITEMS, { predict: true }), ["predict"]);
  assert.deepEqual(shownItems(CITY_ITEMS, {}), []);
});

test("the layer's words: City / Play in English, Місто / Гра ready for the Ukrainian dictionaries", () => {
  assert.equal(GAME_WORDS.en.city, "City");
  assert.equal(GAME_WORDS.en.play, "Play");
  assert.equal(GAME_WORDS.uk.city, "Місто");
  assert.equal(GAME_WORDS.uk.play, "Гра");
  assert.deepEqual(Object.keys(GAME_WORDS.uk).sort(), Object.keys(GAME_WORDS.en).sort());
});

/* The Map: districts and movers from the city's own read. */

const tower = (id, district, over = {}) => ({ id, symbol: id, name: id, icon: `https://logo.test/${id}.png`, district, price: 1, mcap: 1e8, liquidity: 1e7, holders: 1, change5m: 0, change1h: 0, change24h: 0, volume24h: 0, traders1h: 1, organic: 90, verified: true, launchedAt: null, ...over });
const placed = (t, x, z, height) => ({ tower: t, x, z, height, width: 2, kind: 0, seed: 1 });

const LAYOUT = {
  towers: [
    placed(tower("SOL", "core"), 0, 0, 70),
    placed(tower("JUP", "core", { change24h: 3 }), 18, 2, 40),
    ...Array.from({ length: 8 }, (_, i) => placed(tower(`H${i}`, "heights", { change24h: i }), -30 - i, -10, 10 + i)),
    placed(tower("BONK", "strip", { change24h: -22 }), 30, 20, 20),
    placed(tower("NEW", "docks", { change24h: 400 }), -10, 55, 6),
    placed(tower("ANON", "strip", { change24h: 90, verified: false }), 35, 25, 8),
    placed(tower("BARE", "strip", { change24h: 70, icon: null }), 32, 22, 7),
  ],
};

test("each district with towers is named where its towers stand, and frames its tallest few", () => {
  const views = districtViews(LAYOUT);
  assert.deepEqual(views.map((v) => v.id), ["core", "heights", "strip", "docks"]);
  const core = views.find((v) => v.id === "core");
  assert.deepEqual([core.x, core.z], [0, 0], "the core's name stands on the spire");
  const heights = views.find((v) => v.id === "heights");
  assert.equal(heights.name, "DeFi Heights");
  assert.equal(heights.ids.length, DISTRICT_FRAME);
  assert.deepEqual(heights.ids.slice(0, 2), ["H7", "H6"], "tallest first");
  assert.ok(Math.abs(heights.x - -33.5) < 1e-9);
  assert.deepEqual(districtViews({ towers: [] }), []);
});

test("the movers: the biggest 24-hour moves either way, among named coins, launches aside", () => {
  const movers = topMovers(LAYOUT).map((p) => p.tower.id);
  assert.equal(movers.length, MOVERS);
  assert.deepEqual(movers, ["BONK", "H7", "H6"]);
  assert.ok(!movers.includes("NEW") && !movers.includes("ANON"));
  assert.ok(!movers.includes("BARE"), "a coin without a logo from the engine is not offered: no empty circle on the Map");
});

test("the Map is drawn north up, as the opening shot looks at the city", () => {
  assert.deepEqual(mapPoint(0, 0, 80, 200), { left: 100, top: 100 });
  assert.deepEqual(mapPoint(80, -80, 80, 200), { left: 200, top: 0 });
});

test("the Map's view: a tap frames towers; an empty frame clears it; the panel toggles", () => {
  resetGameMap();
  const map = useGameMap.getState();
  map.toggle();
  assert.equal(useGameMap.getState().open, true);
  map.look(["SOL", "JUP"]);
  const first = useGameMap.getState().view;
  assert.deepEqual(first.ids, ["SOL", "JUP"]);
  map.look([]);
  assert.equal(useGameMap.getState().view, null);
  map.look(["BONK"]);
  map.clear();
  assert.equal(useGameMap.getState().view, null);
  map.close();
  assert.equal(useGameMap.getState().open, false);
  resetGameMap();
});

/* The first screen, as the code draws it. */

test("the city's first screen has no game card, no «Soon», no Market tour; Play brings the game's dock and card", () => {
  const hud = read("../../components/hud/Hud.tsx");
  assert.doesNotMatch(hud, /QuarterCard|ResidentCard|ClaimCard/, "the quarter's card is not on the city view");
  assert.doesNotMatch(hud, /Soon|soon|LockedCard|dockLocked/, "a closed district is simply not drawn");
  assert.doesNotMatch(hud, /label="Market"|label="Home"|label="Run"/, "Market, Home and Run left the city's dock");
  // After Play's card, only Launch Night's (CITY-146) — behind its own switch, and only with a show of confirmed launches.
  assert.match(hud, /play \? \(\s*<GameSlot \/>\s*\) : nightCard \? \(\s*<NightCard \/>\s*\) : null/);
  assert.match(read("../launch/night-store.ts"), /if \(!switchOpen\) \{\s*useNight\.setState\(\{ status: 'off' \}\);/);
  assert.doesNotMatch(hud, /<HotCard \/>/, "what moves is in the events under the bell, not a card on the city (30.10)");
  assert.match(hud, /<GameDock /);
  assert.match(hud, /<BrandWithLayers onHome=\{onHome\}>\s*<Brand onHome=\{onHome\} \/>\s*<\/BrandWithLayers>/, "the switch stands next to the brand");
  assert.match(hud, /playEscape\(\);/, "Escape returns from Play, last");
  const dock = read("../../components/game/GameDock.tsx");
  assert.match(dock, /<QuarterCard hot=\{null\} \/>/, "the quarter stays reachable from Play");
});

test("the Predictions billboard is scenery: it opens nothing and takes no tap", () => {
  const board = read("../../components/districts/PredictBillboard.tsx");
  assert.doesNotMatch(board, /openPredictions|pointerup|pointerdown|stopImmediatePropagation/);
});

test("the Predictions billboard carries live figures: it reads the trending list itself, through the window's store", () => {
  const board = read("../../components/districts/PredictBillboard.tsx");
  assert.match(board, /loadList\(TRENDING\.id\)/, "the billboard asks for the day's markets without the window");
  assert.match(board, /if \(st\.open \|\| document\.visibilityState !== 'visible'\) return;/, "never while the window reads, never in a hidden tab");
  assert.doesNotMatch(board, /fetch\(|placeOrder|buy\(|setAmount/, "a read through the store only — never a bet");
});

test("the Vault's door in the scene opens only in Play", () => {
  const vault = read("../../components/vault/VaultTower.tsx");
  assert.match(vault, /layerNow\(\) !== 'play'\) return;/);
});
