import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DEPTH } from "./depth-words.ts";
import { DEFAULT_FILTERS, DEFAULT_SORT, ageParts, countText, timePath, buyShare, dayLine, depthRows, filtersOn, fitColumns, nextSort, passes } from "./depth-view.ts";

const NOW = Date.parse("2026-11-16T20:00:00Z");
const stats = (change, extra = {}) => ({ change, volume: 1000, buys: 30, sells: 10, traders: 12, ...extra });
const coin = (over = {}) => ({
  id: "So11111111111111111111111111111111111111112",
  symbol: "AAA",
  name: "Aaa",
  icon: null,
  price: 2,
  mcap: 2_000_000,
  liquidity: 200_000,
  holders: 5_000,
  organic: 80,
  verified: true,
  stock: false,
  bornAt: "2026-11-15T20:00:00Z",
  mint: "off",
  freeze: "off",
  topHolders: 20,
  stats: { "5m": stats(0.5), "1h": stats(1), "6h": stats(-3), "24h": stats(100) },
  ...over,
});
const view = (over = {}) => ({ filters: DEFAULT_FILTERS, window: "1h", sort: DEFAULT_SORT, query: "", now: NOW, ...over });

test("«Verified only» stands on by default and hides a coin nobody vetted", () => {
  assert.equal(DEFAULT_FILTERS.verified, true);
  assert.equal(passes(coin({ verified: false }), DEFAULT_FILTERS, "1h", NOW), false);
  assert.equal(passes(coin({ verified: false }), { ...DEFAULT_FILTERS, verified: false }, "1h", NOW), true);
});

test("a floor never passes a figure Jupiter did not measure", () => {
  const f = { ...DEFAULT_FILTERS, holders: 1_000 };
  assert.equal(passes(coin(), f, "1h", NOW), true);
  assert.equal(passes(coin({ holders: null }), f, "1h", NOW), false);
  assert.equal(passes(coin({ holders: 10 }), f, "1h", NOW), false);
  assert.equal(filtersOn(f), 1);
});

test("the volume floor and the move read the window on screen", () => {
  const c = coin({ stats: { "5m": stats(-1, { volume: 10 }), "1h": stats(2, { volume: 50_000 }), "6h": null, "24h": stats(1) } });
  assert.equal(passes(c, { ...DEFAULT_FILTERS, volume: 10_000 }, "1h", NOW), true);
  assert.equal(passes(c, { ...DEFAULT_FILTERS, volume: 10_000 }, "5m", NOW), false);
  assert.equal(passes(c, { ...DEFAULT_FILTERS, change: "up" }, "1h", NOW), true);
  assert.equal(passes(c, { ...DEFAULT_FILTERS, change: "up" }, "5m", NOW), false);
  assert.equal(passes(c, { ...DEFAULT_FILTERS, change: "down" }, "6h", NOW), false);
});

test("age: younger than, or older than thirty days", () => {
  assert.equal(passes(coin(), { ...DEFAULT_FILTERS, age: "7d" }, "1h", NOW), true);
  assert.equal(passes(coin(), { ...DEFAULT_FILTERS, age: "1h" }, "1h", NOW), false);
  assert.equal(passes(coin(), { ...DEFAULT_FILTERS, age: "old" }, "1h", NOW), false);
  assert.equal(passes(coin({ bornAt: null }), { ...DEFAULT_FILTERS, age: "7d" }, "1h", NOW), false);
  assert.deepEqual(ageParts(86_400_000 * 400), { n: 13, unit: "mo" });
  assert.deepEqual(ageParts(30 * 60_000), { n: 30, unit: "min" });
});

test("a column sorts, turns round, then gives the list its own order back; unmeasured figures stand last", () => {
  const a = coin({ id: "A1111111111111111111111111111111", symbol: "A", holders: 10 });
  const b = coin({ id: "B1111111111111111111111111111111", symbol: "B", holders: null });
  const c = coin({ id: "C1111111111111111111111111111111", symbol: "C", holders: 99 });
  const desc = nextSort(DEFAULT_SORT, "holders");
  assert.deepEqual(depthRows([a, b, c], view({ sort: desc })).map((x) => x.symbol), ["C", "A", "B"]);
  const asc = nextSort(desc, "holders");
  assert.deepEqual(depthRows([a, b, c], view({ sort: asc })).map((x) => x.symbol), ["A", "C", "B"]);
  assert.deepEqual(nextSort(asc, "holders"), DEFAULT_SORT);
  assert.deepEqual(depthRows([b, a, c], view()).map((x) => x.symbol), ["B", "A", "C"]);
});

