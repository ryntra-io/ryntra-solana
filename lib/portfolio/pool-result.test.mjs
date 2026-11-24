// The honest result of a position in a pool of DLMM Pro, and the bonus a person's own limit orders brought: what went
// in, now, the fees, against simply holding — with the network's and the swap's fees counted; nothing guessed.
import assert from "node:assert/strict";
import test from "node:test";

import { isProLedger, ledgerAfter, ledgerOfOpen, myBonus, positionChanged, proResult, solUsd, solValue, swapFeeLamports, POOL_RESULT_STANDARD } from "./pool-result.ts";

/* SOL/USDC: SOL is X (9 places), USDC is Y (6 places); the price is USDC per SOL. */
const POOL = { solIsX: true, price: 180, x: { decimals: 9 }, y: { decimals: 6 } };
const OPEN = {
  action: "open",
  goesIn: { xRaw: "500000000", yRaw: "100000000", lamports: "1000000000" },
  swap: { lamports: "500000000", feeBps: 4 },
  networkLamports: 10_000,
  depositLamports: 57_000_000,
  nftMint: "Nft1111111111111111111111111111111111111111",
};
const AT = Date.parse("2026-11-18T10:00:00Z");
const position = (over = {}) => ({ worth: { xRaw: "560000000", yRaw: "86000000", lamports: "1040000000" }, fees: { xRaw: "0", yRaw: "540000", lamports: "3000000" }, rewards: [], ...over });

test("an opening that landed is an entry: what went in, the network's fee and the swap's pool fee, the deposit apart", () => {
  const ledger = ledgerOfOpen(OPEN, "Pool111111111111111111111111111111111111111", AT);
  assert.ok(ledger && isProLedger(ledger));
  assert.equal(ledger.in.lamports, "1000000000");
  // 0.5 SOL swapped at 4 bps: 200 000 lamports; with the network's 10 000.
  assert.equal(ledger.costsLamports, "210000");
  assert.equal(ledger.rentLamports, "57000000");
  assert.equal(isProLedger(JSON.parse(JSON.stringify(ledger))), true, "an entry survives the device's storage");
  assert.equal(isProLedger({ ...ledger, costsLamports: "-1" }), false);
  assert.equal(ledgerOfOpen({ ...OPEN, goesIn: { ...OPEN.goesIn, lamports: "0" } }, "P", AT), null, "nothing went in — no entry");
});

test("a swap's fee is rounded up, fractional basis points included; no fee, no cost", () => {
  assert.equal(swapFeeLamports({ lamports: "1000000000", feeBps: 2.5 }), 250_000n);
  assert.equal(swapFeeLamports({ lamports: "3", feeBps: 1 }), 1n);
  assert.equal(swapFeeLamports({ lamports: "1000000000", feeBps: 0 }), 0n);
  assert.equal(swapFeeLamports({ lamports: "x", feeBps: 4 }), 0n);
});

test("each action after the opening: fees taken and put back are counted once, every network fee is a cost; leaving ends the entry", () => {
  let ledger = ledgerOfOpen(OPEN, "P", AT);
  ledger = ledgerAfter(ledger, { action: "collect", fees: { xRaw: "0", yRaw: "360000", lamports: "2000000" }, networkLamports: 5_000 }, true);
  ledger = ledgerAfter(ledger, { action: "compound", collected: { xRaw: "0", yRaw: "180000", lamports: "1000000" }, networkLamports: 5_000 }, true);
  ledger = ledgerAfter(ledger, { action: "care_on", networkLamports: 5_000 }, true);
  assert.equal(ledger.collectedLamports, "2000000");
  assert.equal(ledger.addedLamports, "1000000");
  assert.equal(ledger.costsLamports, String(210_000 + 15_000));
  assert.equal(ledgerAfter(ledger, { action: "collect", fees: null, networkLamports: 5_000 }, true).collectedLamports, "2000000", "a collect of nothing adds nothing");
  assert.equal(ledgerAfter(ledger, { action: "leave", networkLamports: 5_000 }, true), null);
  assert.equal(ledgerAfter(ledger, { action: "close", networkLamports: 5_000 }, true), null);
  assert.equal(ledgerAfter(ledger, { action: "collect", fees: null, networkLamports: 5_000 }, false).lost, true, "an action that landed in part: what it did is not known");
});

