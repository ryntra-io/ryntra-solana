import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { chartOwns, GESTURE_SLOP_PX, HOLD_MS, wayOf } from "./gesture.ts";

// CITY-215: on a phone the chart took every drag, and the window under it never scrolled to the amount and
// Market · Limit · Stop. Up or down over the candles is now the window's; across, a pinch and a held finger stay the
// chart's. The browser pass with real touches is `phone-shots.mjs`.

const at = (x, y, t = 0) => ({ x, y, t });

test("up or down is the window's, across is the chart's", () => {
  assert.equal(wayOf(at(100, 300), at(101, 290, 40), 1), "scroll");
  assert.equal(wayOf(at(100, 300), at(98, 330, 40), 1), "scroll", "down scrolls as well as up");
  assert.equal(wayOf(at(100, 300), at(130, 302, 40), 1), "chart");
  assert.equal(wayOf(at(100, 300), at(70, 296, 40), 1), "chart");
  // Exactly diagonal goes to the candles under the finger.
  assert.equal(wayOf(at(100, 300), at(106, 306, 40), 1), "chart");
  // Steep but not straight is still up.
  assert.equal(wayOf(at(100, 300), at(104, 291, 40), 1), "scroll");
});

test("a finger that has not travelled yet is undecided, and the decision comes no later than the chart's own", () => {
  assert.equal(wayOf(at(100, 300), at(101, 302, 30), 1), "undecided");
  assert.equal(wayOf(at(100, 300), at(100, 300 - GESTURE_SLOP_PX, 30), 1), "scroll");
  // The core chart claims a drag at 5 px (klinecharts' tap distance): the window must decide on or before it.
  assert.ok(GESTURE_SLOP_PX <= 5);
});

test("two fingers pinch the chart; a finger held first is the crosshair's", () => {
  assert.equal(wayOf(at(100, 300), at(100, 260, 40), 2), "chart");
  assert.equal(wayOf(at(100, 300), at(100, 300, HOLD_MS), 1), "chart", "held still: the crosshair is coming");
  assert.equal(wayOf(at(100, 300), at(100, 260, HOLD_MS + 50), 1), "chart", "held, then moved: the crosshair follows");
  assert.equal(wayOf(at(100, 300), at(100, 260, HOLD_MS - 50), 1), "scroll");
  // Before the core's own long tap (500 ms), so the window never scrolls under a crosshair.
  assert.ok(HOLD_MS < 500);
});

test("a handle that drags on its own, or the drawing tools open, keep the whole gesture to the chart", () => {
  assert.equal(chartOwns({ handle: false, drawing: false }), false);
  assert.equal(chartOwns({ handle: true, drawing: false }), true);
  assert.equal(chartOwns({ handle: false, drawing: true }), true);
});

test("the chart's pane listens before the engine, never cancels the browser's scroll, and the canvas may pan up and down", () => {
  const hook = readFileSync(new URL("./use-gesture.ts", import.meta.url), "utf8");
  assert.match(hook, /capture: true, passive: true/);
  assert.doesNotMatch(hook, /\.preventDefault\(/);
  assert.match(hook, /new TouchEvent\('touchcancel'/);
  const css = readFileSync(new URL("../../components/chart/chart.module.css", import.meta.url), "utf8");
  assert.match(css, /\.chart:not\(:has\(:global\(\.ryntra-draw\[data-open\]\)\)\) \.core :global\(\.ryntra-chart__canvas\) > div \{\n  touch-action: pan-y !important;/);
  const window = readFileSync(new URL("../../components/chart/ChartWindow.tsx", import.meta.url), "utf8");
  assert.equal(window.match(/useScrollThrough\(pane\)/g)?.length, 2, "the chart's window and the chart in the spot window both");
  assert.match(window, /if \(saysUnavailable\(data\)\)/);
});