test("the day's line runs through the four moves Jupiter measured, oldest first", () => {
  const line = dayLine(coin());
  assert.equal(line.length, 5);
  assert.deepEqual(line[0], { x: 0, price: 1 }); // +100 % over the day: it was 1 a day ago
  assert.deepEqual(line.at(-1), { x: 1, price: 2 });
  assert.equal(line[1].x, 0.75); // six hours ago stands three quarters along the day, by time
  assert.match(timePath(line, 96, 28), /^M\d/);
  assert.equal(dayLine(coin({ stats: { "5m": null, "1h": null, "6h": null, "24h": stats(5) } })), null);
});

test("a count reads short, rounded before its unit", () => {
  assert.equal(countText(999_950, "en"), "1M");
  assert.equal(countText(153_246, "uk"), "153 тис.");
  assert.equal(countText(9_999, "en"), "9999");
  assert.equal(countText(null, "en"), "—");
});

test("buys and sells: the buys' share, or nothing when unmeasured", () => {
  assert.equal(buyShare(stats(1)), 0.75);
  assert.equal(buyShare(stats(1, { buys: null })), null);
  assert.equal(buyShare(stats(1, { buys: 0, sells: 0 })), null);
});

test("a narrow table keeps the lowest ranks, in their own order", () => {
  const cols = [
    { id: "coin", min: 150, rank: 0 },
    { id: "price", min: 90, rank: 1 },
    { id: "day", min: 96, rank: 9 },
    { id: "quick", min: 44, rank: 0.5 },
  ];
  assert.deepEqual(fitColumns(cols, 340).map((c) => c.id), ["coin", "price", "quick"]);
  assert.deepEqual(fitColumns(cols, 2000).map((c) => c.id), ["coin", "price", "day", "quick"]);
});

test("the words stand in both languages with the same keys, short", () => {
  assert.deepEqual(Object.keys(DEPTH.en).sort(), Object.keys(DEPTH.uk).sort());
  for (const lang of ["en", "uk"]) {
    for (const key of ["trending", "fresh", "gainers", "losers", "traded", "stocks", "filters", "verified", "ticket"]) assert.ok(DEPTH[lang][key].length <= 18, `${lang}.${key}`);
    assert.ok(DEPTH[lang].homeTitle1.length + DEPTH[lang].homeTitle2.length <= 48, lang);
  }
  assert.equal(DEPTH.uk.riskM, "М");
  assert.equal(DEPTH.uk.riskF, "З");
});

test("the Market reads its depth from the engine's route, and a coin nobody vetted is never drawn by its own picture", () => {
  const store = readFileSync(new URL("./depth.ts", import.meta.url), "utf8");
  assert.match(store, /\/api\/v1\/market\/depth\?/);
  const screen = readFileSync(new URL("./DepthMarket.tsx", import.meta.url), "utf8");
  assert.ok(!/jup\.ag|datapi/.test(screen), "no provider is read from the browser");
  assert.match(screen, /<Ticket /, "a quick buy goes through the ticket every trade uses");
});

test("one terminal: the Market and the coin keep no «Pro» switch of their own, nor a mark of it on the page", () => {
  for (const file of ["./DepthMarket.tsx", "../coin/CoinScreen.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(!/role="switch"[^>]*aria-label=\{w\.pro\}/.test(source), `${file}: no switch of its own`);
    assert.ok(!/data-pro/.test(source), `${file}: no mark of a second look`);
  }
  const screen = readFileSync(new URL("./DepthMarket.tsx", import.meta.url), "utf8");
  assert.match(screen, /<Split\s/, "the ticket stands in the terminal's split column");
});

test("on a phone the home market's ticket starts folded to the coin's bar, and a picked coin opens it", () => {
  const screen = readFileSync(new URL("./DepthMarket.tsx", import.meta.url), "utf8");
  assert.match(screen, /<Split\s+id="ticket"\s+sheetStart="folded"\s/, "who just came sees the page, not a ticket for a coin they never picked");
  assert.match(screen, /peek=\{<TicketPeek coin=\{coin\} \/>\}/, "the folded bar names the coin and its price");
  assert.match(screen, /setPicked\(target\.id\);\s*if \(narrow\) openSide\('ticket'\);/, "a quick buy on a phone opens the sheet on its coin");
});
