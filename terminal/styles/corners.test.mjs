import assert from "node:assert/strict";
import test from "node:test";

import { addTally, corners } from "./corners.mjs";

/* The line of the form's shots report: the corners a screen shows, in the order of the form — 0, 4, a circle — the cut
   beside them with its count, and any other corner in px, named as wrong. */

test("a screen in the form says 0, 4 and a circle, and how many boxes carry the cut", () => {
  assert.deepEqual(corners({ square: 41, r4: 12, pill: 6, cut: 1 }), { line: "кути на екрані: 0, 4, коло · зрізів: 1", wrong: [] });
  assert.deepEqual(corners({ pill: 2, square: 9 }), { line: "кути на екрані: 0, коло", wrong: [] });
  assert.equal(corners({}).line, "кути на екрані: —");
});

test("any other corner is said in px, smallest first, and named as wrong", () => {
  assert.deepEqual(corners({ square: 3, r12: 1, r4: 2, r8: 4, pill: 1 }), { line: "кути на екрані: 0, 4, коло, 8 px, 12 px", wrong: ["8 px", "12 px"] });
});

test("the corners of every screen at once", () => {
  const all = [{ square: 2, r4: 1 }, { square: 1, pill: 3, cut: 1 }, { r4: 2, cut: 1 }].reduce(addTally, {});
  assert.deepEqual(all, { square: 3, r4: 3, pill: 3, cut: 2 });
  assert.equal(corners(all, "на всіх екранах").line, "кути на всіх екранах: 0, 4, коло · зрізів: 2");
});
