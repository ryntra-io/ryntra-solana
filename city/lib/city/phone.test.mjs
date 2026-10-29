import assert from "node:assert/strict";
import test from "node:test";

import { isRyntraApp, quietInstall } from "../app-mode.ts";
import { Press, TAP, twist } from "./gesture.ts";
import { BUDGET, dprAt, LADDER, meanFps, move, rangeFor, ROCKING_TURNS, startMoves, stepDown, stepUp } from "./quality.ts";

/* CITY-6a: the city on a phone — the quality ladder, the touch gestures and the app's mark. */

const at = (rung) => LADDER[rung];

test("a desk starts at the top; a phone starts at mid × 1.25 and may climb to high × 1.5", () => {
  const desk = rangeFor({ coarse: false, cores: 12, memory: 16, dpr: 2 });
  assert.deepEqual(at(desk.start), { quality: "high", dpr: 1.75 });
  assert.equal(desk.top, 0);
  const phone = rangeFor({ coarse: true, cores: 8, memory: 8, dpr: 2.625 });
  assert.deepEqual(at(phone.start), { quality: "mid", dpr: 1.25 });
  assert.deepEqual(at(phone.top), { quality: "high", dpr: 1.5 });
});

test("a weak phone, or one saving data, starts on low × 1; a weak desk on mid", () => {
  assert.deepEqual(at(rangeFor({ coarse: true, cores: 4, dpr: 3 }).start), { quality: "low", dpr: 1 });
  assert.deepEqual(at(rangeFor({ coarse: true, memory: 2, dpr: 2 }).start), { quality: "low", dpr: 1 });
  assert.deepEqual(at(rangeFor({ coarse: true, cores: 8, saveData: true, dpr: 2 }).start), { quality: "low", dpr: 1 });
  assert.equal(at(rangeFor({ coarse: false, cores: 2, dpr: 1 }).start).quality, "mid");
});

test("?quality= pins the start, never above the device's top", () => {
  assert.equal(at(rangeFor({ coarse: true, cores: 8, dpr: 3 }, "low").start).quality, "low");
  assert.deepEqual(at(rangeFor({ coarse: true, cores: 8, dpr: 3 }, "high").start), { quality: "high", dpr: 1.5 });
  assert.equal(rangeFor({ coarse: false, dpr: 1 }, "nonsense").start, 0);
});

test("the canvas never renders above the screen's own pixel ratio", () => {
  assert.equal(dprAt(0, 3), 1.75);
  assert.equal(dprAt(0, 1), 1);
  assert.equal(dprAt(LADDER.length - 1, 3), 0.75);
  assert.equal(dprAt(99, 2), 0.75);
});

test("the frame rate steps one rung down, two when it collapses, and never past the bottom", () => {
  const phone = rangeFor({ coarse: true, cores: 8, dpr: 3 });
  assert.deepEqual(at(stepDown(phone.start, 3, 30)), { quality: "mid", dpr: 1 });
  assert.deepEqual(at(stepDown(phone.start, 3, 12)), { quality: "low", dpr: 1 });
  assert.equal(stepDown(LADDER.length - 1, 3, 5), LADDER.length - 1);
});

test("a rung that looks the same on this screen is passed over, up and down", () => {
  // A desk at pixel ratio 1: high × 1.75 and high × 1.5 both draw high × 1.
  assert.deepEqual(at(stepDown(0, 1, 40)), { quality: "mid", dpr: 1.25 });
  const mid1 = LADDER.findIndex((r) => r.quality === "mid" && r.dpr === 1);
  assert.equal(at(stepUp(mid1, 0, 1)).quality, "high");
  assert.equal(stepUp(1, 0, 1), 1, "already the best this screen can show");
});

test("a step up stops at the device's top", () => {
  const phone = rangeFor({ coarse: true, cores: 8, dpr: 3 });
  const up = stepUp(phone.start, phone.top, 3);
  assert.deepEqual(at(up), { quality: "high", dpr: 1.5 });
  assert.equal(stepUp(up, phone.top, 3), up);
});

test("a device that keeps up at its top stays there: a climb that changes nothing is no move", () => {
  // A smooth desk at the top hears «incline» every few seconds for the whole visit; it must never be pushed down.
  let m = startMoves(0);
  for (let i = 0; i < 20; i++) m = move(m, stepUp(m.rung, 0, 1));
  assert.equal(m.rung, 0);
  assert.equal(m.turns, 0);
  // A steady decline is no rocking either: each step is taken, and no extra one.
  m = startMoves(0);
  for (let i = 0; i < 3; i++) m = move(m, stepDown(m.rung, 3, 40));
  assert.equal(m.rung, 3);
  assert.equal(m.settled, false);
});

test("rocking between two rungs settles on the cheaper one, which then only steps down", () => {
  let m = startMoves(2);
  for (let i = 0; i < ROCKING_TURNS + 1; i++) m = move(m, i % 2 === 0 ? 3 : 2);
  assert.equal(m.settled, true);
  assert.equal(m.rung, 3);
  assert.equal(move(m, 2).rung, 3, "no climb once settled");
  assert.equal(move(m, 4).rung, 4, "a heavier scene still steps down");
});

