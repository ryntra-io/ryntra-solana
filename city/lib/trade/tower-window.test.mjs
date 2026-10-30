import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { escapeTarget, sellLine, sellWords, towerRank, windowTower } from "./tower-window.ts";

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

const towers = [
  { tower: { id: "BONK", verified: true }, height: 40 },
  { tower: { id: "WIF", verified: true }, height: 90 },
  { tower: { id: "pool", verified: false }, height: 12 },
  { tower: { id: "SOL", verified: true }, height: 120 },
];

test("a tap on a named tower or a launch's tower opens its window; a pool without a name does not", () => {
  assert.equal(windowTower(towers, "WIF", false), towers[1]);
  assert.equal(windowTower(towers, "pool", false), null);
  assert.equal(windowTower(towers, "pool", true), towers.find((t) => t.tower.id === "pool"), "a launch's tower is never verified, and still trades (CITY-138)");
  assert.equal(windowTower(towers, null, false), null);
  assert.equal(windowTower(towers, "gone", false), null);
});

test("the rank is the tower's place in the skyline by height", () => {
  assert.equal(towerRank(towers, "SOL"), 1);
  assert.equal(towerRank(towers, "WIF"), 2);
  assert.equal(towerRank(towers, "pool"), 4);
  assert.equal(towerRank(towers, "missing"), 0);
});

test("Sell with nothing to sell is one line, never an empty ticket", () => {
  const some = { spendableRaw: "240000000000", decimals: 9 };
  const none = { spendableRaw: "0", decimals: 9 };
  assert.equal(sellLine("buy", false, false, null), null, "buying always shows the ticket");
  assert.equal(sellLine("sell", false, false, null), "connect");
  assert.equal(sellLine("sell", true, false, null), "reading");
  assert.equal(sellLine("sell", true, true, null), "none");
  assert.equal(sellLine("sell", true, true, none), "none");
  assert.equal(sellLine("sell", true, true, some), null, "a holding sells from the ticket");
  assert.equal(sellWords("none", "$WIF"), "No $WIF in this wallet.");
  assert.equal(sellWords("connect", "$WIF"), "Connect a wallet to sell $WIF.");
  assert.equal(sellWords("reading", "$WIF"), "Reading your wallet…");
  for (const line of ["connect", "reading", "none"]) assert.ok(!sellWords(line, "$WIF").includes("\n"), "one line");
});

test("one window: the tower card is gone, the trade window carries the coin, Buy and Sell are always both there", () => {
  const hud = read("city/components/hud/Hud.tsx");
  assert.doesNotMatch(hud, /function TowerCard\b/, "no tower card of its own");
  assert.doesNotMatch(hud, /TradeAction|Share tower|ChartAction tower|BeaconAction/, "no second Buy, Share, Chart or Beacon");
  assert.match(hud, /<PoolCard \/>/, "a pool without a name keeps its small card");
  assert.throws(() => read("city/components/trade/TradeAction.tsx"), "the tower card's Buy button is gone with it");

  const sheet = read("city/components/trade/TradeSheet.tsx");
  assert.match(sheet, /<CoinPrice tower=\{coin\} chart=\{false\} \/>\s*<TradeChart tower=\{coin\} \/>/, "Spot carries its chart in the window (30.10)");
  assert.match(sheet, /view === 'swap'/, "the plain swap is its own window: pay, flip, get");
  assert.match(sheet, /<CoinFacts tower=\{coin\} rank=\{rank\} \/>/);
  assert.match(sheet, /<ShareTower tower=\{live\} rank=\{rank\} total=\{towers\.length\} \/>/, "Share is a quiet button in the window's head");
  assert.doesNotMatch(sheet, /sellable \|\|/, "the tabs are never hidden behind a holding");
  assert.match(sheet, /<div className=\{s\.sides\} role="tablist" aria-label=\{w\.buyOrSell\}>/);
  assert.match(sheet, /<NothingToSell line=\{nothing\}/);

  // The words come from the window's dictionary (CITY-79): the same English, and Ukrainian beside it.
  const facts = read("city/components/trade/CoinFacts.tsx");
  const words = read("city/components/trade/words.ts");
  for (const [key, label] of [["mktCap", "Mkt cap"], ["liquidity", "Liquidity"], ["traders1h", "Traders 1h"], ["rank", "Rank"]]) {
    assert.match(facts, new RegExp(`label=\\{w\\.${key}\\}`));
    assert.match(words, new RegExp(`${key}: '${label}'`));
  }
  assert.match(facts, /aria-label=\{w\.shareTower\}/);
  assert.match(facts, /aria-expanded=\{open\}>\s*\{w\.details\}/, "the rest waits behind Details");
  assert.match(facts, /<ChartAction tower=\{tower\} \/>/);

  const layer = read("city/components/trade/TradeLayer.tsx");
  assert.match(layer, /windowTower\(towers, selectedId, launchTower\)/, "a tap on a tower opens the window");
  assert.match(layer, /trade\.openFor\(tower, 'buy', \{ launch: launchTowerIn\(useLaunch\.getState\(\), picked\) !== null \}\)/, "a launch's tower opens the same window, on the Launch engine (CITY-138)");
  assert.match(sheet, /if \(launch\) return <LaunchTowerBody token=\{tower\.mint\} onBusy=\{holdWindow\} \/>;/, "the window shows a launch's Buy and Sell on its curve or pool");
  assert.match(layer, /if \(city\.selectedId === before\.tower\.mint\) city\.select\(null\);/, "the window closed lets the tower go");
});

