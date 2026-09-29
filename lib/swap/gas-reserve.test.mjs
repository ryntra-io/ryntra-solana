import assert from "node:assert/strict";
import test from "node:test";

import {
  SOLANA_PRIORITY_HEADROOM_LAMPORTS,
  SOLANA_SIGNATURE_FEE_LAMPORTS,
  conservativeReserve,
  reconcileNativeCost,
  solanaPreFlightReserveLamports,
} from "./gas-reserve.ts";

/* ── Phase one: the guess made before any transaction exists ─────────────── */

test("the pre-flight reserve says what it is, and prices nothing itself", () => {
  /* Deliberately not computed here. One measured gas limit is true of one
     operation on one chain, and `price x limit` is not the maximum cost on an
     EIP-1559 chain or on a rollup that adds an L1 data fee. */
  const { reserveRaw, phase } = conservativeReserve(2_000_000_000_000_000n);
  assert.equal(reserveRaw, 2_000_000_000_000_000n);
  assert.equal(phase, "PRE_FLIGHT", "the name is the point: this is corrected later, not trusted");
});

test("Solana holds back the quoted rent AND a fee — the shortfall this closes", () => {
  /* Reserving rent alone left MAX short by exactly one signature fee, every
     time: the amount was balance minus rent, and the transaction still had a fee
     to pay out of lamports it no longer had. */
  const rent = "2039280";
  const { reserveLamports, basis } = solanaPreFlightReserveLamports(rent, 3_000_000n);
  assert.equal(basis, "QUOTED_RENT");
  assert.equal(reserveLamports, BigInt(rent) + SOLANA_SIGNATURE_FEE_LAMPORTS + SOLANA_PRIORITY_HEADROOM_LAMPORTS);
  assert.ok(reserveLamports > BigInt(rent), "rent alone is not signable");
});

test("Solana rent above the standing allowance is honoured rather than clamped", () => {
  /* Rent is not a cushion to trim — it is what the chain charges to open the
     account — so trimming it to a guessed figure would restore the shortfall. */
  const { reserveLamports } = solanaPreFlightReserveLamports("4000000", 3_000_000n);
  assert.ok(reserveLamports > 3_000_000n);
});

test("Solana without a usable quote keeps the standing allowance", () => {
  for (const quoted of [null, "", "1.5", "-3", "abc"]) {
    const { reserveLamports, basis } = solanaPreFlightReserveLamports(quoted, 3_000_000n);
    assert.equal(basis, "FALLBACK", `quoted ${JSON.stringify(quoted)}`);
    assert.equal(reserveLamports, 3_000_000n);
  }
});

/* ── Phase two: the real cost, once the transaction exists ───────────────── */

const ETH = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;

test("a native send that fits after the real cost is left alone", () => {
  const verdict = reconcileNativeCost({
    nativeBalanceRaw: ETH(1),
    intendedNativeSpendRaw: ETH(0.5),
    executionMaxCostRaw: ETH(0.0002),
  });
  assert.deepEqual(verdict, { ok: true, state: "FITS" });
});

test("a MAX whose pre-flight guess was too small is corrected once, not by the person", () => {
  /* The loop this removes: press Review, get refused, lower the amount, get
     refused, lower again. The product knows the number; it says it. */
  const balance = ETH(1);
  const cost = ETH(0.004);
  const verdict = reconcileNativeCost({
    nativeBalanceRaw: balance,
    /* MAX had left only the conservative 0.002 behind. */
    intendedNativeSpendRaw: balance - ETH(0.002),
    executionMaxCostRaw: cost,
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.state, "ADJUSTED");
  assert.equal(verdict.maximumRaw, balance - cost, "the new maximum is the balance less the real cost");
  assert.equal(verdict.reserveRaw, cost, "and the figure shown is that same real cost");
});

test("a wallet that cannot cover the fee at all is refused, with the figure", () => {
  const verdict = reconcileNativeCost({
    nativeBalanceRaw: ETH(0.001),
    intendedNativeSpendRaw: 0n,
    executionMaxCostRaw: ETH(0.004),
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.state, "NATIVE_SHORT");
  assert.equal(verdict.requiredRaw, ETH(0.004));
  assert.equal(verdict.shortfallRaw, ETH(0.003), "«not enough» without a figure is the sentence people bounce off");
});

test("an ERC-20 origin is not asked to pay gas out of the token", () => {
  /* The token balance is irrelevant here and deliberately absent from the input:
     what matters is whether the wallet holds enough of the coin the fee is paid
     in. Spending nothing native, with the fee covered, fits. */
  const fits = reconcileNativeCost({ nativeBalanceRaw: ETH(0.01), intendedNativeSpendRaw: 0n, executionMaxCostRaw: ETH(0.004) });
  assert.deepEqual(fits, { ok: true, state: "FITS" });

  /* And the same swap with an empty gas coin is refused rather than adjusted —
     lowering the token amount would never help. */
  const short = reconcileNativeCost({ nativeBalanceRaw: ETH(0.001), intendedNativeSpendRaw: 0n, executionMaxCostRaw: ETH(0.004) });
  assert.equal(short.ok, false);
  assert.equal(short.state, "NATIVE_SHORT");
});

test("no cost figure claims nothing in either direction", () => {
  /* A plan that states no maximum is not a plan that costs nothing. Refusing on
     it would block real swaps; adjusting on it would invent a number. */
  for (const executionMaxCostRaw of [null, -1n]) {
    const verdict = reconcileNativeCost({ nativeBalanceRaw: ETH(1), intendedNativeSpendRaw: ETH(1), executionMaxCostRaw });
    assert.deepEqual(verdict, { ok: true, state: "UNKNOWN" }, `cost ${executionMaxCostRaw}`);
  }
});

test("spending the entire balance with a real cost is always adjusted, never sent", () => {
  const balance = ETH(2);
  const verdict = reconcileNativeCost({ nativeBalanceRaw: balance, intendedNativeSpendRaw: balance, executionMaxCostRaw: 1n });
  assert.equal(verdict.state, "ADJUSTED");
  assert.equal(verdict.maximumRaw, balance - 1n, "one wei of cost is still a cost");
});
