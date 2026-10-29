import { test } from "node:test";
import assert from "node:assert/strict";

import { defaultFrame, EDGE, FRAME_KEY, FRAME_MAX, FRAME_MIN, fitFrame, moveFrame, parseFrame, readFrame, resizeFrame, standingOf, TOP_ROOM, windowed, writeFrame } from "./frame.ts";

const DESK = { width: 1440, height: 860 };
const inside = (frame, view) =>
  frame.x >= EDGE && frame.y >= EDGE && frame.x + frame.width <= view.width - EDGE && frame.y + frame.height <= view.height - EDGE;

test("a window from 900 px of width; below it, the phone's bottom sheet", () => {
  assert.equal(windowed({ width: 899, height: 800 }), false);
  assert.equal(windowed({ width: 900, height: 800 }), true);
  assert.equal(windowed({ width: 390, height: 844 }), false);
});

test("the window first opens on the right, whole on the screen", () => {
  const frame = defaultFrame(DESK);
  assert.deepEqual(frame, { x: 1440 - 16 - 520, y: 860 - 24 - 560, width: 520, height: 560 });
  assert.ok(inside(frame, DESK));
  const short = defaultFrame({ width: 1000, height: 500 });
  assert.ok(inside(short, { width: 1000, height: 500 }));
});

test("dragged past any edge, the window stops at it", () => {
  const start = defaultFrame(DESK);
  assert.deepEqual(moveFrame(start, -5000, -5000, DESK), { ...start, x: EDGE, y: EDGE });
  const far = moveFrame(start, 5000, 5000, DESK);
  assert.equal(far.x + far.width, DESK.width - EDGE);
  assert.equal(far.y + far.height, DESK.height - EDGE);
  assert.deepEqual(moveFrame(start, -100, -40, DESK), { ...start, x: start.x - 100, y: start.y - 40 });
});

test("stretched by a corner: within the least and the most, never off the screen", () => {
  const start = { x: 400, y: 100, width: 520, height: 600 };
  // The bottom-right corner grows to the right and down; the top-left stays.
  assert.deepEqual(resizeFrame(start, "se", 60, 40, DESK), { x: 400, y: 100, width: 580, height: 640 });
  // The bottom-left corner grows to the left; the right edge stays.
  const left = resizeFrame(start, "sw", -100, 0, DESK);
  assert.equal(left.x + left.width, start.x + start.width);
  assert.equal(left.width, 620);
  // Never smaller than the least, never larger than the most.
  assert.deepEqual(resizeFrame(start, "se", -1000, -1000, DESK), { x: 400, y: 100, width: FRAME_MIN.width, height: FRAME_MIN.height });
  const big = resizeFrame(start, "sw", -2000, 2000, DESK);
  assert.equal(big.width, FRAME_MAX.width);
  assert.equal(big.y + big.height, DESK.height - EDGE);
  assert.ok(inside(big, DESK));
  // A corner pulled past the screen's edge stops at it.
  const edge = resizeFrame({ x: 800, y: 100, width: 520, height: 600 }, "se", 400, 0, DESK);
  assert.equal(edge.x + edge.width, DESK.width - EDGE);
});

test("the top-left corner grows the window up and to the left; the bottom-right edges stay", () => {
  const start = { x: 900, y: 280, width: 520, height: 560 };
  const grown = resizeFrame(start, "nw", -120, -100, DESK);
  assert.deepEqual(grown, { x: 780, y: 180, width: 640, height: 660 });
  assert.equal(grown.x + grown.width, start.x + start.width);
  assert.equal(grown.y + grown.height, start.y + start.height);
  // Pulled past the top of the screen, it stops at the edge.
  const tall = resizeFrame(start, "nw", 0, -5000, DESK);
  assert.ok(tall.y >= EDGE && inside(tall, DESK));
  // The top-right corner grows up and to the right; the left and bottom edges stay.
  const right = resizeFrame({ x: 400, y: 280, width: 520, height: 560 }, "ne", 80, -60, DESK);
  assert.deepEqual(right, { x: 400, y: 220, width: 600, height: 620 });
});

test("a smaller screen brings a remembered window back onto it", () => {
  const remembered = { x: 1800, y: 900, width: 700, height: 900 };
  const view = { width: 1024, height: 700 };
  const fitted = fitFrame(remembered, view);
  assert.ok(inside(fitted, view));
  assert.equal(fitted.height, view.height - 2 * EDGE);
});

test("the place and size are remembered; broken or missing storage is the first place again", () => {
  const map = new Map();
  const storage = () => ({ getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) });
  writeFrame(storage, { x: 10, y: 20, width: 500, height: 600 });
  assert.deepEqual(readFrame(storage), { x: 10, y: 20, width: 500, height: 600 });
  assert.ok(map.has(FRAME_KEY));
  map.set(FRAME_KEY, "{not json");
  assert.equal(readFrame(storage), null);
  map.set(FRAME_KEY, JSON.stringify({ x: 1, y: 2, width: "wide", height: 3 }));
  assert.equal(readFrame(storage), null);
  assert.equal(parseFrame(JSON.stringify({ x: 1, y: 2, width: -5, height: 3 })), null);
  const refusing = () => ({
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  });
  assert.equal(readFrame(refusing), null);
  assert.doesNotThrow(() => writeFrame(refusing, { x: 1, y: 1, width: 500, height: 500 }));
  assert.doesNotThrow(() =>
    writeFrame(() => {
      throw new Error("no storage at all");
    }, { x: 1, y: 1, width: 500, height: 500 }),
  );
  assert.equal(readFrame(() => null), null);
});

test("the window stands on its bottom edge and grows upward into the free room, never under the top bar", () => {
  for (const view of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    const frame = defaultFrame(view);
    const stand = standingOf(frame, view);
    // The bottom edge is the frame's: 24 px over the screen's bottom, whatever the card holds.
    assert.equal(stand.bottom, 24);
    assert.equal(stand.minHeight, frame.height);
    // The tallest it may grow reaches the top bar's room and no further.
    assert.equal(view.height - stand.bottom - stand.maxHeight, TOP_ROOM);
    assert.ok(stand.maxHeight >= stand.minHeight);
  }
  // A window dragged up under the bar keeps at least its own height and never leaves the screen.
  const high = fitFrame({ x: 100, y: 8, width: 520, height: 500 }, { width: 1440, height: 900 });
  const stand = standingOf(high, { width: 1440, height: 900 });
  assert.equal(stand.maxHeight, 500);
  assert.equal(900 - stand.bottom - stand.maxHeight, 8);
});