test("a collapse is read from the verdict's mean, not one slow sample", () => {
  assert.equal(meanFps([]), undefined);
  const samples = [36, 35, 37, 36, 2, 36, 35, 36, 37, 36];
  assert.ok(meanFps(samples) > 20);
  assert.deepEqual(at(stepDown(2, 3, meanFps(samples))), { quality: "mid", dpr: 1 });
});

test("each lower tier spends less on every line of the budget", () => {
  for (const [rich, poor] of [["high", "mid"], ["mid", "low"]]) {
    for (const key of ["bloomLevels", "bloomScale", "embers", "drones", "walkers"]) assert.ok(BUDGET[poor][key] < BUDGET[rich][key], `${key}: ${poor} < ${rich}`);
  }
  assert.equal(BUDGET.low.touches, false);
  assert.equal(BUDGET.high.touches, true);
});

test("a tap is one still, quick finger; anything with two fingers is a gesture", () => {
  const p = new Press();
  p.down(1, { x: 100, y: 100 }, 0);
  assert.equal(p.up(1, { x: 104, y: 103 }, 120), true);

  p.down(1, { x: 100, y: 100 }, 0);
  assert.equal(p.up(1, { x: 100 + TAP.px + 4, y: 100 }, 100), false, "a drag");

  p.down(1, { x: 100, y: 100 }, 0);
  assert.equal(p.up(1, { x: 100, y: 100 }, TAP.ms + 10), false, "a hold");

  // A pinch whose fingers lift one by one, the last without moving: still no tap.
  p.down(1, { x: 100, y: 100 }, 0);
  p.down(2, { x: 200, y: 200 }, 20);
  assert.equal(p.up(2, { x: 200, y: 200 }, 80), false);
  assert.equal(p.up(1, { x: 100, y: 100 }, 120), false);

  // The next press starts clean.
  p.down(3, { x: 50, y: 50 }, 1000);
  assert.equal(p.up(3, { x: 50, y: 50 }, 1100), true);

  // A finger the browser took away is no tap; a lift of a finger never seen is ignored.
  p.down(4, { x: 50, y: 50 }, 2000);
  p.cancel(4);
  assert.equal(p.up(4, { x: 50, y: 50 }, 2050), false);
  assert.equal(p.up(9, { x: 0, y: 0 }, 0), false);

  // A finger lifted off the canvas is never seen; the next first finger resets the press.
  p.down(5, { x: 10, y: 10 }, 3000);
  p.reset();
  p.down(6, { x: 10, y: 10 }, 4000);
  assert.equal(p.up(6, { x: 10, y: 10 }, 4100), true);
});

test("the twist of two fingers is the turn of the line between them, clockwise positive", () => {
  const quarter = twist({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 100 });
  assert.ok(Math.abs(quarter - Math.PI / 2) < 1e-9);
  const back = twist({ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 0 }, { x: 100, y: 0 });
  assert.ok(Math.abs(back + Math.PI / 2) < 1e-9);
  // Across the ±π seam the turn stays small.
  const seam = twist({ x: 0, y: 0 }, { x: -100, y: 1 }, { x: 0, y: 0 }, { x: -100, y: -1 });
  assert.ok(Math.abs(seam) < 0.05);
  // Both fingers sliding together (a drag, a pinch) do not turn.
  assert.equal(twist({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 30, y: 40 }, { x: 130, y: 40 }), 0);
  assert.equal(twist({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: -50, y: 0 }, { x: 150, y: 0 }), 0);
});

test("the app is known by its mark in the user agent, and nothing else", () => {
  assert.equal(isRyntraApp("Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36 RyntraApp/1.4.0"), true);
  assert.equal(isRyntraApp("RyntraApp/0.1"), true);
  assert.equal(isRyntraApp("Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile Safari/537.36"), false);
  assert.equal(isRyntraApp("Mozilla/5.0 NotRyntraApp/1.0"), false);
  assert.equal(isRyntraApp("Mozilla/5.0 RyntraApp/"), false);
  assert.equal(isRyntraApp(undefined), false);
});

test("in the app the install prompt is swallowed; a browser keeps it", () => {
  const fake = (ua) => {
    const listeners = new Map();
    return {
      navigator: { userAgent: ua },
      addEventListener: (type, fn) => listeners.set(type, fn),
      removeEventListener: (type) => listeners.delete(type),
      listeners,
    };
  };
  const app = fake("Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile Safari/537.36 RyntraApp/1.0.0");
  const undo = quietInstall(app);
  let prevented = false;
  app.listeners.get("beforeinstallprompt")({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, true);
  undo();
  assert.equal(app.listeners.size, 0);
  const browser = fake("Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile Safari/537.36");
  quietInstall(browser);
  assert.equal(browser.listeners.size, 0);
});
