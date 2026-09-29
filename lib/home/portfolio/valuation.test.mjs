import assert from "node:assert/strict";
import test from "node:test";

import { createPositionRecord } from "./position.ts";
import { calculateValuationCoverage } from "./valuation.ts";

const asOf = "2026-08-22T10:01:00.000Z";
const observedAt = "2026-08-22T10:00:00.000Z";

const money = (units, currency = "USD", scale = 2) => ({ amount: { units, scale }, currency });

function valuation(state, units = "10000", currency = "USD") {
  if (["PRICED", "ESTIMATED", "STALE"].includes(state)) {
    return {
      state,
      value: money(units, currency),
      sourceRef: `price:${state.toLowerCase()}`,
      observedAt,
      validUntil: state === "STALE" ? "2026-08-22T10:00:30.000Z" : null,
      freshnessPolicy: { maxAgeSeconds: state === "STALE" ? 30 : 120 },
      reason: null,
      conflictRefs: [],
    };
  }
  if (state === "CONFLICTING") {
    return {
      state,
      value: null,
      sourceRef: null,
      observedAt,
      validUntil: null,
      freshnessPolicy: null,
      reason: "sources disagree",
      conflictRefs: ["price:a", "price:b"],
    };
  }
  return {
    state,
    value: null,
    sourceRef: null,
    observedAt,
    validUntil: null,
    freshnessPolicy: null,
    reason: state === "PRIVATE_HIDDEN" ? "private" : "unpriced",
    conflictRefs: [],
  };
}

function position(id, options = {}) {
  const positionType = options.positionType ?? "WALLET_ASSET";
  const accountingRole = options.accountingRole
    ?? (positionType === "PAPER" ? "PAPER" : ["ESCROW", "FUNDS_IN_MOTION", "AGENT_COMMITMENT"].includes(positionType) ? "RESERVATION" : "PRIMARY");
  return createPositionRecord({
    schemaVersion: "1.0.0",
    ownerRef: "owner_example",
    source: {
      sourceId: `source_${id}`,
      connectionId: `connection_${id}`,
      sourcePositionKey: `source-position-${id}`,
      sourceVersion: "1",
      observedAt,
      evidenceRefs: [`evidence:${id}`],
    },
    accountRef: "account_example",
    networkRef: "network_example",
    venueRef: null,
    protocolRef: null,
    instrumentKey: `instrument_${id}`,
    underlyingKey: `underlying_${id}`,
    representationKey: `representation_${id}`,
    positionType,
    positionSlotKey: `slot-${id}`,
    book: positionType === "PAPER" ? "PAPER" : "LIVE",
    accountingRole,
    economicLot: { state: "VERIFIED", lotId: `lot-${id}`, evidenceRefs: [`evidence:lot:${id}`] },
    quantity: null,
    valuation: options.valuation ?? valuation("PRICED", options.units ?? "10000", options.currency ?? "USD"),
    valuationContribution: options.valuationContribution
      ?? (["ESCROW", "FUNDS_IN_MOTION", "AGENT_COMMITMENT"].includes(positionType) ? "NONE" : "ASSET"),
    cashState: options.cashState ?? "NOT_CASH",
    settlementState: "SETTLED",
    custodyClass: "SELF_CUSTODY",
    exposureLegs: [],
  });
}

function coverage(records, options = {}) {
  return calculateValuationCoverage({
    records,
    accountingIssues: options.accountingIssues ?? [],
    displayCurrency: "USD",
    scale: 2,
    roundingMode: "HALF_EVEN",
    inclusionMethod: options.inclusionMethod ?? "PRICED_ONLY",
    fx: options.fx ?? [],
    asOf: options.asOf ?? asOf,
  });
}

test("all six states have exact count coverage and unknown value denominator", () => {
  const records = [
    position("priced", { valuation: valuation("PRICED", "10000") }),
    position("estimated", { valuation: valuation("ESTIMATED", "5000") }),
    position("stale", { valuation: valuation("STALE", "2500"), valuationContribution: "LIABILITY" }),
    position("unpriced", { valuation: valuation("UNPRICED") }),
    position("conflicting", { valuation: valuation("CONFLICTING") }),
    position("private", { valuation: valuation("PRIVATE_HIDDEN") }),
  ];
  const result = coverage(records);
  assert.deepEqual(result.stateCounts, {
    PRICED: 1,
    ESTIMATED: 1,
    STALE: 1,
    UNPRICED: 1,
    CONFLICTING: 1,
    PRIVATE_HIDDEN: 1,
  });
  assert.equal(result.eligiblePositionCount, 6);
  assert.equal(result.includedPositionCount, 1);
  assert.equal(result.positionCoverageBps, 1666);
  assert.equal(result.marketValueCoverageBps, null);
  assert.deepEqual(result.observedAssetValue, money("10000"));
  assert.deepEqual(result.observedLiabilities, money("0"));
  assert.deepEqual(result.staleSubtotal, money("2500"));
});

