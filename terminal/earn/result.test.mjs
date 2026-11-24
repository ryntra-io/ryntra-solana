// «My positions» and a DLMM Pro position's ticket: what went in, now, the fees, the result against holding — from the
// entry this device kept when the position opened here; without one the result is unknown and said in one line. And
// Meteora's Wave as a goal of the ticket and the shape «Start from».
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ledgerOfOpen } from "../../lib/portfolio/pool-result.ts";
import { proPositionRow, positionRows } from "./rows.ts";
import { shapeAt } from "./range/model.ts";
import { EARN } from "./words.ts";
import { RANGE } from "./range/words.ts";

const PIER = {
  address: "Pier1111111111111111111111111111111111111111",
  x: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9 },
  y: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6 },
  solIsX: true,
  price: 180,
  feeBps: 4,
  tickSpacing: 1,
  tickId: 0,
  depthLamports: null,
  rewards: [],
  takesDeposits: true,
};
const BOAT = {
  nftMint: "Nft1111111111111111111111111111111111111111",
  pool: PIER.address,
  inRange: true,
  ranges: 9,
  lowerPrice: 170,
  upperPrice: 190,
  worth: { xRaw: "560000000", yRaw: "86000000", lamports: "1040000000" },
  fees: { xRaw: "0", yRaw: "540000", lamports: "3000000" },
  rewards: [],
  empty: false,
  cared: false,
  care: null,
};
const OPEN = { action: "open", goesIn: { xRaw: "500000000", yRaw: "100000000", lamports: "1000000000" }, swap: { lamports: "500000000", feeBps: 4 }, networkLamports: 10_000, depositLamports: 57_000_000, nftMint: BOAT.nftMint };

test("a Pro position opened here: what went in, every fee it earned, and the result against holding — in dollars at SOL's price", () => {
  const ledger = ledgerOfOpen(OPEN, PIER.address, Date.parse("2026-11-18T10:00:00Z"));
  const row = proPositionRow(BOAT, PIER, 150, ledger);
  assert.equal(row.investedUsd, 150);
  assert.ok(Math.abs(row.nowUsd - 156) < 1e-9);
  assert.ok(Math.abs(row.earnedUsd - 0.45) < 1e-9);
  // 1.04 − (0.5 + 100/180) + 0.003 − 0.00021 SOL, at $150.
  assert.ok(Math.abs(row.vsHoldUsd - (1.04 - (0.5 + 100 / 180) + 0.003 - 0.00021) * 150) < 1e-9);
  assert.equal(row.result.unknown, null);
});

test("a Pro position opened elsewhere: what went in and the result are unknown — never a zero; what it holds now is said", () => {
  const row = proPositionRow(BOAT, PIER, 150, null);
  assert.equal(row.investedUsd, null);
  assert.equal(row.vsHoldUsd, null);
  assert.equal(row.result.unknown, "entry");
  assert.ok(Math.abs(row.earnedUsd - 0.45) < 1e-9, "the fees it holds to take now");
  const rows = positionRows({ views: [], entries: new Map(), staked: [], lent: [], markets: {}, proBoats: [BOAT], proPiers: [PIER], solPriceUsd: 150, ledgers: new Map([[BOAT.nftMint, ledgerOfOpen(OPEN, PIER.address, 1)]]) });
  assert.equal(rows[0].investedUsd, 150, "the table finds the entry by the position's NFT");
});

test("the words of the result: no technical word, no promise of a profit, the same keys in both languages", () => {
  const keys = ["vsHold", "vsHoldTitle", "vsHoldWhy", "resultEntry", "resultChanged", "resultLost", "resultPrice", "priceMove", "feesAll", "costs", "resultNet", "rewardsOut"];
  for (const lang of ["en", "uk"]) {
    for (const key of keys) {
      const said = EARN[lang][key];
      assert.equal(typeof said, "string", `${lang}.${key}`);
      assert.doesNotMatch(said, /impermanent|\bIL\b|\bbin\b|\btick\b|api|engine|guarantee|profit|прибутков|гарант|двигун/i, `${lang}.${key}: «${said}»`);
    }
    assert.match(EARN[lang].since("18 Nov"), /18 Nov/);
  }
});

test("Meteora's Wave: a goal of the DLMM Pro ticket, drawn even by the price and rising to twice that at the edges", () => {
  assert.equal(shapeAt("wave", 0, 10), 0.5);
  assert.equal(shapeAt("wave", 5, 10), 0.5);
  assert.equal(shapeAt("wave", 10, 10), 1);
  assert.equal(shapeAt("wave", 11, 10), 0);
  assert.deepEqual([EARN.en.goalWave, EARN.uk.goalWave, RANGE.en.wave, RANGE.uk.wave], ["Wave", "Хвиля", "Wave", "Хвиля"]);
  const ticket = readFileSync(new URL("./ProTicket.tsx", import.meta.url), "utf8");
  assert.match(ticket, /PRO_GOAL_SHAPE: Readonly<Record<ProGoal, ShapeId>> = \{ \.\.\.GOAL_SHAPE, wave: 'wave' \}/);
  const store = readFileSync(new URL("../../city/lib/earn/pro-store.ts", import.meta.url), "utf8");
  assert.match(store, /const goal = proGoalOf\(st\.pier, st\.goal\)/, "the store asks the goal in force — Wave included");
  const pro = readFileSync(new URL("../../city/lib/earn/pro.ts", import.meta.url), "utf8");
  assert.match(pro, /export const PRO_GOALS = \[\.\.\.PIER_GOALS, 'wave'\] as const;/, "classic DLMM keeps its three");
});
