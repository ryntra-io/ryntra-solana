import { test } from "node:test";
import assert from "node:assert/strict";

import { dividendLine, dividendUnits, mergeSteps, readAction, readStep, stepFromConfig } from "./corporate.ts";

const MINT = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const OTHER = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const step = (from, to, at = "2026-06-10T00:00:00.000Z", mint = MINT) => ({ mint, at, from, to });

test("a small rise that is no clean ratio is a reinvested dividend", () => {
  for (const [from, to] of [[1, 1.0031], [1.0124, 1.0157], [1.2, 1.2096]]) {
    assert.equal(readAction(step(from, to)).kind, "dividend", `${from}→${to}`);
  }
});

test("a clean ratio is a split or a reverse split, never a dividend", () => {
  assert.deepEqual(readAction(step(1, 2)).parts, [2, 1]);
  assert.equal(readAction(step(1, 2)).kind, "split");
  assert.equal(readAction(step(1.0031, 3.0093)).kind, "split", "3-for-1 on a multiplier that already carried dividends");
  assert.deepEqual(readAction(step(1, 1.5)).parts, [3, 2]);
  assert.equal(readAction(step(1, 1.5)).kind, "split");
  assert.equal(readAction(step(1, 1.2)).kind, "split", "6-for-5 is the smallest split anyone announces");
  assert.equal(readAction(step(5, 1)).kind, "reverse-split");
  assert.deepEqual(readAction(step(10, 1)).parts, [1, 10]);
  assert.equal(readAction(step(1, 5)).kind, "split", "SpaceX's 5-for-1 adjustment");
});

test("anything else is unknown and earns nothing", () => {
  assert.equal(readAction(step(1, 0.97)).kind, "unknown", "a fall that is no reverse split");
  assert.equal(readAction(step(1, 1.37)).kind, "unknown", "a jump too big for a payout and no clean ratio");
  assert.equal(readAction(step(1, 1)).kind, "unknown");
  assert.equal(readAction(step(0, 1.01)).kind, "unknown");
  assert.equal(readAction(step(1, Number.NaN)).kind, "unknown");
});

test("a dividend's units are the base balance times the multiplier's rise; a split's are zero", () => {
  // 10 tokens of 8 decimals, multiplier 1.0 → 1.004: 0.04 more of the stock.
  const units = dividendUnits(readAction(step(1, 1.004)), 1_000_000_000n, 8);
  assert.ok(Math.abs(units - 0.04) < 1e-12, String(units));
  assert.equal(dividendUnits(readAction(step(1, 2)), 1_000_000_000n, 8), 0);
  assert.equal(dividendUnits(readAction(step(1, 1.004)), 0n, 8), 0);
});

test("the dividend line of a year adds dividends only, counts splits apart, and keeps to its mint and period", () => {
  const steps = [
    step(1, 1.003, "2025-12-20T01:00:00.000Z"), // last year
    step(1.003, 1.006009, "2026-03-19T01:00:00.000Z"),
    step(1.006009, 2.012018, "2026-05-02T13:30:00.000Z"), // a 2-for-1 split
    step(2.012018, 2.018054, "2026-06-18T01:00:00.000Z"),
    step(1, 1.5, "2026-04-01T00:00:00.000Z", OTHER),
  ];
  const line = dividendLine(MINT, steps, 500_000_000n, 8, Date.parse("2026-01-01T00:00:00Z"));
  assert.equal(line.dividends, 2);
  assert.equal(line.splits, 1);
  assert.equal(line.unknown, 0);
  const expected = 5 * (1.006009 - 1.003) + 5 * (2.018054 - 2.012018);
  assert.ok(Math.abs(line.units - expected) < 1e-9, `${line.units} vs ${expected}`);
});

test("the chain's configuration gives one step once its time has passed, none before or when nothing changed", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  assert.deepEqual(stepFromConfig(MINT, { multiplier: 1.01, newMultiplier: 1.013, newMultiplierEffectiveAt: "2026-10-20T00:00:00.000Z" }, now), {
    mint: MINT,
    at: "2026-10-20T00:00:00.000Z",
    from: 1.01,
    to: 1.013,
  });
  assert.equal(stepFromConfig(MINT, { multiplier: 1.01, newMultiplier: 1.013, newMultiplierEffectiveAt: "2026-11-02T00:00:00.000Z" }, now), null);
  assert.equal(stepFromConfig(MINT, { multiplier: 1.01, newMultiplier: 1.01, newMultiplierEffectiveAt: "2026-10-20T00:00:00.000Z" }, now), null);
  assert.equal(stepFromConfig(MINT, { multiplier: 1, newMultiplier: 1, newMultiplierEffectiveAt: null }, now), null);
});

test("the history merges by mint and time, oldest first, and refuses what is not a step", () => {
  const a = step(1, 1.002, "2026-03-01T00:00:00.000Z");
  const b = step(1.002, 1.004, "2026-06-01T00:00:00.000Z");
  const merged = mergeSteps([b, { mint: "nope", at: "x", from: 1, to: 2 }], [a, b]);
  assert.deepEqual(merged, [a, b]);
  assert.equal(readStep({ mint: MINT, at: "2026-01-01T00:00:00Z", from: -1, to: 1 }), null);
  assert.equal(readStep(null), null);
});
