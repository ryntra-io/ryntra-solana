import assert from "node:assert/strict";
import test from "node:test";

import { enrichActivityMetadata, projectLaneOutcome } from "./activity-projection.ts";

const WALLET = "4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n";
const SIGNATURE = "4G7TN124BA93vKwCdxX2QH7JjXZrHXqRtaNcTdX4hQoKSELMSnigUCKaRCLoJco9uFfdSsvUfwicrcZQPYKadk6o";
const WSOL = "So11111111111111111111111111111111111111112";
const UNKNOWN = "9xQeWvG816bUx9EPjHmaT23yvVM7yNpxw3y3fiqK9QeW";

const action = (overrides = {}) => ({
  schema: "ryntra.solana.wallet-action",
  schemaVersion: "1.0.0",
  version: 2,
  network: "mainnet",
  wallet: WALLET,
  actionId: SIGNATURE,
  lane: "SEND",
  outcome: "DONE",
  out: { mint: WSOL, amountRaw: "125000000", decimals: null, symbol: "Wrapped SOL" },
  in: null,
  destination: null,
  signature: SIGNATURE,
  receiptHash: `0x${"a".repeat(64)}`,
  startedAt: "2026-09-03T10:00:00.000Z",
  updatedAt: "2026-09-03T10:01:00.000Z",
  ...overrides,
});

test("a stale lane snapshot cannot turn a newer terminal action back into in flight", () => {
  const current = action();
  assert.strictEqual(
    projectLaneOutcome(current, { outcome: "IN_FLIGHT", updatedAt: "2026-09-03T10:00:30.000Z" }),
    current,
  );
});

test("a fresh terminal lane answer advances an unresolved action", () => {
  const unresolved = action({ outcome: "IN_FLIGHT", receiptHash: null });
  assert.equal(
    projectLaneOutcome(unresolved, { outcome: "DONE", updatedAt: "2026-09-03T10:02:00.000Z" }).outcome,
    "DONE",
  );
});

test("missing or unreadable lane evidence leaves the recorded answer unchanged", () => {
  const unresolved = action({ outcome: "IN_FLIGHT", receiptHash: null });
  assert.strictEqual(projectLaneOutcome(unresolved, null), unresolved);
  assert.strictEqual(projectLaneOutcome(unresolved, { outcome: "DONE", updatedAt: "not-an-instant" }), unresolved);
});

test("native SOL uses its structural display identity and a live holding can fill swap decimals", () => {
  const holdings = [{
    kind: "NATIVE_SOL",
    mint: null,
    decimals: 9,
    symbol: "SOL",
    catalog: { symbol: "WSOL", name: "Wrapped SOL" },
  }];
  const enriched = enrichActivityMetadata(action(), holdings);
  assert.deepEqual(enriched.out, { mint: WSOL, amountRaw: "125000000", decimals: 9, symbol: "SOL" });
});

test("the historical System Program mint sentinel is displayed as native SOL", () => {
  const native = action({
    actionId: "KdyZBwSkaeoKiqvTJV7R4Legir1SCL5xZBd6xSwqFhDTJrGkbq3xr4nU1fdtB4dJVjeXVfTwnv9x48ZZPeS5EyT",
    signature: "KdyZBwSkaeoKiqvTJV7R4Legir1SCL5xZBd6xSwqFhDTJrGkbq3xr4nU1fdtB4dJVjeXVfTwnv9x48ZZPeS5EyT",
    out: { mint: "11111111111111111111111111111111", amountRaw: "11740798", decimals: 9, symbol: null },
  });
  assert.deepEqual(enrichActivityMetadata(native, []).out, {
    mint: "11111111111111111111111111111111",
    amountRaw: "11740798",
    decimals: 9,
    symbol: "SOL",
  });
});

test("missing decimals and metadata stay missing instead of choosing a scale", () => {
  const unknown = action({
    lane: "SWAP",
    out: { mint: UNKNOWN, amountRaw: "123456", decimals: null, symbol: null },
    receiptHash: null,
  });
  assert.strictEqual(enrichActivityMetadata(unknown, []).out, unknown.out);
});
