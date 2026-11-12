// Run from repo root: node --test city/lib/apart.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { apart } from "./apart.ts";

// CITY-243: the pass of 10.11 — three «SOL · USDC» on the Piers, three «STAIR-USDC» in «Mine», two «$THUMB» tabs.

test("a name that is its own takes no mark", () => {
  assert.deepEqual(apart([{ name: "SOL · USDC", marks: ["0.04%"] }, { name: "JupSOL · SOL", marks: ["0.01%"] }]), [null, null]);
  assert.deepEqual(apart([]), []);
});

test("namesakes take the first mark that tells every one of them apart", () => {
  const rows = [
    { name: "SOL · USDC", marks: ["0.04%", "45K"] },
    { name: "JupSOL · SOL", marks: ["0.01%", "9K"] },
    { name: "SOL · USDC", marks: ["0.105%", "32K"] },
    { name: "SOL · USDC", marks: ["0.201%", "24K"] },
  ];
  assert.deepEqual(apart(rows), ["0.04%", null, "0.105%", "0.201%"]);
});

test("a mark two namesakes share is passed over for the next one", () => {
  const rows = [
    { name: "$THUMB", marks: ["29 Oct", "29 Oct, 14:05"] },
    { name: "$THUMB", marks: ["29 Oct", "29 Oct, 16:40"] },
    { name: "$WICK", marks: ["28 Oct", "28 Oct, 11:00"] },
  ];
  assert.deepEqual(apart(rows), ["29 Oct, 14:05", "29 Oct, 16:40", null]);
});

test("with no mark that tells them apart, their place among them", () => {
  const rows = [
    { name: "STAIR-USDC", marks: ["0.1 – 0.2", null] },
    { name: "STAIR-USDC", marks: ["0.1 – 0.2", null] },
    { name: "STAIR-USDC", marks: [null] },
  ];
  assert.deepEqual(apart(rows), ["1", "2", "3"]);
});

test("an empty mark is no mark", () => {
  assert.deepEqual(apart([{ name: "A", marks: ["", "x"] }, { name: "A", marks: ["y", "z"] }]), ["x", "z"]);
});
