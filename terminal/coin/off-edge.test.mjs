import assert from "node:assert/strict";
import { test } from "node:test";

import { acrossLines, countOff } from "./off-edge.ts";

test("lines past the prices on screen are counted at their own edge; lines on screen and the pool's strips are not", () => {
  const rows = [
    { price: 0.2523, off: false },
    { price: 0.2496, off: true },
    { price: 0.2434, off: true },
    { price: 0.31, off: true },
  ];
  assert.deepEqual(countOff(rows, 0.2543), { above: 1, below: 2 });
  assert.deepEqual(countOff(rows, null), { above: 0, below: 0 }, "no price now, no side to say");
  const lines = [
    { id: "r1", price: 0.25, tone: "draft", tag: "$0.25" },
    { id: "d1", price: 0.25, tone: "depth", tag: null, weight: 0.4 },
  ];
  assert.deepEqual(acrossLines(lines).map((line) => line.id), ["r1"]);
});

test("each price is looked for once, as the chart was handed it", async () => {
  const { rowKeys } = await import("./off-edge.ts");
  const lines = [
    { id: "a", price: 0.25234567, tone: "draft", tag: null },
    { id: "b", price: 0.25234567, tone: "resting", tag: null },
    { id: "c", price: 0.24, tone: "draft", tag: null },
  ];
  assert.deepEqual(rowKeys(lines), ["0.252346", "0.24"]);
});
