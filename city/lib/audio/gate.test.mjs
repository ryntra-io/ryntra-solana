import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { mayAssemble } from "./gate.ts";

test("the score waits for the first frame and for the person's first gesture (CITY-200)", () => {
  assert.equal(mayAssemble(false, { hasBeenActive: true }), false, "never before the city's first frame");
  assert.equal(mayAssemble(true, { hasBeenActive: false }), false, "an untouched page makes no AudioContext: it would stay suspended and warn per node");
  assert.equal(mayAssemble(true, { hasBeenActive: true }), true);
  assert.equal(mayAssemble(true, undefined), true, "a browser without userActivation assembles as before");
});

test("the city's home asks the gate before it assembles the score", () => {
  const app = readFileSync(new URL("../../components/CityApp.tsx", import.meta.url), "utf8");
  assert.match(app, /mayAssemble\(cityDrawn\(\), \(navigator as Navigator & \{ userActivation\?: Activation \}\)\.userActivation\)/);
});
