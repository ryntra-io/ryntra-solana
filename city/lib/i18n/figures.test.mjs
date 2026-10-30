import assert from "node:assert/strict";
import test from "node:test";

import { fieldText, fieldValue, plainFigure, shortFigures } from "./figures.ts";

// CITY-150: the operator's pass on the Seeker — «1,2e-7 BTC» in the Exchange's history, «0,099796891 SOL» in Money's.

test("a figure is never written with an exponent", () => {
  assert.equal(plainFigure(1.2e-7), "0.00000012");
  assert.equal(plainFigure(1.23456e-9, { significant: 2 }), "0.0000000012");
  assert.equal(plainFigure(-2.5e-6), "-0.0000025");
  assert.equal(plainFigure(0), "0");
});

test("no more places than the figure needs", () => {
  assert.equal(plainFigure(0.099796891), "0.0998");
  assert.equal(plainFigure(3.873000), "3.873");
  assert.equal(plainFigure(12.3456789), "12.3457");
  assert.equal(plainFigure(97.35, { places: 2 }), "97.35");
  assert.equal(plainFigure(0.1138), "0.1138");
});

test("a line of words keeps its words and shortens only its long figures", () => {
  assert.equal(shortFigures("Swapped 0.099796891 SOL → 3.873 JUP"), "Swapped 0.0998 SOL → 3.873 JUP");
  assert.equal(shortFigures("Sent 1.2e-7 BTC"), "Sent 0.00000012 BTC");
  assert.equal(shortFigures("$1,240.50 · 10:26 · 12 Oct"), "$1,240.50 · 10:26 · 12 Oct");
  assert.equal(shortFigures("Bought 1234.123456 BONK"), "Bought 1234.1235 BONK");
});

test("a number field shows a comma in Ukrainian and gives back a point", () => {
  assert.equal(fieldText("0.1", "uk"), "0,1");
  assert.equal(fieldText("0.1", "en"), "0.1");
  assert.equal(fieldValue("0,25", "uk"), "0.25");
  assert.equal(fieldValue("1,000", "en"), "1,000", "an English comma stays a thousands mark");
  assert.equal(fieldValue(fieldText("12.5", "uk"), "uk"), "12.5");
});
