import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { headPrice } from "./candles.ts";
import { iconAttempt, ICON_RETRY_MS, iconSource, monogram } from "./icon.ts";

// No empty ring and no grey box in the chart window: the coin's logo or its letter; clean dark glass in empty states.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const MINT = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr";

test("the logo comes from the engine's icon route, asked once more after a busy answer, then the letter", () => {
  const tower = { id: MINT, icon: "https://example.com/logo.png" };
  assert.equal(iconSource(tower, 0), `/api/icon/${MINT}`);
  assert.equal(iconAttempt(0), 1, "a failed first try waits");
  assert.equal(iconSource(tower, 1), null, "the letter stands while it waits");
  assert.equal(iconSource(tower, 2), `/api/icon/${MINT}?again=1`, "past the busy minute's cached answer");
  assert.equal(iconAttempt(2), 3);
  assert.equal(iconSource(tower, 3), null, "no third try");
  assert.ok(ICON_RETRY_MS >= 2_000 && ICON_RETRY_MS <= 10_000);
  assert.equal(iconSource({ id: MINT, icon: null }, 0), null, "a coin the engine lists without a logo wears its letter");
  assert.equal(iconSource({ id: MINT, icon: "" }, 0), null);
});

test("a coin's letter is its symbol's first letter or digit", () => {
  assert.equal(monogram("$POPCAT"), "P");
  assert.equal(monogram("jellyjelly"), "J");
  assert.equal(monogram("$WIF"), "W");
  assert.equal(monogram("3NZ9"), "3");
  assert.equal(monogram("$$$"), "$");
  assert.equal(monogram(""), "$");
});

test("the window draws its own icon, never the empty ring of a failed logo", () => {
  const window = read("city/components/chart/ChartWindow.tsx");
  assert.doesNotMatch(window, /TokenIcon/);
  assert.match(window, /<CoinIcon tower=\{tower\} \/>/);
  const icon = read("city/components/chart/CoinIcon.tsx");
  assert.match(icon, /className=\{c\.monogram\}/, "the letter is always under the logo");
});

test("the empty and loading states are clean dark glass: no generated picture of a city anywhere in the window", () => {
  const css = read("city/components/chart/chart.module.css");
  assert.doesNotMatch(css, /url\(/, "no picture in the chart's styles");
  for (const kind of ["loading", "empty"]) {
    for (const width of [800, 1600]) assert.equal(existsSync(join(ROOT, "public/city/art", `chart-${kind}-${width}.webp`)), false);
  }
  // The core's grey loading outline gives way to the glass and its one sweep of light; the states and the pane carry it.
  assert.match(css, /ryntra-chart__cover--loading \.ryntra-chart__ghost\) \{\s*display: none;/);
  assert.match(css, /@keyframes sweep/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  const window = read("city/components/chart/ChartWindow.tsx");
  assert.equal((window.match(/c\.artEmpty/g) ?? []).length, 2, "no chart, and a chart that cannot be read");
  assert.match(window, /c\.artLoading/);
  assert.match(read("city/components/chart/ChartLayer.tsx"), /failed \? c\.artEmpty : c\.artLoading/);
});

test("the head says the chart's price: live when the city is live, else the engine's newest close", () => {
  const bar = (time, close) => ({ time, open: close, high: close, low: close, close });
  const ready = { status: "ready", timeframe: "15m", candles: [bar(1, 0.04), bar(2, 0.0435)], pool: null, observedAt: 0, stale: false };
  const data = { mint: MINT, timeframe: "15m", status: "ready", last: ready, code: null };
  assert.equal(headPrice(0.0431, data, MINT), 0.0431, "the city's live price leads");
  assert.equal(headPrice(null, data, MINT), 0.0435, "a held snapshot gives way to the engine's newest close");
  assert.equal(headPrice(null, { ...data, status: "unavailable", last: { ...ready, stale: true } }, MINT), 0.0435);
  assert.equal(headPrice(null, data, "another"), null, "never another market's bars");
  assert.equal(headPrice(null, { ...data, status: "none", last: null }, MINT), null, "no bars: the tower's own price");
});
