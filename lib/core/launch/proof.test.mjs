// SOL-L3 Proof-of-Launch: every statement about a token comes with the transaction or the account where anyone can
// check it; a fact not read is said as not read, never a statement without its link.
import assert from "node:assert/strict";
import test from "node:test";

import { presetTerms } from "./preset-terms.ts";
import { PROOF_TOPICS, proofClaims, proofOfLaunch, riskFactEvidence } from "./proof.ts";

/* Synthetic addresses and signatures only. */
const MINT = "Mint".padEnd(44, "1");
const CREATOR = "Creator".padEnd(44, "2");
const CREATION = "Creation".padEnd(88, "3");
const CONFIG = "Config".padEnd(44, "4");
const CURVE = "Curve".padEnd(44, "5");
const POOL = "Pq".padEnd(44, "6");
const EXIT = "Exit".padEnd(88, "7");
const SALE = "Sq".padEnd(88, "8");

const RIGHTS = ["MINT_REVOKED", "NO_FREEZE", "METADATA_FIXED", "NO_TRANSFER_HOOK"].map((code) => ({ code, account: MINT }));

const graduated = {
  token: MINT,
  creator: CREATOR,
  creation: CREATION,
  terms: presetTerms("demo"),
  receipt: {
    config: CONFIG,
    curve: CURVE,
    supplyRaw: "999658757750846",
    decimals: 6,
    marks: [...RIGHTS, { code: "LP_LOCKED_FOREVER", account: "Creatorpos".padEnd(44, "9") }, { code: "LP_LOCKED_FOREVER", account: "Partnerpos".padEnd(44, "9") }],
    creatorFirstBuy: { quoteInRaw: "5000000", tokensOutRaw: "20000000000000" },
    creatorLock: { escrow: "Escrow".padEnd(44, "9"), cliffAt: "2027-04-08T00:00:00.000Z", endsAt: "2027-04-08T00:00:00.000Z" },
    migrated: true,
    progressBps: 10_000,
    thresholdRaw: "50000000",
    graduated: {
      pool: POOL,
      positions: [
        { position: "Creatorpos".padEnd(44, "9"), owner: "creator" },
        { position: "Partnerpos".padEnd(44, "9"), owner: "partner" },
      ],
    },
  },
  lockUnread: false,
  exitUnread: false,
  market: {
    supplyRaw: "999658757750846",
    decimals: 6,
    migrated: true,
    progressBps: 10_000,
    thresholdRaw: "50000000",
    pool: POOL,
    curveFeeNowBps: null,
    creatorSales: [],
    creatorTradesComplete: true,
    graduation: { signature: EXIT, at: 1_728_576_751 },
    creatorShare: { bps: 200, account: "Hq".padEnd(44, "9") },
  },
  health: { top10Bps: 9_000, top10AtLeast: false, holders: 4, holdersAtLeast: false },
};

test("every statement of the proof has at least one link to the chain", () => {
  const sections = proofOfLaunch(graduated);
  assert.deepEqual(sections.map((entry) => entry.topic), [...PROOF_TOPICS], "the seven topics, in order");
  const claims = proofClaims(sections);
  assert.ok(claims.length >= 12);
  for (const claim of claims) {
    assert.ok(claim.evidence.length > 0, `${claim.code} has a link`);
    for (const link of claim.evidence) assert.match(link.id, /^[1-9A-HJ-NP-Za-km-z]{32,90}$/, `${claim.code}: ${link.id}`);
  }
  assert.ok(sections.every((entry) => !entry.unread), "a market read whole leaves no topic unread");
});

test("the supply after a burn says what was launched and what was burned, at the mint and the creation", () => {
  const supply = proofOfLaunch(graduated).find((entry) => entry.topic === "supply");
  assert.equal(supply.claims[0].code, "SUPPLY_BURNED");
  assert.equal(supply.claims[0].values.burnedRaw, "341242249154");
  assert.deepEqual(supply.claims[0].evidence.map((link) => link.what), ["mint", "creation"]);
  const full = proofOfLaunch({ ...graduated, receipt: { ...graduated.receipt, supplyRaw: "1000000000000000" } }).find((entry) => entry.topic === "supply");
  assert.equal(full.claims[0].code, "SUPPLY_FULL");
});

