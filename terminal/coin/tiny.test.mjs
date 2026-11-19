import assert from "node:assert/strict";
import test from "node:test";

import { zerosText } from "./tiny.ts";

/* A tiny price in the ticket as the chart writes it — «0.0₇32001», not «0.0000000320008». */

const plain = (value) => String(value);

test("four zeros or more after the point are counted under the line, as the chart's scale writes them", () => {
  assert.equal(zerosText(0.0000000320008, plain), "0.0₇32001");
  assert.equal(zerosText(0.000002344, plain), "0.0₅2344");
  assert.equal(zerosText(0.0000099999999, plain), "0.0₄1");
});

test("a price with fewer zeros, and anything that is no price, stays as typed", () => {
  assert.equal(zerosText(0.003466, plain), "0.003466");
  assert.equal(zerosText(73.39, plain), "73.39");
  assert.equal(zerosText(0, plain), "0");
});
