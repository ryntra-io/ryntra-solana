import assert from "node:assert/strict";
import test from "node:test";

import {
  accrualFor,
  isServiceFeeIncome,
  normalizeServiceFeeConfig,
  RYNTRA_SERVICE_FEE_POLICY,
  serviceFeeRateFor,
  ServiceFeeSchema,
  serviceFeeAbsent,
  serviceFeeAmountText,
  serviceFeeIsCharged,
  serviceFeeNotApplied,
  serviceFeeQuoted,
  serviceFeeRateText,
  serviceFeeUnconfigured,
  settleServiceFee,
} from "./service-fee.ts";

test("the rate is per mechanism: fifty on Jupiter, twenty-five on Relay, and no global number", () => {
  /* Set per mechanism since 2026-09-11. One constant for every provider is how
     the product went a day without a Jupiter fee: Jupiter's referral floor is
     50 (verified live, HTTP 400 below it) and Relay's rate is 25. Each
     mechanism carries its own, and Relay's is not touched by Jupiter's. */
  assert.equal(RYNTRA_SERVICE_FEE_POLICY.JUPITER_REFERRAL, 50);
  assert.equal(RYNTRA_SERVICE_FEE_POLICY.RELAY_APP_FEE, 25);
  assert.equal(serviceFeeRateFor("JUPITER_REFERRAL"), 50);
  assert.equal(serviceFeeRateFor("RELAY_APP_FEE"), 25);
  assert.equal(serviceFeeRateFor("NONE"), 0, "no mechanism, no rate");
  for (const rate of Object.values(RYNTRA_SERVICE_FEE_POLICY)) assert.ok(rate > 0 && rate <= 10_000);
});

test("each rate reads exactly, never as a rounder number", () => {
  /* 0.25% and 0.3% are different claims about somebody's money, and a fee text
     that rounds is a fee text that misstates. */
  assert.equal(serviceFeeRateText({ basisPoints: serviceFeeRateFor("RELAY_APP_FEE") }), "0.25%");
  assert.equal(serviceFeeRateText({ basisPoints: serviceFeeRateFor("JUPITER_REFERRAL") }), "0.50%");
});

test("a quoted fee is not income, and only a collected one is", () => {
  const quoted = serviceFeeQuoted("RELAY_APP_FEE", { basisPoints: 50, amountRaw: "5000", decimals: 6, symbol: "USDC", usd: 0.005 });
  assert.equal(quoted.state, "QUOTED");
  assert.equal(isServiceFeeIncome(quoted), false, "a quote is an intention, never earnings");

  const collected = settleServiceFee(quoted, { collected: true, amountRaw: "4998" });
  assert.equal(collected.state, "COLLECTED");
  assert.equal(collected.amountRaw, "4998", "what was taken wins over what was quoted");
  assert.equal(isServiceFeeIncome(collected), true);

  const missed = settleServiceFee(quoted, { collected: false });
  assert.equal(missed.state, "NOT_COLLECTED");
  assert.equal(missed.basisPoints, 50, "the quoted rate stays visible so the gap is legible");
  assert.equal(isServiceFeeIncome(missed), false);
  assert.ok(missed.note, "a fee that did not arrive says why");
});

test("three different zeros, and none of them is the others", () => {
  const absent = serviceFeeAbsent("CCTP has no integrator fee mechanism.");
  assert.equal(absent.mechanism, "NONE");
  assert.equal(absent.state, "NONE");
  assert.equal(absent.requestedBasisPoints, 0, "nothing was asked for, so nothing was requested");

  const unset = serviceFeeUnconfigured("JUPITER_REFERRAL", "No referral account.");
  assert.equal(unset.state, "UNCONFIGURED");
  assert.equal(unset.requestedBasisPoints, serviceFeeRateFor("JUPITER_REFERRAL"), "the mechanism exists; the address does not");
  assert.equal(serviceFeeUnconfigured("RELAY_APP_FEE", "No recipient.").requestedBasisPoints, 25, "and each mechanism asks for its own rate");

  const refused = serviceFeeNotApplied("JUPITER_REFERRAL", "Jupiter did not apply it.");
  assert.equal(refused.state, "NOT_APPLIED");
  assert.equal(refused.basisPoints, 0, "a fee the provider did not charge is not charged");

  for (const fee of [absent, unset, refused]) {
    assert.equal(isServiceFeeIncome(fee), false);
    assert.equal(serviceFeeIsCharged(fee), false);
  }
});

