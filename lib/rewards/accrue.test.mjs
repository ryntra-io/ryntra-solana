import assert from "node:assert/strict";
import test from "node:test";

import { accrueRewards } from "./accrue.ts";
import { eligibleForRewards, rewardsActivation } from "./activation.ts";
import {
  formatUsdMicros,
  REWARD_MINIMUM_CLAIM_USD_MICROS,
  REWARD_RATE_BPS,
  shareOfGross,
  usdMicrosFromStated,
  usdMicrosOf,
} from "./model.ts";
import { serviceFeeQuoted, settleServiceFee } from "../swap/service-fee.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TRADER = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const L1 = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const L2 = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SETTLED = "2026-09-11T12:00:00.000Z";
const NOW = "2026-09-11T12:00:05.000Z";

/**
 * A collected fee of `grossRaw`, in the asset given.
 *
 * Built through the real `serviceFeeQuoted` / `settleServiceFee` pair rather
 * than as a literal, so a change to the fee model that would break accrual
 * fails here rather than in production.
 */
function collectedFee({ grossRaw, asset, decimals, retained, usd = null, mechanism = "JUPITER_REFERRAL" }) {
  const quoted = serviceFeeQuoted(mechanism, {
    basisPoints: 50,
    asset,
    symbol: "TOKEN",
    decimals,
    amountRaw: grossRaw,
    providerRetainedPercent: retained,
  });
  const provider = retained === null ? null : ((BigInt(grossRaw) * BigInt(retained) + 99n) / 100n).toString();
  return settleServiceFee(quoted, {
    collected: true,
    amountRaw: grossRaw,
    usd,
    settlement: {
      userPaidRaw: grossRaw,
      providerRaw: provider,
      ryntraRaw: provider === null ? grossRaw : (BigInt(grossRaw) - BigInt(provider)).toString(),
      asset,
      symbol: "TOKEN",
      decimals,
      basis: "RYNTRA_OBSERVED_SPLIT_DOCUMENTED",
      operationRef: "5nQ9ryntraTestSignature",
    },
  });
}

test("the owner's Jupiter example divides exactly as written", () => {
  /* $5.00 gross in USDC, Jupiter retaining 20%. The owner's table:
     cashback 2.50, L1 0.50, L2 0.25, Ryntra keeps 0.75 of its own 4.00. */
  const fee = collectedFee({ grossRaw: "5000000", asset: USDC, decimals: 6, retained: 20 });
  const result = accrueRewards({
    fee,
    trader: TRADER,
    referrerL1: L1,
    referrerL2: L2,
    settledAt: SETTLED,
    now: NOW,
    price: null,
  });
  assert.equal(result.ok, true);
  const byType = Object.fromEntries(result.entries.map((entry) => [entry.type, entry]));

  assert.equal(formatUsdMicros(BigInt(byType.CASHBACK.usdMicros)), "2.50");
  assert.equal(formatUsdMicros(BigInt(byType.REFERRAL_L1.usdMicros)), "0.50");
  assert.equal(formatUsdMicros(BigInt(byType.REFERRAL_L2.usdMicros)), "0.25");

  /* Ryntra's residual is what is left of its own share, not of the gross. */
  const paidOut = ["CASHBACK", "REFERRAL_L1", "REFERRAL_L2"].reduce(
    (sum, type) => sum + BigInt(byType[type].usdMicros),
    0n,
  );
  const ryntra = BigInt(fee.settlement.ryntraRaw) - paidOut;
  assert.equal(formatUsdMicros(ryntra), "0.75");

  /* Every share is a share of the gross the person paid, never of the residual. */
  for (const entry of result.entries) {
    assert.equal(entry.source.grossRaw, "5000000");
    assert.equal(entry.recipient !== TRADER || entry.type === "CASHBACK", true);
  }
});

test("the owner's Relay example leaves Ryntra more because the provider takes none", () => {
  const fee = collectedFee({ grossRaw: "5000000", asset: USDC, decimals: 6, retained: 0, mechanism: "RELAY_APP_FEE" });
  const result = accrueRewards({
    fee,
    trader: TRADER,
    referrerL1: L1,
    referrerL2: L2,
    settledAt: SETTLED,
    now: NOW,
    price: null,
  });
  assert.equal(result.ok, true);
  const paidOut = result.entries.reduce((sum, entry) => sum + BigInt(entry.usdMicros), 0n);
  assert.equal(formatUsdMicros(paidOut), "3.25");
  assert.equal(formatUsdMicros(BigInt(fee.settlement.ryntraRaw) - paidOut), "1.75");
});

