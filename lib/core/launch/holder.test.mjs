import assert from "node:assert/strict";
import test from "node:test";

import {
  HOLDER_GRANT_BITMASK,
  POSITION_PERMISSION_BITS,
  collectorNextClaim,
  collectorShouldClaim,
  holderEarningsCard,
  holderEntryFeeRaw,
  holderGrantState,
  permissionsOf,
  poolOutcome,
  poolOutcomes,
  zapPriceMoveBps,
} from "./holder.ts";

test("Zap may move the square-root price by the entry's own measured move plus half the slippage — never the slippage alone", () => {
  /* The demo market's first entry, 10.10: 5 USDC into a ≈ 70 USDC pool; the guard set to the slippage (100) refused it on chain. */
  assert.equal(zapPriceMoveBps(350, 100), 400, "the own move, and the price's 1 % for others as 0.5 % of its square root");
  assert.equal(zapPriceMoveBps(0, 100), 50, "a swap that moves nothing leaves only the others' share");
  assert.equal(zapPriceMoveBps(Number.NaN, 100), 50, "an unread move adds nothing");
  assert.equal(zapPriceMoveBps(12.4, 101), 64, "parts of a basis point round up — the own move always fits");
  assert.equal(zapPriceMoveBps(9_990, 1_000), 10_000, "capped at the whole price");
  /* The square root moves half as far as the price for a small move: (1 + m)² − 1 ≈ 2m. */
  for (const m of [0.001, 0.005]) assert.ok(Math.abs(((1 + m) ** 2 - 1) / (2 * m) - 1) < 0.01);
});

test("The collector's queue: a day after the last claim, and only with a whole dollar waiting", () => {
  const now = Date.parse("2026-10-10T17:00:00.000Z");
  const first = collectorNextClaim({ claimablePairRaw: 0n, pairDecimals: 6, lastClaimAt: null, now });
  assert.deepEqual(first, { notBefore: "2026-10-10T17:00:00.000Z", enoughWaiting: false, dueNow: false });
  const due = collectorNextClaim({ claimablePairRaw: 1_000_000n, pairDecimals: 6, lastClaimAt: null, now });
  assert.equal(due.dueNow, true);
  const waiting = collectorNextClaim({ claimablePairRaw: 2_000_000n, pairDecimals: 6, lastClaimAt: "2026-10-10T09:00:00.000Z", now });
  assert.deepEqual(waiting, { notBefore: "2026-10-11T09:00:00.000Z", enoughWaiting: true, dueNow: false });
  assert.equal(collectorNextClaim({ claimablePairRaw: 999_999n, pairDecimals: 6, lastClaimAt: "2026-10-01T00:00:00.000Z", now }).dueNow, false, "a day passed, a dollar not yet");
});

/* Synthetic addresses only: nothing here names a real account. */
const COLLECTOR = "Coll111111111111111111111111111111111111111";
const OTHER = "Other11111111111111111111111111111111111111";

test("Ryntra's grant is the two bits that pay only the owner — 80, as the devnet proof signed", () => {
  assert.equal(HOLDER_GRANT_BITMASK, 80);
  assert.deepEqual(permissionsOf(HOLDER_GRANT_BITMASK), ["ClaimPositionFeeToOwner", "ClaimRewardToOwner"]);
  for (const name of ["RemoveLiquidity", "ClaimPositionFee", "ClaimReward", "AddLiquidity", "RemoveLiquidityToOwner", "LockPosition"]) {
    assert.equal(HOLDER_GRANT_BITMASK & (1 << POSITION_PERMISSION_BITS[name]), 0, `${name} is never asked for`);
  }
});

test("the collector acts only on exactly its own grant", () => {
  const base = { delegate: COLLECTOR, delegatedAmount: "0", bitmask: 80, collector: COLLECTOR };
  assert.equal(holderGrantState(base), "GRANTED");
  assert.equal(holderGrantState({ ...base, bitmask: 0 }), "NONE");
  assert.equal(holderGrantState({ ...base, delegate: null }), "NONE");
  assert.equal(holderGrantState({ ...base, delegate: OTHER }), "OTHER_DELEGATE");
  assert.equal(holderGrantState({ ...base, collector: null }), "OTHER_DELEGATE");
  /* An approval of 1 would let the delegate move the NFT: the program refuses it, the page says to revoke. */
  assert.equal(holderGrantState({ ...base, delegatedAmount: "1" }), "TRANSFERABLE");
  /* A position that allows more than Ryntra asked for — even «to the owner» — is not acted on. */
  assert.equal(holderGrantState({ ...base, bitmask: 80 | 1 << 2 }), "WIDER");
  assert.equal(holderGrantState({ ...base, bitmask: 80 | 1 << 3 }), "WIDER");
  /* Rewards to the owner alone is not the fee grant. */
  assert.equal(holderGrantState({ ...base, bitmask: 1 << 6 }), "NONE");
});

