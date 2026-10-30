import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { tradeOpen } from "../trade/gates.ts";
import { BOTTOM, defaultBox, isSheet, MAX_H, MIN_W, startBox, TOP } from "./place.ts";

// The window opens where it stays, and the chart's one action is the city's own trade card behind the city's own switch.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), "utf8");

/** Every source file of the chart line: its components and its library. */
function lineFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name)) out.push(path);
    }
  };
  for (const dir of ["city/components/chart", "city/lib/chart"]) walk(join(ROOT, dir));
  return out;
}

test("the window's first frame is its place: the kept one fitted to the screen, or the card's", () => {
  const desk = { w: 1440, h: 860 };
  assert.deepEqual(startBox(desk, null), defaultBox(desk));
  assert.deepEqual(startBox(desk, "{"), defaultBox(desk), "a broken kept place is no place");
  assert.deepEqual(startBox(desk, '{"x":40,"y":90,"w":600,"h":500}'), { x: 40, y: 90, w: 600, h: 500 });
  const far = startBox({ w: 1024, h: 700 }, '{"x":2400,"y":900,"w":1800,"h":1200}');
  assert.ok(far.x + 64 <= 1024 && far.y + 64 <= 700 && far.w <= 1024 - 32, "a place kept on a bigger screen fits this one");
});

test("the pane that stands while the code arrives is inside the window's own frame: no jump between them", () => {
  // Since CITY-65 the city's one window frame places the chart: the frame stands at once, and the pane fills its body
  // until the chart arrives, so the window never moves or resizes when its code comes.
  const css = read("city/components/chart/chart.module.css");
  const pane = css.match(/\n\.pending\s*\{([^}]*)\}/);
  assert.ok(pane, "the pane's rule");
  assert.match(pane[1], /position:\s*absolute;/);
  assert.match(pane[1], /inset:\s*0;/);
  const layer = read("city/components/chart/ChartLayer.tsx");
  assert.match(layer, /useCityWindow\(/, "the chart opens in the city's frame");
  assert.doesNotMatch(layer, /startBox|BOX_KEY/, "no place of its own beside the frame's");
  assert.doesNotMatch(read("city/components/chart/ChartWindow.tsx"), /startBox|BOX_KEY|setPointerCapture/, "the frame moves and stretches the window");
  // The first place of the window before the frame (the card's place) is still counted the same way on every desk.
  // The same rule, counted the way CSS counts it, is the place the window takes on every desk that floats it.
  for (const w of [760, 900, 1024, 1280, 1440, 1920, 2560]) {
    for (const h of [600, 700, 860, 1080, 1440]) {
      const viewport = { w, h };
      if (isSheet(viewport)) continue;
      const cssW = Math.round(Math.min(Math.max(480, w * 0.5), 820));
      const cssH = Math.min(MAX_H, h - TOP - BOTTOM);
      const box = defaultBox(viewport);
      assert.deepEqual([box.w, box.h, box.x, box.y], [cssW, cssH, w - 16 - cssW, h - BOTTOM - cssH], `${w}×${h}`);
      assert.ok(box.w >= MIN_W);
    }
  }
});

test("Buy on the chart opens the city's trade card, behind the switch the tower card's Buy has", () => {
  const window = read("city/components/chart/ChartWindow.tsx");
  // The tower's own window is the trade card since CITY-78: its ticket and the chart's Buy read one switch.
  const action = read("city/components/trade/TradeSheet.tsx");
  // One switch for both Buys: `NEXT_PUBLIC_RYNTRA_CITY_TRADE` through `city/lib/trade/gates.ts`, never a copy.
  const gate = /import \{ (?:SPOT_OPEN, )?TRADE_OPEN \} from '@\/city\/lib\/trade\/gates';/;
  assert.match(window, gate, "the chart reads the trade card's switch");
  assert.match(action, gate, "the tower's window reads the same one");
  assert.doesNotMatch(window, /process\.env/, "no switch of the chart's own");
  // Its default: open unless the deployment says `closed`.
  assert.equal(tradeOpen(undefined), true);
  assert.equal(tradeOpen("closed"), false);
  // Closed: the same quiet «soon» as the tower card; open: the card, on buying, and nothing else.
  assert.match(window, /TRADE_OPEN \? \(/);
  assert.match(window, /\{w\.tradeSoon\}/);
  assert.match(read("city/components/chart/words.ts"), /tradeSoon: 'Trade · soon'/);
  const calls = window.match(/useTrade\.getState\(\)\.\w+\([^)]*\)/g) ?? [];
  assert.deepEqual(calls, ["useTrade.getState().openFor(tower, 'buy')"]);
});

test("the chart line signs, sends and writes nothing: it reads the engine's three reads and the city's own", () => {
  const files = lineFiles();
  assert.ok(files.length >= 10);
  const never = [
    /signTransaction|signAllTransactions|signAndSend|sendTransaction|sendRawTransaction/,
    /@solana\/web3\.js|@solana\/kit|@solana\/spl-token/,
    /\/api\/v1\//,
    /\/api\/solana\//,
    /lib\/(solana|phoenix|pay)\//,
    /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/,
  ];
  const reads = new Set();
  for (const file of files) {
    const name = relative(ROOT, file).replace(/\\/g, "/");
    const text = readFileSync(file, "utf8");
    for (const rule of never) assert.doesNotMatch(text, rule, `${name}: ${rule}`);
    for (const [, path] of text.matchAll(/`(\/api\/[a-z/-]+)\?/g)) reads.add(path);
  }
  assert.deepEqual([...reads].sort(), ["/api/growth/cards", "/api/spot/candles", "/api/spot/token"]);
});

test("the window says what is, not why: the reason for a missing chart waits behind «Details»", () => {
  const window = read("city/components/chart/ChartWindow.tsx");
  const css = read("city/components/chart/chart.module.css");
  assert.match(window, /<span className=\{c\.why\}>\{whyNoChart\(data\.code\)\}<\/span>/);
  assert.match(css, /\.frame:not\(\[data-details\]\) \.why/);
  assert.doesNotMatch(window, /comes back on its own|try again/i);
  assert.doesNotMatch(read("city/components/chart/ChartLayer.tsx"), /Close it and try again/);
});