test("a missing level leaves its share with Ryntra and never promotes the other", () => {
  const fee = collectedFee({ grossRaw: "5000000", asset: USDC, decimals: 6, retained: 20 });
  const noL2 = accrueRewards({
    fee, trader: TRADER, referrerL1: L1, referrerL2: null, settledAt: SETTLED, now: NOW, price: null,
  });
  assert.deepEqual(noL2.entries.map((entry) => entry.type), ["CASHBACK", "REFERRAL_L1"]);
  assert.equal(formatUsdMicros(BigInt(noL2.entries[1].usdMicros)), "0.50");

  const alone = accrueRewards({
    fee, trader: TRADER, referrerL1: null, referrerL2: null, settledAt: SETTLED, now: NOW, price: null,
  });
  assert.deepEqual(alone.entries.map((entry) => entry.type), ["CASHBACK"]);
  /* The 15% nobody claimed did not move to the trader. */
  assert.equal(formatUsdMicros(BigInt(alone.entries[0].usdMicros)), "2.50");
});

test("a wallet cannot be its own referrer, and one wallet is never paid twice for one fee", () => {
  const fee = collectedFee({ grossRaw: "5000000", asset: USDC, decimals: 6, retained: 20 });
  const self = accrueRewards({
    fee, trader: TRADER, referrerL1: TRADER, referrerL2: TRADER, settledAt: SETTLED, now: NOW, price: null,
  });
  assert.deepEqual(self.entries.map((entry) => entry.type), ["CASHBACK"]);

  const duplicated = accrueRewards({
    fee, trader: TRADER, referrerL1: L1, referrerL2: L1, settledAt: SETTLED, now: NOW, price: null,
  });
  assert.deepEqual(duplicated.entries.map((entry) => entry.type), ["CASHBACK", "REFERRAL_L1"]);
});