test("the pool's outcome at ±10 % and ±30 %: a full-range position against the two coins kept", () => {
  const rows = poolOutcomes(100);
  assert.deepEqual(rows.map((row) => row.moveBps), [-3000, -1000, 1000, 3000]);
  for (const row of rows) assert.ok(row.difference <= 0, "the pool never beats keeping both coins on a move, fees aside");
  const up30 = poolOutcome(100, 3000);
  assert.ok(Math.abs(up30.position - 114.0175) < 1e-3);
  assert.ok(Math.abs(up30.held - 115) < 1e-9);
  assert.ok(Math.abs(up30.difference / up30.held + 0.008543) < 1e-5, "−0.85 % against keeping the coins");
  const down30 = poolOutcome(100, -3000);
  assert.ok(Math.abs(down30.difference / down30.held + 0.015694) < 1e-5, "−1.57 % against keeping the coins");
  assert.equal(poolOutcome(100, 0).difference, 0);
});

test("Ryntra's share at entry is the policy's rate on the swapped part, rounded down", () => {
  assert.equal(holderEntryFeeRaw(2_500_000n, 100), 25_000n);
  assert.equal(holderEntryFeeRaw(99n, 100), 0n);
  assert.equal(holderEntryFeeRaw(0n, 100), 0n);
  assert.equal(holderEntryFeeRaw(1_000_000n, 0), 0n);
});

test("the collector claims a dollar pair's whole unit at most once a day", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  const base = { claimablePairRaw: 1_000_000n, pairDecimals: 6, pairIsDollar: true, lastClaimAt: null, now };
  assert.equal(collectorShouldClaim(base), true);
  assert.equal(collectorShouldClaim({ ...base, claimablePairRaw: 999_999n }), false);
  assert.equal(collectorShouldClaim({ ...base, pairIsDollar: false }), false);
  assert.equal(collectorShouldClaim({ ...base, lastClaimAt: "2026-10-07T00:00:01Z" }), false);
  assert.equal(collectorShouldClaim({ ...base, lastClaimAt: "2026-10-06T12:00:00Z" }), true);
});

test("the card counts what went in, what it is worth and the fees, each currency apart; unread positions apart", () => {
  const usdc = { mint: "Usdc1111111111111111111111111111111111111111", symbol: "USDC", decimals: 6, dollar: true };
  const card = holderEarningsCard({
    wallet: OTHER,
    network: "solana:devnet",
    now: "2026-10-07T12:00:00.000Z",
    receipts: ["sigB", "sigA"],
    rows: [
      { enteredAt: "2026-10-05T10:00:00.000Z", read: true, pair: usdc, enteredRaw: "5000000", valueRaw: "4800000", feesRaw: "120000", collectedRaw: "100000" },
      { enteredAt: "2026-10-06T10:00:00.000Z", read: true, pair: usdc, enteredRaw: "10000000", valueRaw: "10500000", feesRaw: "30000", collectedRaw: "0" },
      { enteredAt: "2026-10-04T10:00:00.000Z", read: false, pair: usdc, enteredRaw: "7000000", valueRaw: null, feesRaw: "0", collectedRaw: "0" },
    ],
  });
  assert.equal(card.kind, "holder-position");
  assert.equal(card.positions, 3);
  assert.equal(card.unread, 1);
  assert.equal(card.period.from, "2026-10-04T10:00:00.000Z");
  assert.deepEqual(card.amounts, [{ pairMint: usdc.mint, symbol: "USDC", decimals: 6, dollar: true, enteredRaw: "15000000", valueRaw: "15300000", feesRaw: "150000", collectedRaw: "100000" }]);
});
