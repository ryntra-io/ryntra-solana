// Run from repo root: node --test city/lib/lens/cover.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { coveredShare, underWindow } from "./cover.ts";

// CITY-243 (a MINOR of CITY-242): on a 1440 × 900 desk the Lens's strip stood at y 67–115, Spot and Earn opened at y 72
// and covered all of it but a 4 px sliver of violet over their edge. Launch stands under the strip (y 114).
const strip = { x: 480, y: 67, width: 480, height: 48 };

test("Spot or Earn over the strip: covered, the strip steps aside", () => {
  const earn = { x: 214, y: 72, width: 1012, height: 724 };
  const spot = { x: 186, y: 72, width: 1068, height: 724 };
  assert.ok(coveredShare(strip, [earn]) > 0.85);
  assert.equal(underWindow(strip, [earn]), true);
  assert.equal(underWindow(strip, [spot]), true);
});

test("Launch under the strip, or a window beside it: the strip stays", () => {
  const launch = { x: 480, y: 114, width: 480, height: 640 };
  const bay = { x: 1004, y: 72, width: 420, height: 724 };
  assert.equal(underWindow(strip, [launch]), false);
  assert.equal(underWindow(strip, [bay]), false);
  assert.equal(underWindow(strip, []), false);
});

test("the share is the one window's that covers most, never a sum of two", () => {
  const left = { x: 0, y: 0, width: 720, height: 900 };
  const right = { x: 720, y: 0, width: 720, height: 900 };
  assert.equal(coveredShare(strip, [left, right]), 0.5);
  assert.equal(coveredShare({ x: 0, y: 0, width: 0, height: 10 }, [left]), 0);
});
