// Run from repo root: node --test lib/core/launch/distribution-audience.test.mjs
//
// Two things are being held to account here. The snapshot: the same slot and the
// same rules have to give the same digest, and a different list has to give a
// different one, or a published root proves nothing. And the anti-Sybil line:
// the protection rules of the Ryntra Network decide what a shared source means
// and this module must not restate them — so the judge is passed in, and the
// tests use protection's own `needsReview` and `trustScore` rather than copies.
import assert from "node:assert/strict";
import test from "node:test";

import { Keypair } from "@solana/web3.js";

import { needsReview, trustScore } from "../../growth/protect.ts";
import {
  DEFAULT_ELIGIBILITY,
  calculationProblems,
  distributionAllocations,
  eligibilityRows,
  eligibilityTotals,
  snapshotDigest,
  snapshotText,
} from "./distribution-audience.ts";

const judge = { needsReview, trustScore };
const wallets = Array.from({ length: 6 }, () => Keypair.generate().publicKey.toBase58());
const MINT = Keypair.generate().publicKey.toBase58();

const spec = (over = {}) => ({ mint: MINT, slot: 400_000_000, finality: "finalized", takenAt: 1_800_000_000, exclusions: ["creator", "program", "ryntra"], ...over });

const candidate = (wallet, over = {}) => ({
  wallet,
  holdingRaw: "1000",
  boughtRaw: "1000",
  heldSinceSlot: 399_000_000,
  fundingHashes: [],
  deviceHashes: [],
  signals: [],
  kyc: null,
  excluded: null,
  ...over,
});

const rules = (over = {}) => ({ ...DEFAULT_ELIGIBILITY, ...over });
const allocation = (over = {}) => ({ mode: "proRata", potRaw: "1000", capPerWalletRaw: null, floorPerWalletRaw: "1", maxWallets: 100, tiers: [], ...over });

/* ---------------------------------------------- the snapshot */

test("a snapshot's digest is the slot, the rules and the rows — and nothing about the order they were read in", async () => {
  const rows = [
    { wallet: wallets[1], holdingRaw: "20" },
    { wallet: wallets[0], holdingRaw: "10" },
  ];
  const same = await snapshotDigest(spec(), rows);
  assert.equal(await snapshotDigest(spec(), [...rows].reverse()), same, "the read's order is not a fact about the snapshot");
  assert.equal(await snapshotDigest(spec({ exclusions: ["program", "ryntra", "creator"] }), rows), same, "nor is the order of the exclusions");
  assert.match(same, /^[0-9a-f]{64}$/);

  /* Everything that would change the answer changes the digest. */
  assert.notEqual(await snapshotDigest(spec({ slot: 400_000_001 }), rows), same);
  assert.notEqual(await snapshotDigest(spec({ finality: "confirmed" }), rows), same);
  assert.notEqual(await snapshotDigest(spec({ exclusions: ["program"] }), rows), same);
  assert.notEqual(await snapshotDigest(spec(), [{ wallet: wallets[0], holdingRaw: "11" }, rows[0]]), same);
  assert.notEqual(await snapshotDigest(spec(), rows.slice(1)), same);
  /* One amount, one spelling: a leading zero is not a second snapshot. */
  assert.equal(snapshotText(spec(), [{ wallet: wallets[0], holdingRaw: "010" }]), snapshotText(spec(), [{ wallet: wallets[0], holdingRaw: "10" }]));
});

/* ---------------------------------------------- the right to take part */

test("the campaign's own published rules exclude; protection's signals only open a case", () => {
  const rows = eligibilityRows(
    [
      candidate(wallets[0]),
      candidate(wallets[1], { excluded: "creator" }),
      candidate(wallets[2], { holdingRaw: "5", boughtRaw: "5" }),
      candidate(wallets[3], { holdingRaw: "1000", boughtRaw: "0" }),
      candidate(wallets[4], { signals: ["S1_SHARED_FUNDING"] }),
      candidate(wallets[5], { signals: ["S5_YOUNG_WALLETS"] }),
    ],
    rules({ minHoldingRaw: "100" }),
    judge,
  );
  const by = (wallet) => rows.find((row) => row.wallet === wallet);
  assert.equal(by(wallets[0]).verdict, "ELIGIBLE");
  assert.deepEqual(by(wallets[1]).reasons, ["EXCLUDED_WALLET"]);
  assert.equal(by(wallets[1]).verdict, "EXCLUDED");
  assert.deepEqual(by(wallets[2]).reasons, ["BELOW_MIN"]);
  assert.deepEqual(by(wallets[3]).reasons, ["NOT_BOUGHT"], "tokens that only arrived by a transfer earn nothing");

  /* A hard signal opens a case: the row waits for a person and can be argued, and no money is taken away. */
  assert.equal(by(wallets[4]).verdict, "REVIEW");
  assert.deepEqual(by(wallets[4]).reasons, ["UNDER_REVIEW"]);
  assert.equal(by(wallets[4]).appealable, true);
  assert.equal(by(wallets[4]).trust, trustScore(["S1_SHARED_FUNDING"]));
  /* One soft signal is not a case, by protection's own rule — so the row is simply paid. */
  assert.equal(by(wallets[5]).verdict, needsReview(["S5_YOUNG_WALLETS"]) ? "REVIEW" : "ELIGIBLE");
  assert.equal(by(wallets[5]).verdict, "ELIGIBLE");
  /* And an excluded row is never appealable: a reader saw that rule before the campaign was funded. */
  assert.equal(by(wallets[1]).appealable, false);
});

