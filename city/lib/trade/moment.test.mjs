import { test } from "node:test";
import assert from "node:assert/strict";

import { cropOf, momentFigure, momentSubject, setMomentSubjects, TOWER_FOCUS } from "./moment.ts";

test("the clip counts up to the figure the card wrote, shortening and all", () => {
  // "266K $STAIR" used to become Number("266K") = NaN on the clip.
  assert.deepEqual(momentFigure("266K"), { amount: 266, decimals: 0, suffix: "K" });
  assert.deepEqual(momentFigure("12.4K"), { amount: 12.4, decimals: 1, suffix: "K" });
  assert.deepEqual(momentFigure("1.25M"), { amount: 1.25, decimals: 2, suffix: "M" });
  assert.deepEqual(momentFigure("1,234"), { amount: 1234, decimals: 0, suffix: "" });
  assert.deepEqual(momentFigure("0.000041"), { amount: 0.000041, decimals: 6, suffix: "" });
  assert.deepEqual(momentFigure("276.9"), { amount: 276.9, decimals: 1, suffix: "" });
});

test("a figure that is not a number counts nothing rather than writing NaN", () => {
  for (const got of [null, "", "—", "abc", "1.2.3", "12Q"]) assert.deepEqual(momentFigure(got), { amount: 0, decimals: 0, suffix: "" });
});

test("the crop is 4:5, inside the frame, and centred on the subject as far as the frame allows", () => {
  const W = 1600;
  const H = 900;
  const at = (focus) => cropOf(W, H, 0, focus);
  const mid = at(0.5);
  assert.ok(Math.abs(mid.sw / mid.sh - 1080 / 1350) < 1e-9);
  assert.equal(mid.sh, H);
  assert.ok(Math.abs(mid.sx + mid.sw / 2 - W / 2) < 1e-9);
  // The city's tower sits a little left of centre: the default.
  assert.deepEqual(cropOf(W, H, 0), at(TOWER_FOCUS));
  // A building near the left edge pulls the crop to the edge, never past it.
  assert.equal(at(0.1).sx, 0);
  const right = at(0.98);
  assert.ok(Math.abs(right.sx + right.sw - W) < 1e-9);
  // Off screen or unknown: the crop stays where the camera puts a tower.
  assert.deepEqual(at(Number.NaN), at(TOWER_FOCUS));
  assert.deepEqual(at(-3), at(0));
});

test("the push-in narrows the crop over the clip and a frame with no area gives none", () => {
  const start = cropOf(1600, 900, 0);
  const end = cropOf(1600, 900, 6);
  assert.ok(end.sw < start.sw && end.sh < start.sh);
  assert.equal(cropOf(0, 900, 0), null);
  assert.equal(cropOf(1600, 0, 0), null);
});

test("a moment's subject is asked of the scene that registered it, and of nothing once it leaves", () => {
  assert.equal(momentSubject("mint"), null);
  const subject = { focus: () => 0.3, burst: () => {} };
  setMomentSubjects((mint) => (mint === "mint" ? subject : null));
  assert.equal(momentSubject("mint"), subject);
  assert.equal(momentSubject("other"), null);
  setMomentSubjects(null);
  assert.equal(momentSubject("mint"), null);
});
