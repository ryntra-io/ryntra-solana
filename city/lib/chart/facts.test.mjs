import { test } from "node:test";
import assert from "node:assert/strict";

import { ageOf, count, riskFacts, usd } from "./facts.ts";
import { BOTTOM, BOX_KEY, defaultBox, fitBox, GRAB, isSheet, MAX_H, MIN_H, MIN_W, moved, parseBox, resized, TOP } from "./place.ts";

// Under the chart, the risk facts the engine already gives; around it, the window's place on a desk.

const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms) => new Date(NOW - ms).toISOString();

test("liquidity, holders and age as facts; only the engine's thin pool and a day-old market are marked", () => {
  const facts = riskFacts({ liquidity: 2_400_000, holders: 48_310, launchedAt: at(400 * DAY) }, NOW);
  assert.deepEqual(facts, [
    { key: "liquidity", label: "Liquidity", value: "$2.4M", risk: null },
    { key: "holders", label: "Holders", value: "48.3K", risk: null },
    { key: "age", label: "Age", value: "13mo", risk: null },
  ]);
  const fresh = riskFacts({ liquidity: 8_200, holders: 312, launchedAt: at(5 * HOUR) }, NOW);
  assert.deepEqual(
    fresh.map((f) => [f.value, f.risk]),
    [
      ["$8,200", "Thin"],
      ["312", null],
      ["5h", "New"],
    ],
  );
  // What the read does not say is a dash, never a zero that looks measured.
  const unknown = riskFacts({ liquidity: Number.NaN, holders: 0, launchedAt: null }, NOW);
  assert.deepEqual(unknown.map((f) => [f.value, f.risk]), [["—", null], ["—", null], ["—", null]]);
  // The engine's own line: a pool under $10,000 is not a market.
  assert.equal(riskFacts({ liquidity: 10_000, holders: 1, launchedAt: null }, NOW)[0].risk, null);
  assert.equal(riskFacts({ liquidity: 9_999, holders: 1, launchedAt: null }, NOW)[0].risk, "Thin");
});

test("ages and figures in the city's short words", () => {
  assert.deepEqual(ageOf(at(20 * 60_000), NOW), { ms: 20 * 60_000, text: "<1h" });
  assert.equal(ageOf(at(23 * HOUR), NOW).text, "23h");
  assert.equal(ageOf(at(DAY), NOW).text, "1d");
  assert.equal(ageOf(at(59 * DAY), NOW).text, "59d");
  assert.equal(ageOf(at(90 * DAY), NOW).text, "2mo");
  assert.equal(ageOf(at(3 * 365.25 * DAY), NOW).text, "3y");
  assert.equal(ageOf(null, NOW), null);
  assert.equal(ageOf("not a date", NOW), null);
  assert.equal(ageOf(new Date(NOW + HOUR).toISOString(), NOW), null, "a date in the future is not an age");
  assert.equal(usd(1_240_000_000), "$1.24B");
  assert.equal(usd(840_000), "$840K");
  assert.equal(usd(9_200), "$9,200");
  assert.equal(usd(0), "$0");
  assert.equal(usd(-1), "—");
  assert.equal(count(1_200_000), "1.2M");
  assert.equal(count(9_999), "9,999");
  assert.equal(count(Number.POSITIVE_INFINITY), "—");
});

test("a phone, or a desk too small to float a chart, gets the full sheet", () => {
  assert.equal(isSheet({ w: 390, h: 844 }), true);
  assert.equal(isSheet({ w: 1024, h: 560 }), true);
  assert.equal(isSheet({ w: 1440, h: 860 }), false);
  assert.equal(isSheet({ w: 1280, h: 600 }), false);
  assert.equal(isSheet({ w: 768, h: 1024 }), false);
});

test("the window opens in the tower card's place, grown up towards the top bar, and always stays reachable", () => {
  const desk = { w: 1440, h: 860 };
  const box = defaultBox(desk);
  assert.equal(box.x + box.w, desk.w - 16, "on the right, at the gutter");
  assert.equal(box.y + box.h, desk.h - BOTTOM, "standing where the card stood");
  assert.equal(box.h, MAX_H);
  assert.ok(box.y >= TOP, "under the top bar");
  assert.equal(box.w, 720);
  // A shorter desk: the window fills the column between the top bar and the bottom margin.
  const short = defaultBox({ w: 1280, h: 620 });
  assert.deepEqual([short.y, short.h], [TOP, 620 - TOP - BOTTOM]);
  assert.ok(short.h >= MIN_H);
  // Dragged far away, the head stays on screen to grab it back.
  const away = moved(box, 5_000, 5_000, desk);
  assert.equal(away.x, desk.w - GRAB);
  assert.equal(away.y, desk.h - GRAB);
  const up = moved(box, -5_000, -5_000, desk);
  assert.equal(up.x, GRAB - box.w);
  assert.equal(up.y, 12);
  // Stretched: never under the minimum, never over the screen; the top left stays.
  const small = resized(box, -5_000, -5_000, desk);
  assert.deepEqual([small.x, small.y, small.w, small.h], [box.x, box.y, MIN_W, MIN_H]);
  const big = resized(box, 5_000, 5_000, desk);
  assert.equal(big.w, desk.w - 32);
  assert.equal(big.h, desk.h - BOTTOM - 12);
  // A window kept from a bigger screen fits the one it opens on.
  const kept = fitBox({ x: 2_400, y: 900, w: 1_800, h: 1_200 }, desk);
  assert.ok(kept.w <= desk.w - 32 && kept.h <= desk.h - BOTTOM - 12 && kept.x <= desk.w - GRAB && kept.y <= desk.h - GRAB);
});

test("a kept place is read only when it is one", () => {
  assert.equal(BOX_KEY, "ryntra.city.chart.box.v1");
  assert.deepEqual(parseBox('{"x":10,"y":72,"w":600,"h":420}'), { x: 10, y: 72, w: 600, h: 420 });
  assert.equal(parseBox(null), null);
  assert.equal(parseBox("{"), null);
  assert.equal(parseBox('{"x":10,"y":72,"w":"600","h":420}'), null);
  assert.equal(parseBox("null"), null);
});
