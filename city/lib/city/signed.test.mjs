import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { signedMove } from "./signed.ts";

/* CITY-200: SOL's hover card on ryntra.io read «−0.0% 1H», in red. */
test("a move that rounds to nothing is «0.0%», neither red nor signed", () => {
  assert.deepEqual(signedMove(-0.04), { text: "0.0%", flat: true, up: true });
  assert.deepEqual(signedMove(0.04), { text: "0.0%", flat: true, up: true });
  assert.deepEqual(signedMove(4.21), { text: "+4.2%", flat: false, up: true });
  assert.deepEqual(signedMove(-3.06), { text: "−3.1%", flat: false, up: false });
  assert.equal(signedMove(-0.06).text, "−0.1%");
});

test("the HUD writes every move through it", () => {
  const bits = readFileSync(new URL("../../components/hud/bits.tsx", import.meta.url), "utf8");
  const hover = readFileSync(new URL("../../components/hud/HoverLabel.tsx", import.meta.url), "utf8");
  assert.match(bits, /return digits\(signedMove\(v\)\.text\);/);
  assert.match(hover, /up: signedMove\(tower\.change1h\)\.up/);
});
