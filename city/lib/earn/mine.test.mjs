import { test } from "node:test";
import assert from "node:assert/strict";

import { LSTS } from "./lst.ts";
import { headline, lstBalances, lstHolding, pierRow, readLots } from "./mine.ts";

const JUPSOL = LSTS[0];
const feed = {
  at: "2026-10-29T10:00:00.000Z",
  epochsPerYear: 182.6,
  lsts: LSTS.map((l) => ({ id: l.id, rate: l.id === "jupsol" ? { lamports: "1100000000", supply: "1000000000" } : null, apyPct: null, rewardsFeePct: null, unstakeFeePct: null, source: null, epoch: null })),
};
const lot = (lstRaw, lamports, at, signature) => ({ mint: JUPSOL.mint, lstRaw: String(lstRaw), lamports: String(lamports), at, signature });

test("an LST balance is valued in SOL, and the lots kept on the device say what it earned", () => {
  // Paid 1 SOL for 0.9 JupSOL; 1 JupSOL is worth 1.1 SOL now → 0.99 SOL, 0.01 SOL lost on the way in so far.
  const held = lstHolding("jupsol", 900_000_000n, feed, [lot(900_000_000n, 1_000_000_000n, 1, "a")]);
  assert.equal(held.lamports, 990_000_000n);
  assert.deepEqual(held.tracked, { paid: 1_000_000_000n, worth: 990_000_000n });
  const head = headline([held], []);
  assert.equal(head.earned, -10_000_000n, "a loss is said as a loss");
  assert.equal(head.vsHold, -10_000_000n);
  assert.equal(head.unmeasured, 0);
});

test("a balance that shrank keeps the newest lots it still covers, pro rata within a lot", () => {
  const lots = [lot(500_000_000n, 500_000_000n, 1, "old"), lot(500_000_000n, 520_000_000n, 2, "new")];
  const held = lstHolding("jupsol", 750_000_000n, feed, lots);
  // The newest 0.5 whole (0.52 SOL) and half the oldest (0.25 SOL).
  assert.equal(held.tracked.paid, 770_000_000n);
  assert.equal(held.tracked.worth, 825_000_000n);
});

test("coins from elsewhere have no cost here: counted as not measured, never guessed", () => {
  const bigger = lstHolding("jupsol", 2_000_000_000n, feed, [lot(1_000_000_000n, 1_050_000_000n, 1, "a")]);
  const head = headline([bigger], []);
  assert.equal(head.earned, 50_000_000n);
  assert.equal(head.unmeasured, 1);
  const none = lstHolding("jupsol", 2_000_000_000n, feed, []);
  assert.equal(none.tracked, null);
  assert.deepEqual(headline([none], []), { earned: null, vsHold: null, unmeasured: 1 });
  const unread = lstHolding("inf", 2_000_000_000n, feed, []);
  assert.equal(unread.lamports, null, "an LST whose worth was not read has no SOL value");
});

const view = (over = {}) => ({
  kind: "dlmm",
  address: "Pos1111111111111111111111111111111111111111",
  pool: "Pool111111111111111111111111111111111111111",
  name: "JitoSOL-SOL",
  x: { mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", symbol: "JitoSOL", amount: 1, unclaimed: 0, priceUsd: 220 },
  y: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", amount: 1, unclaimed: 0, priceUsd: 200 },
  rangeState: "in_range",
  lower: 1,
  upper: 1.2,
  price: 1.1,
  valueUsd: 420,
  unclaimedUsd: 4,
  lockedBps: 0,
  feesElsewhere: false,
  hasRewards: false,
  slot: 1,
  at: 1,
  pricesAt: null,
  ...over,
});

test("a pier's fees and its SOL-2b result against holding come to SOL at today's price", () => {
  const entry = { x: 1, y: 1.1, usd: 420, claimedUsd: 2, at: 1, source: "ryntra" };
  const row = pierRow(view(), entry, 200);
  // hold = 1×220 + 1.1×200 = 440; value 420; fees 4 + 2 = 6; net −14 USD = −0.07 SOL.
  assert.equal(row.status, "in-range");
  assert.equal(row.feesLamports, 30_000_000n);
  assert.equal(row.vsHoldLamports, -70_000_000n);
  // CITY-243: its range goes with it — two positions of one pair are told apart by it in «Mine».
  assert.deepEqual([row.lower, row.upper], [view().lower, view().upper]);
  const out = pierRow(view({ rangeState: "above" }), null, 200);
  assert.equal(out.status, "out-of-range");
  assert.equal(out.vsHoldLamports, null, "no entry, no result");
  assert.equal(out.feesLamports, 20_000_000n, "the unclaimed fees still count as earned");
  assert.equal(pierRow(view(), entry, null).feesLamports, null, "no SOL price, no SOL figure");
  const head = headline([], [row, out]);
  assert.equal(head.earned, 50_000_000n);
  assert.equal(head.vsHold, -70_000_000n);
  assert.equal(head.unmeasured, 1);
});

test("lots are read field by field and once per signature", () => {
  const good = lot(1n, 2n, 3, "sig");
  assert.deepEqual(readLots([good, good, { ...good, signature: "x", mint: "So11111111111111111111111111111111111111112" }, { ...good, signature: "y", lstRaw: "-1" }, null]), [good]);
  assert.deepEqual(readLots("nope"), []);
});

test("the wallet's LSTs are picked out of its coins by mint", () => {
  const balances = lstBalances([
    { mint: null, amountRaw: "5" },
    { mint: JUPSOL.mint, amountRaw: "42" },
    { mint: LSTS[2].mint, amountRaw: "0" },
    { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountRaw: "9" },
  ]);
  assert.deepEqual([...balances], [["jupsol", 42n]]);
});
