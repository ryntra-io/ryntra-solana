import { test } from "node:test";
import assert from "node:assert/strict";

import { defaultFrame, EDGE, fitFrame, moveFrame, parseFrame, resizeFrame, windowed } from "./frame.ts";

const desk = { width: 1440, height: 860 };

test("a computer gets a window; a phone gets the bottom sheet", () => {
  assert.equal(windowed(desk), true);
  assert.equal(windowed({ width: 390, height: 844 }), false);
  assert.equal(windowed({ width: 899, height: 700 }), false);
});

test("the window opens on the left under the top bar, whole on the screen", () => {
  const frame = defaultFrame(desk);
  assert.equal(frame.x, 16);
  assert.ok(frame.y >= 76);
  assert.ok(frame.y + frame.height <= desk.height - EDGE);
  const small = defaultFrame({ width: 960, height: 560 });
  assert.ok(small.y + small.height <= 560 - EDGE && small.y >= EDGE);
});

test("dragged or stretched, the window never leaves the screen", () => {
  const start = defaultFrame(desk);
  const far = moveFrame(start, 5000, 5000, desk);
  assert.equal(far.x + far.width, desk.width - EDGE);
  assert.equal(far.y + far.height, desk.height - EDGE);
  const wide = resizeFrame(start, "se", 2000, 0, desk);
  assert.equal(wide.width, 680);
  const narrow = resizeFrame(start, "nw", 1000, 1000, desk);
  assert.deepEqual([narrow.width, narrow.height], [400, 460]);
  assert.deepEqual(fitFrame({ x: -50, y: -50, width: 500, height: 500 }, desk), { x: EDGE, y: EDGE, width: 500, height: 500 });
});

test("a remembered window is read only when it is one", () => {
  assert.deepEqual(parseFrame('{"x":1,"y":2,"width":500,"height":600}'), { x: 1, y: 2, width: 500, height: 600 });
  for (const raw of [null, "", "{", '{"x":1}', '{"x":1,"y":2,"width":0,"height":5}', '{"x":"1","y":2,"width":5,"height":5}']) assert.equal(parseFrame(raw), null, String(raw));
});
