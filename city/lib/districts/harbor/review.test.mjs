import { test } from "node:test";
import assert from "node:assert/strict";

import { harborPools } from "./pools.ts";
import { harborMints, harborPosition, harborPositions, rangeLine, towerMintOf } from "./positions.ts";
import { failureWords, reviewFigures } from "./review.ts";
import { addReview, CATALOG, OWNER, positionView, USDC, WSOL } from "./test-fixtures.mjs";

const [SOL_USDC] = harborPools(CATALOG);
const SYMBOLS = { x: "SOL", y: "USDC" };

test("an add's figures are the Review's own: what goes in, new accounts, the network, the one notice", () => {
  const f = reviewFigures(addReview(), SYMBOLS, SOL_USDC);
  assert.deepEqual(f.amounts, ["0.242 SOL", "25 USDC"]);
  assert.equal(f.rentSol, "0.128");
  // The bin arrays are the pool's: their rent does not come back, so "back on exit" is not said.
  assert.equal(f.rentBack, false);
  assert.equal(f.networkSol, "0.00001");
  assert.equal(f.transactions, 1);
  assert.equal(f.note, "The pool takes the two coins in its own ratio: the rest stays in your wallet.");
  const value = 0.242 * SOL_USDC.x.priceUsd + 25.00465 * SOL_USDC.y.priceUsd;
  assert.ok(Math.abs(f.valueUsd - value) < 1e-9);
});

test("rent that all comes back is said to come back; a Review without notices says nothing", () => {
  const review = addReview();
  review.preview.rent = [{ what: "position", direction: "pay", lamports: "57000000", refundable: true }];
  review.preview.notices = [];
  const f = reviewFigures(review, SYMBOLS, null);
  assert.equal(f.rentBack, true);
  assert.equal(f.note, null);
  assert.equal(f.valueUsd, null);
});

test("an out-of-range notice comes before the rest", () => {
  const review = addReview();
  review.preview.notices = ["transfer_fee", "out_of_range"];
  assert.match(reviewFigures(review, SYMBOLS, null).note, /outside this range/);
});

test("an exit says what comes back, the fees with it, and the rent it returns", () => {
  const review = addReview();
  review.preview = {
    ...review.preview,
    action: "remove",
    expected: { x: { units: "240000000", decimals: 9 }, y: { units: "0", decimals: 6 } },
    feesClaimed: { x: { units: "0", decimals: 9 }, y: { units: "310000", decimals: 6 } },
    closesPosition: true,
    rent: [{ what: "position", direction: "return", lamports: "57000000", refundable: true }],
    notices: [],
  };
  const f = reviewFigures(review, SYMBOLS, null);
  assert.deepEqual(f.amounts, ["0.24 SOL", "fees 0.31 USDC"]);
  assert.equal(f.rentReturnedSol, "0.057");
  assert.equal(f.rentSol, null);
});

test("a claim says the fees it takes", () => {
  const review = addReview();
  review.preview = { ...review.preview, action: "claim", claimed: { x: { units: "2100000", decimals: 9 }, y: { units: "310000", decimals: 6 } }, rent: [], notices: [] };
  assert.deepEqual(reviewFigures(review, SYMBOLS, null).amounts, ["0.0021 SOL", "0.31 USDC"]);
});

test("the engine's refusals are said plainly, and an unknown one says nothing was sent", () => {
  assert.match(failureWords("ACTIONS_CLOSED"), /live check/);
  assert.match(failureWords("SIMULATION_FAILED"), /not enough SOL/);
  assert.equal(failureWords("SOMETHING_NEW"), "That did not work. Nothing was sent.");
});

test("a position says what it earned and whether it is in range", () => {
  const p = harborPosition(positionView());
  assert.equal(p.inRange, true);
  assert.equal(p.earned, "0.0021 SOL + 0.31 USDC");
  assert.equal(p.earnedUsd, 0.53);
  assert.equal(p.venue, "meteora-dlmm");
  assert.equal(p.venueName, "DLMM");
  assert.equal(rangeLine(p), "In range · earning");
  assert.equal(rangeLine(harborPosition(positionView({ rangeState: "above" }))), "Out of range · price fell below it");
  assert.equal(rangeLine(harborPosition(positionView({ rangeState: "below" }))), "Out of range · price rose above it");
  assert.equal(harborPosition(positionView({ x: { ...positionView().x, unclaimed: 0 }, y: { ...positionView().y, unclaimed: 0 } })).earned, null);
});

test("a position lights its coin's tower; a dollar never stands for the tower", () => {
  assert.equal(towerMintOf({ x: { mint: WSOL }, y: { mint: USDC } }), WSOL);
  assert.equal(towerMintOf({ x: { mint: USDC }, y: { mint: WSOL } }), WSOL);
  const answer = { owner: OWNER, positions: [positionView(), positionView({ address: "other", kind: "damm-v2" })], venues: {}, at: 1 };
  const rows = harborPositions(answer, OWNER);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].venue, "meteora-damm2");
  assert.deepEqual([...harborMints(rows)], [WSOL]);
  // Another wallet's answer is no answer for this one.
  assert.equal(harborPositions(answer, "someone-else"), null);
  assert.equal(harborPositions(null, OWNER), null);
  assert.equal(harborMints(null).size, 0);
});