test("settling never resurrects a fee on a route that has no mechanism", () => {
  const absent = serviceFeeAbsent("CCTP has no integrator fee mechanism.");
  assert.deepEqual(settleServiceFee(absent, { collected: true, amountRaw: "999999" }), absent);
});

test("the rate reads as two decimals and the amount only when the provider stated one", () => {
  const withAmount = serviceFeeQuoted("RELAY_APP_FEE", { basisPoints: 50, amountRaw: "499300", decimals: 6, symbol: "USDC" });
  assert.equal(serviceFeeRateText(withAmount), "0.50%", "0.5% reads like a rounder number than the one charged");
  assert.equal(serviceFeeAmountText(withAmount), "0.4993 USDC");

  /* Jupiter states a rate and never an amount, so this is the common case and it
     must not produce a figure nobody quoted. */
  const rateOnly = serviceFeeQuoted("JUPITER_REFERRAL", { basisPoints: 50, asset: "So11111111111111111111111111111111111111112" });
  assert.equal(serviceFeeAmountText(rateOnly), null);
  assert.equal(serviceFeeRateText(rateOnly), "0.50%");

  assert.equal(serviceFeeRateText(serviceFeeAbsent("none")), "0.00%", "a true zero prints as a zero, not a blank");
});

test("each mechanism accrues somewhere different, and the model says which", () => {
  assert.equal(accrualFor("JUPITER_REFERRAL"), "JUPITER_REFERRAL_TOKEN_ACCOUNT");
  assert.equal(accrualFor("RELAY_APP_FEE"), "RELAY_APP_BALANCE_USDC");
  assert.equal(accrualFor("MAYAN_REFERRER"), "MAYAN_ONCHAIN_REFERRER");
  assert.equal(accrualFor("NONE"), "NONE");
});

test("a misshapen address degrades to no fee rather than to a broken swap", () => {
  const config = normalizeServiceFeeConfig({
    jupiterReferralAccount: "not-base58!",
    relayAppFeeRecipient: "0xdeadbeef",
    mayanReferrerSolana: "  ",
  });
  assert.deepEqual(config, { jupiterReferralAccount: null, relayAppFeeRecipient: null, mayanReferrerSolana: null });

  const good = normalizeServiceFeeConfig({
    jupiterReferralAccount: " 18LeLp3B8yGctKtWKAXXqdB6Lf1GxmEa2fRL5xxa1ta ",
    relayAppFeeRecipient: "0x999999cf1046e68e36E1aA2E0E07105eDDD1f08E",
    mayanReferrerSolana: "HZj6nyfWqFYZVjgQHXzsqkvPnUoY3gTs87QzptrJNVDa",
  });
  assert.equal(good.jupiterReferralAccount, "18LeLp3B8yGctKtWKAXXqdB6Lf1GxmEa2fRL5xxa1ta", "surrounding space is trimmed, not fatal");
  assert.equal(good.relayAppFeeRecipient, "0x999999cf1046e68e36E1aA2E0E07105eDDD1f08E");
  assert.equal(good.mayanReferrerSolana, "HZj6nyfWqFYZVjgQHXzsqkvPnUoY3gTs87QzptrJNVDa");

  /* An EVM claim address is not a Solana referrer and the reverse, and neither
     may be accepted in the other's slot. */
  const crossed = normalizeServiceFeeConfig({
    jupiterReferralAccount: "0x999999cf1046e68e36E1aA2E0E07105eDDD1f08E",
    relayAppFeeRecipient: "HZj6nyfWqFYZVjgQHXzsqkvPnUoY3gTs87QzptrJNVDa",
  });
  assert.equal(crossed.jupiterReferralAccount, null);
  assert.equal(crossed.relayAppFeeRecipient, null);
});

test("every constructor produces something the shared schema accepts", () => {
  const fees = [
    serviceFeeAbsent("none"),
    serviceFeeUnconfigured("MAYAN_REFERRER", "no address"),
    serviceFeeNotApplied("RELAY_APP_FEE", "no app fee quoted"),
    serviceFeeQuoted("JUPITER_REFERRAL", { basisPoints: 50, asset: "So11111111111111111111111111111111111111112", providerRetainedPercent: 20 }),
    settleServiceFee(serviceFeeQuoted("RELAY_APP_FEE", { basisPoints: 50 }), { collected: true, amountRaw: "1", decimals: 6, symbol: "USDC" }),
  ];
  for (const fee of fees) assert.deepEqual(ServiceFeeSchema.parse(fee), fee);
});