test("estimated value joins only through the explicit inclusion method", () => {
  const records = [
    position("priced", { valuation: valuation("PRICED", "10000") }),
    position("estimated", { valuation: valuation("ESTIMATED", "5000") }),
  ];
  const pricedOnly = coverage(records);
  const withEstimated = coverage(records, { inclusionMethod: "PRICED_AND_ESTIMATED" });
  assert.equal(pricedOnly.positionCoverageBps, 5000);
  assert.equal(pricedOnly.marketValueCoverageBps, 6666);
  assert.deepEqual(pricedOnly.observedAssetValue, money("10000"));
  assert.equal(withEstimated.positionCoverageBps, 10000);
  assert.equal(withEstimated.marketValueCoverageBps, 10000);
  assert.deepEqual(withEstimated.observedAssetValue, money("15000"));
});

test("assets and debt stay separate and complete coverage uses absolute magnitudes", () => {
  const records = [
    position("asset", { units: "20000" }),
    position("debt", { positionType: "DEBT", units: "5000", valuationContribution: "LIABILITY" }),
  ];
  const result = coverage(records);
  assert.equal(result.positionCoverageBps, 10000);
  assert.equal(result.marketValueCoverageBps, 10000);
  assert.deepEqual(result.observedAssetValue, money("20000"));
  assert.deepEqual(result.observedLiabilities, money("5000"));
  assert.deepEqual(result.netObservedValue, money("15000"));
});

test("an explicit zero is valued by count but cannot create a value denominator", () => {
  const result = coverage([position("zero", { units: "0" })]);
  assert.equal(result.positionCoverageBps, 10000);
  assert.equal(result.marketValueCoverageBps, null);
  assert.deepEqual(result.observedAssetValue, money("0"));
});

test("paper, reference and reservation records are outside valuation denominators", () => {
  const result = coverage([
    position("paper", { positionType: "PAPER" }),
    position("reference", { accountingRole: "REFERENCE" }),
    position("commitment", { positionType: "AGENT_COMMITMENT" }),
  ]);
  assert.equal(result.eligiblePositionCount, 0);
  assert.equal(result.positionCoverageBps, null);
  assert.equal(result.marketValueCoverageBps, null);
});

test("FX is accepted at the exact boundary and stale one millisecond later", () => {
  const eur = position("eur", { units: "10000", currency: "EUR" });
  const fx = [{
    baseCurrency: "EUR",
    quoteCurrency: "USD",
    rate: { units: "120", scale: 2 },
    sourceRef: "fx:eur-usd",
    observedAt,
    validUntil: asOf,
    freshnessPolicy: { maxAgeSeconds: 120 },
  }];
  const current = coverage([eur], { fx });
  assert.equal(current.marketValueCoverageBps, 10000);
  assert.deepEqual(current.observedAssetValue, money("12000"));

  const stale = coverage([eur], { fx, asOf: "2026-08-22T10:01:00.001Z" });
  assert.equal(stale.positionCoverageBps, 10000);
  assert.equal(stale.marketValueCoverageBps, null);
  assert.deepEqual(stale.observedAssetValue, money("0"));
  assert.ok(stale.unknowns.some((item) => item.code === "STALE_FX"));
});

test("accounting uncertainty makes value coverage unknown without inventing zero", () => {
  const item = position("uncertain", { units: "10000" });
  const result = coverage([item], {
    accountingIssues: [{ code: "POTENTIAL_DUPLICATE", lotKey: "candidate", positionIds: [item.positionId] }],
  });
  assert.equal(result.marketValueCoverageBps, null);
  assert.deepEqual(result.observedAssetValue, money("0"));
  assert.ok(result.unknowns.some((entry) => entry.code === "POTENTIAL_DUPLICATE"));
});
