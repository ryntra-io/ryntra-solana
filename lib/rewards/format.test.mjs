import assert from "node:assert/strict";
import test from "node:test";

import { dollars, usdText } from "./format.ts";
import { rewardsView } from "./view.ts";
import { unconfiguredReserve } from "./balance.ts";

test("a sub-cent reward reads as a bound, never as nothing", () => {
  assert.equal(usdText(0n), "0.00");
  assert.equal(usdText(1n), "<0.01");
  assert.equal(usdText(6_344n), "<0.01", "the second real fill's cashback, ≈ $0.0063");
  assert.equal(usdText(9_999n), "<0.01");
  assert.equal(usdText(10_000n), "0.01");
  assert.equal(usdText(1_234_567n), "1.23");
  assert.equal(dollars("<0.01"), "<$0.01");
  assert.equal(dollars("0.00"), "$0.00");
  assert.equal(dollars("12.50"), "$12.50");
});

test("the Rewards view carries the bound through every figure and row", () => {
  const entry = (usdMicros, type = "CASHBACK") => ({
    type,
    recipient: "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp",
    rateBps: type === "CLAIM" ? 0 : 5000,
    shareRaw: type === "CLAIM" ? null : "1",
    usdMicros,
    valuation: { basis: "PROVIDER_STATED_USD", price: null, sourceRef: "RELAY_APP_FEE", observedAt: "2026-09-11T00:00:00.000Z" },
    source: type === "CLAIM" ? null : {
      mechanism: "RELAY_APP_FEE", operationRef: "req-1", trader: "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp",
      grossRaw: "12552", asset: null, symbol: "USDC", decimals: 6, settledAt: "2026-09-11T00:00:00.000Z",
    },
    createdAt: "2026-09-11T00:00:00.000Z",
    claimId: type === "CLAIM" ? "c1" : null,
    signature: null,
  });
  const view = rewardsView({
    entries: [entry("6276"), entry("3172")],
    reserve: unconfiguredReserve("test"),
    heldUsdMicros: 0n,
    referrals: { level1: 0, level2: 0 },
    referral: null,
    claim: null,
    locale: "en",
  });
  assert.equal(view.lifetime, "<0.01", "two sub-cent rewards are still under a cent together");
  assert.equal(view.cashback, "<0.01");
  assert.equal(view.available, "0.00", "nothing is claimable from an unconfigured reserve");
  assert.equal(view.pending, "<0.01");
  assert.deepEqual(view.rows.map((row) => row.display), ["+<$0.01", "+<$0.01"]);
  assert.equal(view.rows[0].amount, "<0.01");
});

test("every reward row the routes serve is the contract's shape (1.11.0)", async () => {
  const { RewardsRowSchema } = await import("../api/v1/contract.ts");
  const entry = (usd, type = "CASHBACK") => ({
    id: `e-${usd}-${type}`,
    type,
    usdMicros: usd,
    state: "SETTLED",
    source: { grossRaw: "12552", asset: null, symbol: "USDC", decimals: 6, settledAt: "2026-09-11T00:00:00.000Z" },
    createdAt: "2026-09-11T00:00:00.000Z",
    claimId: type === "CLAIM" ? "c1" : null,
    signature: null,
  });
  const view = rewardsView({ entries: [entry("6276"), entry("1250000"), entry("3172")], reserve: unconfiguredReserve("test"), heldUsdMicros: 0n, referrals: { level1: 0, level2: 0 }, referral: null, claim: null, locale: "en" });
  assert.ok(view.rows.length >= 2);
  for (const row of view.rows) assert.equal(RewardsRowSchema.safeParse(JSON.parse(JSON.stringify(row))).success, true, row.display);
});
