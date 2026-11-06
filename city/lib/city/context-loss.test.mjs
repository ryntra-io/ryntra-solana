import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { watchContext } from "./context-loss.ts";

/* CITY-200: on ryntra.io a lost WebGL context left the city white, the dock gone, with no way back but a reload. */

function fakeTimers() {
  const due = [];
  return { due, set: (fn, ms) => (due.push({ fn, ms }), due.length), clear: (h) => (due[h - 1].fn = null), run: () => due.forEach((d) => d.fn?.()) };
}
const lostEvent = () => {
  const e = new Event("webglcontextlost", { cancelable: true });
  return e;
};

test("a lost context is claimed and the canvas comes back once the browser restores it", () => {
  const canvas = new EventTarget();
  const t = fakeTimers();
  const log = [];
  watchContext(canvas, () => log.push("lost"), () => log.push("back"), 2500, t);
  const e = lostEvent();
  canvas.dispatchEvent(e);
  assert.equal(e.defaultPrevented, true, "without preventDefault the browser never gives the context back");
  canvas.dispatchEvent(lostEvent());
  assert.deepEqual(log, ["lost"], "one loss, one wait");
  canvas.dispatchEvent(new Event("webglcontextrestored"));
  assert.deepEqual(log, ["lost", "back"]);
  t.run();
  assert.deepEqual(log, ["lost", "back"], "the timer was cleared: no second canvas");
});

test("a context never restored still gets a fresh canvas after the wait; cleanup removes the watch", () => {
  const canvas = new EventTarget();
  const t = fakeTimers();
  const log = [];
  const stop = watchContext(canvas, () => log.push("lost"), () => log.push("back"), 2500, t);
  canvas.dispatchEvent(lostEvent());
  assert.equal(t.due[0].ms, 2500);
  t.run();
  assert.deepEqual(log, ["lost", "back"]);
  stop();
  canvas.dispatchEvent(lostEvent());
  assert.deepEqual(log, ["lost", "back"]);
});

test("the city's canvas holds the night colour and remounts on a lost context", () => {
  const src = readFileSync(new URL("../../components/city/CityCanvas.tsx", import.meta.url), "utf8");
  assert.match(src, /key=\{generation\}/);
  assert.match(src, /watchContext\(gl\.domElement, \(\) => setWarm\(false\), \(\) => setGeneration\(\(g\) => g \+ 1\)\)/);
  assert.match(src, /background: '#06050C'/);
});