test("the result against holding: the price's move, the fees, the costs — and they add up to the whole", () => {
  let ledger = ledgerOfOpen(OPEN, "P", AT);
  ledger = ledgerAfter(ledger, { action: "collect", fees: { xRaw: "0", yRaw: "360000", lamports: "2000000" }, networkLamports: 5_000 }, true);
  ledger = ledgerAfter(ledger, { action: "compound", collected: { xRaw: "0", yRaw: "180000", lamports: "1000000" }, networkLamports: 5_000 }, true);
  const result = proResult(ledger, position(), POOL);
  assert.equal(result.standard, POOL_RESULT_STANDARD);
  assert.equal(result.unknown, null);
  assert.equal(result.invested, 1);
  assert.equal(result.now, 1.04);
  // Holding: 0.5 SOL and 100 USDC at 180 USDC a SOL.
  assert.ok(Math.abs(result.hold - (0.5 + 100 / 180)) < 1e-12);
  // Fees: 0.003 still in, 0.002 taken, 0.001 put back.
  assert.ok(Math.abs(result.fees - 0.006) < 1e-12);
  assert.ok(Math.abs(result.costs - 0.00022) < 1e-12);
  // The price's move leaves out the fees put back: they are counted once, with the fees.
  assert.ok(Math.abs(result.price - (1.04 - 0.001 - result.hold)) < 1e-12);
  assert.ok(Math.abs(result.net - (result.price + result.fees - result.costs)) < 1e-12);
  assert.ok(result.net < 0, "a fall the fees did not cover is said as a loss");
  assert.ok(Math.abs(result.netPct - result.net * 100) < 1e-9);
  assert.equal(result.since, AT);
  assert.equal(result.rent, 0.057);
});

test("what is not known stays unknown — no entry, a changed position, a part landed, no price — and never reads as a zero", () => {
  const ledger = ledgerOfOpen(OPEN, "P", AT);
  const none = proResult(null, position(), POOL);
  assert.equal(none.unknown, "entry");
  assert.equal(none.net, null);
  assert.equal(none.fees, null);
  assert.equal(none.invested, null);
  assert.equal(none.now, 1.04, "what the chain says now is still said");
  const changed = proResult(ledger, position({ worth: { xRaw: "100000000", yRaw: "10000000", lamports: "150000000" } }), POOL);
  assert.equal(changed.unknown, "changed");
  assert.equal(changed.net, null);
  assert.equal(proResult({ ...ledger, lost: true }, position(), POOL).unknown, "lost");
  assert.equal(proResult(ledger, position(), { ...POOL, price: 0 }).unknown, "price");
  assert.equal(positionChanged(ledger.in, { xRaw: "700000000", yRaw: "0" }), false, "a move trades one coin for the other — not a change");
});

test("a pool's own reward is left out and said so; dollars only at a SOL price", () => {
  const ledger = ledgerOfOpen(OPEN, "P", AT);
  assert.equal(proResult(ledger, position({ rewards: [{ accruedRaw: "5", symbol: "MET" }] }), POOL).rewardsLeftOut, true);
  assert.equal(proResult(ledger, position(), POOL).rewardsLeftOut, false);
  assert.equal(solUsd(2, 150), 300);
  assert.equal(solUsd(null, 150), null);
  assert.equal(solUsd(2, null), null);
});

test("a pool where SOL is Y: holding values X at the price", () => {
  const pool = { solIsX: false, price: 0.01, x: { decimals: 6 }, y: { decimals: 9 } };
  assert.ok(Math.abs(solValue(pool, "1000000", "500000000") - (1 * 0.01 + 0.5)) < 1e-12);
});

test("a person's bonus: only their own orders that filled, each coin at its price; a coin without a price leaves dollars unknown", () => {
  const pair = { x: { decimals: 6, usd: 2 }, y: { decimals: 6, usd: 1 } };
  const fills = [
    { owner: "Me", at: "2026-11-19T12:00:00.000Z", bonusXRaw: "0", bonusYRaw: "3448943", state: "filled" },
    { owner: "Me", at: "2026-11-19T10:00:00.000Z", bonusXRaw: "500000", bonusYRaw: "0", state: "partial" },
    { owner: "Other", at: "2026-11-19T11:00:00.000Z", bonusXRaw: "0", bonusYRaw: "9000000", state: "filled" },
    { owner: "Me", at: "2026-11-19T09:00:00.000Z", bonusXRaw: "0", bonusYRaw: "1", state: "unfilled" },
  ];
  const mine = myBonus(fills, "Me", pair);
  assert.equal(mine.count, 2);
  assert.equal(mine.yRaw, "3448943");
  assert.equal(mine.xRaw, "500000");
  assert.ok(Math.abs(mine.usd - (3.448943 + 1)) < 1e-9);
  assert.equal(mine.from, "2026-11-19T10:00:00.000Z");
  assert.equal(myBonus(fills, "Me", { ...pair, x: { decimals: 6, usd: null } }).usd, null);
  const nobody = myBonus(fills, "Nobody", pair);
  assert.equal(nobody.count, 0);
  assert.equal(nobody.usd, 0);
  assert.equal(nobody.from, null);
});