test("after the DEX: each locked position by whose share it is, the move's transaction and the pool", () => {
  const sections = proofOfLaunch(graduated);
  const liquidity = sections.find((entry) => entry.topic === "liquidity");
  assert.deepEqual(liquidity.claims.map((claim) => claim.values.owner), ["creator", "partner"]);
  const migration = sections.find((entry) => entry.topic === "migration");
  assert.equal(migration.claims[0].code, "MIGRATED");
  assert.deepEqual(migration.claims[0].evidence.map((link) => [link.kind, link.what]), [["tx", "graduation"], ["account", "pool"]]);
  const fees = sections.find((entry) => entry.topic === "fees");
  assert.deepEqual(fees.claims.map((claim) => claim.code), ["GRADUATION_FEE", "POOL_FEE"], "the curve's fees no longer apply after the DEX");
  assert.equal(fees.claims.at(-1).evidence[0].id, POOL);
});

test("the creator's sales are linked, the newest first; «did not sell» only when every trade of theirs was read", () => {
  const sold = proofOfLaunch({ ...graduated, market: { ...graduated.market, creatorSales: [1, 2, 3, 4].map((n) => ({ signature: SALE.slice(0, -1) + n, at: n })) } });
  const claim = sold.find((entry) => entry.topic === "creator").claims.find((entry) => entry.code === "CREATOR_SOLD");
  assert.equal(claim.values.sales, 4);
  assert.deepEqual(claim.evidence.map((link) => link.id.at(-1)), ["4", "3", "2"], "three linked, the newest first");
  const partial = proofOfLaunch({ ...graduated, market: { ...graduated.market, creatorTradesComplete: false } }).find((entry) => entry.topic === "creator");
  assert.equal(partial.claims.some((entry) => entry.code === "CREATOR_NOT_SOLD"), false, "a part of their trades read is never «did not sell»");
  assert.equal(partial.unread, true);
});

test("nothing read: no statement at all, every topic said as not read", () => {
  const sections = proofOfLaunch({ ...graduated, receipt: null, market: null, health: null });
  assert.equal(proofClaims(sections).length, 0);
  assert.ok(sections.every((entry) => entry.unread), "each topic says it was not read");
});

test("a lock or an exit not read is said as such, never as none", () => {
  const sections = proofOfLaunch({ ...graduated, lockUnread: true, exitUnread: true, receipt: { ...graduated.receipt, creatorLock: null, marks: RIGHTS } });
  assert.equal(sections.find((entry) => entry.topic === "creator").unread, true);
  const liquidity = sections.find((entry) => entry.topic === "liquidity");
  assert.equal(liquidity.unread, true);
  assert.equal(liquidity.claims.length, 0, "a position not read is not called locked");
});

test("on the curve: the curve holds the money, the way to the DEX at the curve and the config, the fee now", () => {
  const curve = proofOfLaunch({
    ...graduated,
    terms: presetTerms("protected"),
    receipt: { ...graduated.receipt, supplyRaw: "1000000000000000", migrated: false, progressBps: 300, graduated: null, marks: [...RIGHTS, { code: "CURVE_HOLDS_FUNDS", account: CURVE }] },
    market: { ...graduated.market, migrated: false, progressBps: 300, pool: CURVE, curveFeeNowBps: 100, graduation: null },
  });
  assert.equal(curve.find((entry) => entry.topic === "liquidity").claims[0].code, "CURVE_HOLDS_FUNDS");
  const migration = curve.find((entry) => entry.topic === "migration").claims[0];
  assert.equal(migration.code, "ON_CURVE");
  assert.deepEqual(migration.evidence.map((link) => link.what), ["curve", "config"]);
  const fees = curve.find((entry) => entry.topic === "fees").claims;
  assert.deepEqual(fees.map((claim) => claim.code), ["CURVE_FEE", "CURVE_SPLIT", "GRADUATION_FEE", "POOL_FEE"]);
  assert.equal(fees[0].values.startBps, 5_000);
  assert.equal(fees[0].values.nowBps, 100);
  assert.deepEqual([fees[1].values.creatorBps, fees[1].values.ryntraBps, fees[1].values.meteoraBps], [3_200, 4_800, 2_000], "32 / 48 / 20 of every fee (SOL-L0)");
});

test("a count over many holders links the mint; a fact about the read itself states nothing of the token", () => {
  const ids = { token: MINT, creator: CREATOR, creation: CREATION };
  for (const code of ["TOP10_HOLD", "FEW_HOLDERS", "SNIPERS_HOLD", "BUNDLE_HOLDS", "HOLDERS_UNCOUNTED"]) assert.deepEqual(riskFactEvidence(code, ids), { kind: "account", id: MINT }, code);
  assert.deepEqual(riskFactEvidence("CREATOR_OTHER_CURVES", ids), { kind: "account", id: CREATOR });
  assert.deepEqual(riskFactEvidence("YOUNG", ids), { kind: "tx", id: CREATION });
  assert.equal(riskFactEvidence("HISTORY_PARTIAL", ids), null);
  assert.equal(riskFactEvidence("OPENING_UNREAD", ids), null);
});