test("the row that lost its own rule never takes a cluster's place from the row that could be paid", () => {
  /* Two wallets on one funding source. The larger one is excluded by the campaign's minimum, so the place is the
     smaller one's — otherwise a rule meant to stop one person taking twice would stop everybody taking once. */
  const rows = eligibilityRows(
    [
      candidate(wallets[0], { holdingRaw: "5000", boughtRaw: "0", fundingHashes: ["h1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] }),
      candidate(wallets[1], { holdingRaw: "100", boughtRaw: "100", fundingHashes: ["h1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] }),
    ],
    rules(),
    judge,
  );
  assert.equal(rows[0].verdict, "EXCLUDED");
  assert.equal(rows[1].verdict, "ELIGIBLE");
});

test("one wallet of a cluster is paid, the larger one, and the rest wait for a person", () => {
  const funded = ["h1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"];
  const rows = eligibilityRows(
    [
      candidate(wallets[0], { holdingRaw: "100", boughtRaw: "100", fundingHashes: funded }),
      candidate(wallets[1], { holdingRaw: "900", boughtRaw: "900", fundingHashes: funded }),
      candidate(wallets[2], { holdingRaw: "300", boughtRaw: "300", deviceHashes: ["h1:cccccccccccccccccccccccccccccccc"] }),
      candidate(wallets[3], { holdingRaw: "200", boughtRaw: "200", deviceHashes: ["h1:cccccccccccccccccccccccccccccccc"] }),
    ],
    rules(),
    judge,
  );
  const by = (wallet) => rows.find((row) => row.wallet === wallet);
  assert.equal(by(wallets[1]).verdict, "ELIGIBLE", "the largest of a funding cluster");
  assert.deepEqual(by(wallets[0]).reasons, ["CLUSTER_CAPPED"]);
  assert.equal(by(wallets[0]).verdict, "REVIEW");
  assert.equal(by(wallets[0]).appealable, true, "a cluster is a suspicion, not a verdict");
  assert.equal(by(wallets[2]).verdict, "ELIGIBLE", "the largest of a device cluster");
  assert.deepEqual(by(wallets[3]).reasons, ["CLUSTER_CAPPED"]);

  /* Two places per cluster pays both; and a campaign that does not ask pays everyone. */
  const two = eligibilityRows(
    [candidate(wallets[0], { fundingHashes: funded }), candidate(wallets[1], { fundingHashes: funded })],
    rules({ maxPerCluster: 2 }),
    judge,
  );
  assert.deepEqual(two.map((row) => row.verdict), ["ELIGIBLE", "ELIGIBLE"]);
  const none = eligibilityRows(
    [candidate(wallets[0], { fundingHashes: funded }), candidate(wallets[1], { fundingHashes: funded })],
    rules({ oneWalletPerFundingSource: false }),
    judge,
  );
  assert.deepEqual(none.map((row) => row.verdict), ["ELIGIBLE", "ELIGIBLE"]);
});

test("an identity check, a holding age and a trust floor each have their own answer", () => {
  const asked = eligibilityRows([candidate(wallets[0], { kyc: null }), candidate(wallets[1], { kyc: true })], rules({ kyc: true }), judge);
  assert.deepEqual(asked[0].reasons, ["KYC_MISSING"]);
  assert.equal(asked[1].verdict, "ELIGIBLE");

  const young = eligibilityRows([candidate(wallets[0], { heldSinceSlot: 399_999_999 }), candidate(wallets[1], { heldSinceSlot: null })], rules({ heldSinceSlot: 399_000_000 }), judge);
  assert.deepEqual(young[0].reasons, ["HELD_TOO_SHORT"]);
  assert.deepEqual(young[1].reasons, ["HELD_TOO_SHORT"], "a holding age that was not read is not a holding age");

  const low = eligibilityRows([candidate(wallets[0], { signals: ["S6_ROUND_TRIP"] })], rules({ minTrust: 90 }), judge);
  assert.deepEqual(low[0].reasons, ["LOW_TRUST"]);
  assert.equal(low[0].verdict, "REVIEW");
});

test("the totals say what is held back while people are looked at", () => {
  const rows = eligibilityRows(
    [candidate(wallets[0]), candidate(wallets[1], { signals: ["S2_DIRECT_FUNDS"] }), candidate(wallets[2], { excluded: "ryntra" })],
    rules(),
    judge,
  );
  assert.deepEqual(eligibilityTotals(rows), { eligible: 1, review: 1, excluded: 1, eligibleBasisRaw: "1000", reviewBasisRaw: "1000" });
});

/* ---------------------------------------------- the money */

test("a pot divides to the last unit, and the odd units go by the largest remainder", () => {
  const rows = [
    { wallet: wallets[0], basisRaw: "1" },
    { wallet: wallets[1], basisRaw: "1" },
    { wallet: wallets[2], basisRaw: "1" },
  ];
  const out = distributionAllocations(rows, allocation({ potRaw: "10" }));
  assert.equal(out.totalRaw, "10", "the rows add up to the pot itself");
  assert.deepEqual(out.rows.map((row) => row.amountRaw), ["4", "3", "3"]);
  assert.equal(out.leftoverRaw, "0");

  const even = distributionAllocations(rows, allocation({ mode: "equal", potRaw: "9" }));
  assert.deepEqual(even.rows.map((row) => row.amountRaw), ["3", "3", "3"]);

  const proRata = distributionAllocations(
    [
      { wallet: wallets[0], basisRaw: "750" },
      { wallet: wallets[1], basisRaw: "250" },
    ],
    allocation({ potRaw: "1000" }),
  );
  assert.deepEqual(proRata.rows.map((row) => row.amountRaw), ["750", "250"]);
});

test("a cap holds a wallet down and a floor drops one out; what either leaves is leftover, not a rebate", () => {
  const rows = [
    { wallet: wallets[0], basisRaw: "900" },
    { wallet: wallets[1], basisRaw: "100" },
  ];
  const capped = distributionAllocations(rows, allocation({ potRaw: "1000", capPerWalletRaw: "500" }));
  assert.deepEqual(capped.rows.map((row) => row.amountRaw), ["500", "100"]);
  assert.equal(capped.totalRaw, "600");
  assert.equal(capped.leftoverRaw, "400", "the cap a reader saw is not spread over the others");

  const floored = distributionAllocations(rows, allocation({ potRaw: "1000", floorPerWalletRaw: "200" }));
  assert.deepEqual(floored.rows.map((row) => row.wallet), [wallets[0]]);
  assert.equal(floored.belowFloor, 1);
  assert.equal(floored.leftoverRaw, "100");
});

test("a tiered campaign pays by band, and a wallet under every band is paid nothing", () => {
  const out = distributionAllocations(
    [
      { wallet: wallets[0], basisRaw: "10000" },
      { wallet: wallets[1], basisRaw: "1000" },
      { wallet: wallets[2], basisRaw: "10" },
    ],
    allocation({ mode: "tiered", potRaw: "400", tiers: [{ fromRaw: "1000", weight: 1 }, { fromRaw: "5000", weight: 3 }] }),
  );
  assert.deepEqual(out.rows.map((row) => row.amountRaw), ["300", "100"]);
  assert.equal(out.rows.length, 2, "a wallet below every band has no weight");
});

test("an empty pot and an empty list are answers, not a division by zero", () => {
  const nothing = distributionAllocations([], allocation({ potRaw: "1000" }));
  assert.deepEqual(nothing.rows, []);
  assert.equal(nothing.leftoverRaw, "1000");
  const empty = distributionAllocations([{ wallet: wallets[0], basisRaw: "1" }], allocation({ potRaw: "0" }));
  assert.equal(empty.totalRaw, "0");
  assert.equal(empty.leftoverRaw, "0");
});

test("the arithmetic says what breaks before it is run", () => {
  assert.deepEqual(calculationProblems(allocation(), 3), []);
  assert.deepEqual(calculationProblems(allocation({ potRaw: "0" }), 3), ["POT_EMPTY"]);
  assert.deepEqual(calculationProblems(allocation({ potRaw: "007" }), 3), ["NOT_AN_AMOUNT"]);
  assert.deepEqual(calculationProblems(allocation({ capPerWalletRaw: "1", floorPerWalletRaw: "5" }), 3), ["CAP_BELOW_FLOOR"]);
  assert.deepEqual(calculationProblems(allocation(), 0), ["NO_WALLETS"]);
  assert.deepEqual(calculationProblems(allocation({ maxWallets: 2 }), 3), ["TOO_MANY_WALLETS"]);
  assert.deepEqual(calculationProblems(allocation({ mode: "tiered" }), 3), ["TIERS_MISSING"]);
  assert.deepEqual(calculationProblems(allocation({ mode: "tiered", tiers: [{ fromRaw: "1", weight: 0 }] }), 3), ["TIER_WEIGHT"]);
});
