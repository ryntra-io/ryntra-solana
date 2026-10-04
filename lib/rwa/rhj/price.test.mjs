import assert from "node:assert/strict";
import test from "node:test";

import { PRICE_ROLES, basisOf, rhjIdentity } from "./identity.ts";
import {
  comparePrices,
  convertThenCompare,
  sameDecimal,
  toToken,
  toUnderlyingShare,
} from "./price.ts";

const RECEIVED = "2026-08-23T12:00:00.000Z";

function priced(role, value, surfaceId = "rhj-prices", currency = "USD") {
  return {
    role,
    value,
    currency,
    identity: rhjIdentity({
      surfaceId,
      instrumentId: "AAPL",
      productType: "STOCK_TOKEN",
      priceRole: role,
      observedAt: RECEIVED,
      receivedAt: RECEIVED,
      dataRightsState: "PUBLIC_READ",
      maxAgeSeconds: 120,
    }),
  };
}

test("every price role has exactly one basis, and the two token/share families are distinct", function () {
  /* The map is the whole guard. If a role ever gained a second basis, or a new
     role were added without one, `comparePrices` would silently start
     permitting a pair it exists to refuse. */
  for (const role of PRICE_ROLES) {
    const basis = basisOf(role);
    assert.ok(basis === "UNDERLYING_SHARE" || basis === "TOKEN", role + " has no basis");
  }
  assert.equal(basisOf("REFERENCE"), "UNDERLYING_SHARE");
  assert.equal(basisOf("ORACLE"), "TOKEN");
  assert.equal(basisOf("EXECUTABLE"), "TOKEN");
});

test("a REST reference quote and a Chainlink oracle reading refuse to be compared", function () {
  /* The exact pair the provider warns about: /rhj/prices returns the raw
     underlying bid/ask, the feed returns the multiplier-adjusted token. */
  const result = comparePrices(priced("REFERENCE", "213.45"), priced("ORACLE", "213.57"));
  assert.equal(result.ok, false);
  assert.equal(result.code, "BASIS_MISMATCH");
  assert.match(result.reason, /currentMultiplier/);
  assert.equal(result.differenceBps, undefined, "a refusal must not carry a number");
});

test("two figures on the same basis compare, and the sign points the right way", function () {
  const result = comparePrices(priced("ORACLE", "310.6007"), priced("EXECUTABLE", "309.9550"));
  assert.equal(result.ok, true);
  assert.equal(result.basis, "TOKEN");
  assert.equal(result.differenceText, "0.6457");
  /* 0.6457 / 309.9550 = 0.2083% → 21 bps, rounded away from zero. */
  assert.equal(result.differenceBps, 21);

  const mirrored = comparePrices(priced("EXECUTABLE", "309.9550"), priced("ORACLE", "310.6007"));
  assert.equal(mirrored.ok, true);
  assert.ok(mirrored.differenceBps < 0, "the reversed pair must be negative");
});

test("the same role twice is not a divergence", function () {
  const result = comparePrices(priced("ORACLE", "1"), priced("ORACLE", "2"));
  assert.equal(result.ok, false);
  assert.equal(result.code, "SAME_ROLE");
});

test("a missing multiplier refuses the conversion instead of becoming 1.0", function () {
  /* The quiet variant of the mixed-quantity defect: an unread multiplier that
     defaults to one publishes a token price as a share price and looks
     entirely ordinary. */
  const refusal = toUnderlyingShare(priced("ORACLE", "310.6007"), null);
  assert.equal(refusal.ok, false);
  assert.equal(refusal.code, "MULTIPLIER_MISSING");
  assert.equal(refusal.value, undefined);
});

test("converting a token price to its underlying share divides by the multiplier", function () {
  const multiplier = { value: "1.000566080061", source: "rhj-assets currentMultiplier" };
  const converted = toUnderlyingShare(priced("ORACLE", "310.6007"), multiplier);
  assert.equal(converted.ok, true);
  /* 310.6007 / 1.000566080061 = 310.4249… — the per-share figure. */
  assert.match(converted.value, /^310\.42/);
  assert.match(converted.conversion, /divided by currentMultiplier/);
});

test("converting an underlying-share price to the token multiplies by the multiplier", function () {
  const multiplier = { value: "1.000566080061", source: "rhj-assets currentMultiplier" };
  const converted = toToken(priced("REFERENCE", "310.4250"), multiplier);
  assert.equal(converted.ok, true);
  assert.match(converted.value, /^310\.60/);
});

test("a zero multiplier refuses rather than dividing", function () {
  const refusal = toUnderlyingShare(priced("ORACLE", "310.60"), { value: "0", source: "test" });
  assert.equal(refusal.ok, false);
  assert.equal(refusal.code, "ZERO_DENOMINATOR");
});

test("convertThenCompare produces the share-against-share figure, not the mixed one", function () {
  /*
   * The numbers that first exposed the defect, on the direct API's own pair.
   * Comparing the token oracle against the raw underlying quote without
   * converting reports the multiplier as if it were the market. Converted, the
   * answer is the real one.
   */
  const multiplier = { value: "1.000566080061", source: "rhj-assets currentMultiplier" };
  const oracle = priced("ORACLE", "310.6007");
  const reference = priced("REFERENCE", "310.4250");

  const result = convertThenCompare(oracle, reference, multiplier);
  assert.equal(result.ok, true, "an explicit conversion must produce a comparison, not a refusal");
  assert.equal(result.basis, "UNDERLYING_SHARE");
  assert.ok(result.conversion !== null, "the applied conversion must travel on the result");
  assert.match(result.conversion, /currentMultiplier/);
  /* Share against share: essentially flat, and far below the ~21 bps the
     unconverted pair would have reported. */
  assert.ok(Math.abs(result.differenceBps) <= 2, "converted divergence was " + result.differenceBps);
});

test("convertThenCompare still refuses when the multiplier is absent", function () {
  const result = convertThenCompare(priced("ORACLE", "310.6007"), priced("REFERENCE", "310.4250"), null);
  assert.equal(result.ok, false);
  assert.equal(result.code, "MULTIPLIER_MISSING");
});

test("no exported function returns a single blended figure for two roles", function () {
  /* There is deliberately no average. This asserts the absence, because the
     defect is a helper somebody adds later that looks harmless. */
  const surface = { comparePrices, convertThenCompare, toToken, toUnderlyingShare, sameDecimal };
  for (const name of Object.keys(surface)) {
    assert.ok(
      !/average|mean|blend|midpoint/i.test(name),
      name + " reads as a function that collapses two roles into one figure",
    );
  }
});

test("decimal equality ignores scale but not value", function () {
  assert.equal(sameDecimal("1.0", "1.000"), true);
  assert.equal(sameDecimal("1.0", "1.001"), false);
  assert.equal(sameDecimal("oops", "1"), false);
});
