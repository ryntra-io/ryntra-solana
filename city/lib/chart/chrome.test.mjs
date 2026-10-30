import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { ageText, detailsOf } from "./candles.ts";
import { crosshairChannel, readoutOf, readoutTime } from "./readout.ts";

// Decision 75: the core chart is the engine that draws the candles; everything around them is the city's own.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), "utf8");

function lineFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|css)$/.test(name)) out.push(path);
    }
  };
  for (const dir of ["city/components/chart", "city/lib/chart"]) walk(join(ROOT, dir));
  return out;
}

test("the core chart's toolbar, legend, wordmark and status line are hidden; the city draws its own", () => {
  const css = read("city/components/chart/chart.module.css");
  for (const part of ["bar", "ohlc", "mark", "foot"]) {
    assert.match(css, new RegExp(`\\.chart \\.core :global\\(\\.ryntra-chart__${part}\\)[^{]*\\{[^}]*display: none;|\\.chart \\.core :global\\(\\.ryntra-chart__${part}\\),`), part);
  }
  const window = read("city/components/chart/ChartWindow.tsx");
  assert.match(window, /className=\{c\.frames\} role="radiogroup" aria-label=\{w\.interval\}/, "the city's interval row");
  assert.match(window, /className=\{c\.readout\}/, "the city's readout of the bar under the pointer");
  assert.match(window, /className=\{c\.details\}/, "the city's «Details»");
  assert.match(window, /indicators=\{tools \? undefined : NO_INDICATORS\}/, "the tower's own chart window carries no indicator set");
  // Spot carries our chart whole: its own bar of tools, indicators and drawings.
  assert.match(window, /<ChartBody [^>]*tools \/>/);
  assert.match(css, /\.tooled \.chart \.core :global\(\.ryntra-chart__bar\)/);
  assert.match(window, /crosshair=\{crosshair\}/);
});

test("nothing in the chart line links to the old interface or takes its screens", () => {
  for (const file of lineFiles()) {
    const name = relative(ROOT, file).replace(/\\/g, "/");
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /href=["'{`]*\/app\//, `${name}: a link into /app`);
    assert.doesNotMatch(text, /from ['"](@\/)?components\//, `${name}: an old component`);
    assert.doesNotMatch(text, /from ['"]@ryntra\/core\/(ui|shell|products)['"]/, `${name}: the core's shell`);
    // The one path into app/solana/workspace is the core chart's data feed (the engine, Charts line CH-17), never a screen.
    for (const [, path] of text.matchAll(/from ['"]([^'"]*app\/solana\/workspace\/[^'"]+)['"]/g)) {
      assert.match(path, /\/spot\/core-chart-source\.ts$/, `${name}: ${path}`);
    }
  }
});

test("the crosshair channel tells the window the bar under the pointer, and the readout says it", () => {
  const channel = crosshairChannel();
  const seen = [];
  const stop = channel.subscribe((at) => seen.push(at?.t ?? null));
  channel.set(1_000_000_000_000, "tower");
  channel.set(null, "tower");
  stop();
  channel.set(5, "tower");
  assert.deepEqual(seen, [1_000_000_000_000, null]);
  assert.deepEqual(channel.last(), { t: 5, from: "tower" });

  const bar = (time, open, close) => ({ time, open, high: Math.max(open, close), low: Math.min(open, close), close });
  const candles = [bar(1_000, 1, 1.1), bar(1_900, 1.1, 0.99)];
  assert.deepEqual(readoutOf(candles, 1_000_000, null), { t: 1_000_000, close: 1.1, move: (1.1 / 1 - 1) * 100 });
  const newest = readoutOf(candles, 1_900_000, 1.21);
  assert.equal(newest.close, 1.21, "the newest bar stands at the live price, as the chart draws it");
  assert.equal(readoutOf(candles, 1_900_000, null).close, 0.99);
  assert.equal(readoutOf(candles, 1_234, null), null, "off the bars: nothing");
  assert.equal(readoutOf(candles, null, null), null);
  assert.equal(readoutOf([], 1_000_000, null), null);
  assert.equal(readoutTime(Date.UTC(2026, 9, 28, 17, 30), false, "UTC"), "28 Oct, 17:30");
  assert.equal(readoutTime(Date.UTC(2026, 9, 28), true, "UTC"), "28 Oct 2026");
});

test("«Details» says the source, the pool, the age and a held copy, in the city's short words", () => {
  const ready = { status: "ready", timeframe: "15m", candles: [], pool: "POPCAT / SOL", observedAt: 1_000_000, stale: false, source: "GeckoTerminal" };
  const data = { mint: "m", timeframe: "15m", status: "ready", last: ready, code: null };
  assert.deepEqual(detailsOf(data, 1_008_400), ["GeckoTerminal", "POPCAT / SOL", "8s ago"]);
  assert.deepEqual(detailsOf({ ...data, last: { ...ready, stale: true, source: null, pool: null } }, 1_000_000 + 125_000), ["2m ago", "Delayed"]);
  assert.deepEqual(detailsOf({ ...data, last: null }, 0), []);
  assert.equal(ageText(-5), "0s");
  assert.equal(ageText(7_200_000), "2h");
});

test("a chart that gave up waiting starts again by itself on the bars that came later, on the city's glass", () => {
  const window = read("city/components/chart/ChartWindow.tsx");
  assert.match(window, /key=\{`\$\{tower\.id\}:\$\{heal\}`\}/);
  assert.match(window, /\.ryntra-chart\[data-phase="error"\]/);
  const css = read("city/components/chart/chart.module.css");
  // Any cover of the core's stands on the city's dark glass, never the core's own grey.
  assert.match(css, /\.artEmpty,\s+\.chart \.core :global\(\.ryntra-chart__cover\) \{[^}]*background:/);
});