test("the window changes no part of the engine: it reads the price's passport and opens the same card", () => {
  const facts = read("city/components/trade/CoinFacts.tsx");
  const issuer = read("city/lib/trade/issuer.ts");
  for (const file of [facts, issuer, read("city/lib/trade/tower-window.ts")]) {
    assert.doesNotMatch(file, /fetch\(|['"]\/api\/|signTransaction|sendTransaction/);
  }
  assert.match(facts, /st\.quote\.body\.passports/);
});

test("Escape closes one thing per press: the chart standing in the window's place first, then the window", () => {
  const at = (on) => escapeTarget({ prevented: false, busy: false, chart: false, beacon: false, ...on });
  assert.equal(at({}), "window");
  // The chart's layer leaves the key to an open window: the window must close the chart, or Escape closes nothing.
  assert.equal(at({ chart: true }), "chart");
  assert.equal(at({ beacon: true }), "none", "the beacon's editor hears the key first");
  assert.equal(at({ prevented: true }), "none", "a panel that took the key already: nothing more closes");
  assert.equal(at({ prevented: true, chart: true }), "none");
  assert.equal(at({ busy: true, chart: true }), "window", "under a signature the window is in front; it refuses to close");

  const layer = read("city/components/trade/TradeLayer.tsx");
  assert.match(layer, /prevented: event\.defaultPrevented/);
  assert.match(layer, /target === 'chart'\) \{\s*event\.preventDefault\(\);\s*useTowerChart\.getState\(\)\.close\(\);/);
  const chart = read("city/components/chart/ChartLayer.tsx");
  assert.match(chart, /useTrade\.getState\(\)\.open/, "the chart's own Escape still steps aside for an open trade window");
});

test("the window's coin logo is never an empty disc: the coin's letter stands under it, per coin", () => {
  const sheet = read("city/components/trade/TradeSheet.tsx");
  const icon = sheet.slice(sheet.indexOf("function TokenIcon"));
  assert.match(icon, /<span className=\{s\.iconLetter\}>\{monogram\(tower\.symbol\)\}<\/span>/);
  assert.match(icon, /state\.mint === tower\.mint \? state\.attempt : 0/, "another coin starts from its own first try");
  assert.match(icon, /iconAttempt\(attempt\)/, "a busy gateway is asked once more");
  assert.doesNotMatch(icon, /return <span className=\{s\.icon\} \/>/, "no bare disc");
});

test("a figure the source did not measure is a calm dash in the window's cells, its words a tooltip", () => {
  const facts = read("city/components/trade/CoinFacts.tsx");
  assert.match(facts, /tower\.unread\?\.includes\(figure\) \? UNMEASURED : format\(tower\[figure\]\)/);
  assert.match(facts, /const UNMEASURED = '—';/);
  for (const figure of ["mcap", "liquidity", "traders1h"]) {
    assert.ok(facts.includes(`value={cell(tower, '${figure}', `) && facts.includes(`title={unmeasured(tower, '${figure}')}`), figure);
  }
  assert.ok(facts.includes("{cell(tower, 'price', formatPrice)}"), "the price line too");
});

test("the fee, the least you get and any warning are read before the press: they stand in the pinned dock with the action", () => {
  // A card taller than its room (Ukrainian, a short phone) scrolls under the pinned action: whatever must be read before
  // the signature lives inside that dock, never above it where the dock would cover it at rest.
  const dockOf = (source, from) => {
    const at = source.indexOf("<div className={s.dock}>", from);
    assert.ok(at > 0, "a pinned dock");
    // The dock's own lines: from its opening to the action it ends with.
    const end = source.indexOf("Action", source.indexOf("<Notes", at) > 0 ? at : at);
    return source.slice(at, source.indexOf("/>", source.indexOf("Action", end + 1)) + 2);
  };
  const sheet = read("city/components/trade/TradeSheet.tsx");
  const market = dockOf(sheet, sheet.indexOf("{figures && details && <Details"));
  assert.ok(market.indexOf("<Terms") > 0 && market.indexOf("<Terms") < market.indexOf("<Notes") && market.indexOf("<Notes") < market.indexOf("<Action"), "Terms, Notes, then Action");
  const spot = read("city/components/trade/SpotTicket.tsx");
  const order = dockOf(spot, 0);
  assert.ok(order.indexOf("{terms}") > 0 && order.indexOf("{terms}") < order.indexOf("<SpotNotes") && order.indexOf("<SpotNotes") < order.indexOf("<SpotAction"), "the order's terms, notes, then the action");
  assert.doesNotMatch(read("city/components/trade/trade.module.css"), /\.action \{[^}]*position: sticky/, "the button alone is never the pinned piece");

  for (const file of ["city/components/money/Send.tsx", "city/components/money/Bridge.tsx"]) {
    const source = read(file);
    const at = source.indexOf("<div className={s.dock}>");
    assert.ok(at > 0, `${file}: a pinned dock`);
    const dock = source.slice(at);
    assert.ok(/<Review \/>|s\.review/.test(dock) && dock.indexOf("s.cta") > 0, `${file}: the review and the action in one dock`);
  }
  assert.doesNotMatch(read("city/components/money/money.module.css"), /\.cta \{[^}]*position: sticky/, "Money's button is not pinned alone");
});