test("only a collected fee accrues; a quote accrues nothing", () => {
  const quoted = serviceFeeQuoted("JUPITER_REFERRAL", { basisPoints: 50, asset: USDC, decimals: 6, amountRaw: "5000000" });
  const result = accrueRewards({
    fee: quoted, trader: TRADER, referrerL1: null, referrerL2: null, settledAt: SETTLED, now: NOW, price: null,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /not income/);

  const notCollected = settleServiceFee(quoted, { collected: false });
  const second = accrueRewards({
    fee: notCollected, trader: TRADER, referrerL1: null, referrerL2: null, settledAt: SETTLED, now: NOW, price: null,
  });
  assert.equal(second.ok, false);
});

test("a fee in an asset with no price is recorded exactly and left unvalued", () => {
  const WSOL = "So11111111111111111111111111111111111111112";
  const fee = collectedFee({ grossRaw: "50000", asset: WSOL, decimals: 9, retained: 20 });
  const result = accrueRewards({
    fee, trader: TRADER, referrerL1: null, referrerL2: null, settledAt: SETTLED, now: NOW, price: null,
  });
  assert.equal(result.ok, true);
  const cashback = result.entries[0];
  /* The share of the fee asset is exact even though the dollar figure is not
     known: 50% of 50,000 lamports is 25,000, and that is a fact. */
  assert.equal(cashback.shareRaw, "25000");
  assert.equal(cashback.usdMicros, null);
  assert.equal(cashback.valuation.basis, "UNVALUED");
});

test("a price turns the same fee into dollars without inventing precision", () => {
  const WSOL = "So11111111111111111111111111111111111111112";
  const fee = collectedFee({ grossRaw: "50000", asset: WSOL, decimals: 9, retained: 20 });
  const result = accrueRewards({
    fee,
    trader: TRADER,
    referrerL1: null,
    referrerL2: null,
    settledAt: SETTLED,
    now: NOW,
    price: { price: "200", sourceRef: "catalog:price", observedAt: SETTLED },
  });
  /* 25,000 lamports at $200 is 0.000025 SOL = $0.005 = 5,000 micro-dollars. */
  assert.equal(result.entries[0].usdMicros, "5000");
  assert.equal(result.entries[0].valuation.basis, "PRICED_AT_SETTLEMENT");
});

test("the provider's own figure for a fee it took outranks a price looked up later", () => {
  const WSOL = "So11111111111111111111111111111111111111112";
  /* The real Relay fill of 2026-09-10: 100,000 raw, which Relay valued at
     $0.010153 on the fill itself. */
  const fee = collectedFee({
    grossRaw: "100000", asset: WSOL, decimals: 9, retained: 0, usd: 0.010153, mechanism: "RELAY_APP_FEE",
  });
  const result = accrueRewards({
    fee,
    trader: TRADER,
    referrerL1: L1,
    referrerL2: null,
    settledAt: SETTLED,
    now: NOW,
    price: { price: "999999", sourceRef: "catalog:price", observedAt: SETTLED },
    providerUsd: 0.010153,
  });
  assert.equal(result.entries[0].valuation.basis, "PROVIDER_STATED_USD");
  /* Half of 10,153 micro-dollars, floored. */
  assert.equal(result.entries[0].usdMicros, "5076");
  /* A tenth of the same base, floored — never a tenth of the cashback. */
  assert.equal(result.entries[1].usdMicros, "1015");
});

test("shares are floored, so three of them never exceed the gross", () => {
  /* An amount chosen so every division has a remainder. */
  const gross = 999_999n;
  const cashback = shareOfGross(gross, REWARD_RATE_BPS.CASHBACK);
  const l1 = shareOfGross(gross, REWARD_RATE_BPS.REFERRAL_L1);
  const l2 = shareOfGross(gross, REWARD_RATE_BPS.REFERRAL_L2);
  assert.equal(cashback, 499_999n);
  assert.equal(l1, 99_999n);
  assert.equal(l2, 49_999n);
  assert.ok(cashback + l1 + l2 < (gross * 6_500n) / 10_000n + 3n);
  assert.ok(cashback + l1 + l2 < gross);
});

test("a stated dollar figure becomes exact micros through text, not arithmetic", () => {
  assert.equal(usdMicrosFromStated(0.010153), 10_153n);
  assert.equal(usdMicrosFromStated(0.1 + 0.2), 300_000n);
  assert.equal(usdMicrosFromStated(0), 0n);
  assert.equal(usdMicrosFromStated(0.0000019), 1n);
  assert.equal(usdMicrosFromStated(0.0000009), 0n);
  assert.equal(usdMicrosFromStated(Number.NaN), null);
  assert.equal(usdMicrosFromStated(-1), null);
  assert.equal(usdMicrosFromStated(Number.POSITIVE_INFINITY), null);
});

test("a price is an exact rational and an unrepresentable one is refused", () => {
  assert.equal(usdMicrosOf({ raw: 1_000_000_000n, decimals: 9, price: "142.37" }), 142_370_000n);
  assert.throws(() => usdMicrosOf({ raw: 1n, decimals: 9, price: "1e5" }));
  assert.throws(() => usdMicrosOf({ raw: 1n, decimals: 9, price: "0" }));
});

test("nothing accrues before the activation instant, and the instant itself is closed", () => {
  const activation = rewardsActivation({ RYNTRA_REWARDS_ACTIVATION_AT: "2026-09-11T00:00:00Z" });
  assert.equal(activation.state, "OPEN");
  assert.equal(eligibleForRewards("2026-09-10T23:59:59.999Z", activation), false);
  assert.equal(eligibleForRewards("2026-09-11T00:00:00.000Z", activation), false);
  assert.equal(eligibleForRewards("2026-09-11T00:00:00.001Z", activation), true);
});

test("an unset or ambiguous activation is closed rather than guessed", () => {
  assert.equal(rewardsActivation({}).state, "CLOSED");
  assert.equal(rewardsActivation({ RYNTRA_REWARDS_ACTIVATION_AT: "  " }).state, "CLOSED");
  /* No timezone: midnight in which place? Guessing decides whether a day of
     real fees is owed to people. */
  assert.equal(rewardsActivation({ RYNTRA_REWARDS_ACTIVATION_AT: "2026-09-11" }).state, "CLOSED");
  assert.equal(rewardsActivation({ RYNTRA_REWARDS_ACTIVATION_AT: "not a date" }).state, "CLOSED");
  assert.equal(eligibleForRewards("2026-09-11T12:00:00Z", rewardsActivation({})), false);
});

test("the claim floor is one dollar, stated in the same unit everything else uses", () => {
  assert.equal(REWARD_MINIMUM_CLAIM_USD_MICROS, 1_000_000n);
  assert.equal(formatUsdMicros(REWARD_MINIMUM_CLAIM_USD_MICROS), "1.00");
  assert.equal(formatUsdMicros(0n), "0.00");
  assert.equal(formatUsdMicros(-4_800_000n), "-4.80");
  /* Truncated, not rounded: a balance must never read higher than it is. */
  assert.equal(formatUsdMicros(1_239_999n), "1.23");
});
