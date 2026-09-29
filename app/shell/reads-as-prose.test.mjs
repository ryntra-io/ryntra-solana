// Run from repo root: node --test app/shell/reads-as-prose.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { readsAsProse } from "./reads-as-prose.ts";

/**
 * The rule that decides whether a panel value takes the reading face.
 *
 * It exists because `Metric` and `KeyValue` set everything in mono, and the
 * network pulse printed `4 з 5` — a Cyrillic `з` at a digit's advance width in
 * a tabular-numeral face, which a reader sees as `4 3 5`. Getting this wrong in
 * the other direction is just as bad: a hash or an amount in the reading face
 * loses the alignment those columns exist for. Both halves are pinned here.
 */

test("Cyrillic is always copy", () => {
  for (const value of ["Так", "Невідомо", "Ні — testnet", "4 з 5", "Свіжі", "Недоступно"]) {
    assert.equal(readsAsProse(value), true, value);
  }
});

test("a Latin word is copy", () => {
  for (const value of ["Solana Mainnet", "Canary", "Verified read", "Fresh"]) {
    assert.equal(readsAsProse(value), true, value);
  }
});

test("recorded machine strings keep the machine face", () => {
  for (const value of [
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "0x8335…2913",
    "api.mainnet-beta.solana.com",
    "solscan.io",
    "8453",
    "58788083",
    "162 ms",
    "USDC",
    "HTTP 403",
    "1.000000 USDC",
    "6",
    "2 / 3",
  ]) {
    assert.equal(readsAsProse(value), false, value);
  }
});

test("a non-string value is never rewritten", () => {
  assert.equal(readsAsProse(58788083), false);
  assert.equal(readsAsProse(null), false);
  assert.equal(readsAsProse(undefined), false);
  assert.equal(readsAsProse(""), false);
  assert.equal(readsAsProse("   "), false);
});
