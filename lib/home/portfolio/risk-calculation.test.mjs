import assert from "node:assert/strict";
import test from "node:test";

import { createPositionRecord } from "./position.ts";
import { calculateRisk } from "./risk-calculation.ts";

const asOf = "2026-08-22T10:01:00.000Z";
const observedAt = "2026-08-22T10:00:00.000Z";
const money = (units, scale = 2) => ({ amount: { units, scale }, currency: "USD" });

function leg(id, units, options = {}) {
  return {
    legId: id,
    underlyingKey: options.underlyingKey ?? id,
    role: options.role ?? "PRINCIPAL",
    phase: options.phase ?? "SETTLED",
    direction: options.direction ?? "LONG",
    notional: units === null ? null : money(units),
    unknownReason: units === null ? (options.unknownReason ?? "decomposition unavailable") : null,
    observedAt,
    validUntil: null,
    freshnessPolicy: { maxAgeSeconds: 120 },
    evidenceRefs: [`evidence:${id}`],
  };
}

function position(id, options = {}) {
  const positionType = options.positionType ?? "WALLET_ASSET";
  const reservation = ["ESCROW", "FUNDS_IN_MOTION", "AGENT_COMMITMENT"].includes(positionType);
  const valueUnits = options.valueUnits === undefined ? "10000" : options.valueUnits;
  const valuationState = valueUnits === null ? "UNPRICED" : "PRICED";
  return createPositionRecord({
    schemaVersion: "1.0.0",
    ownerRef: "owner_example",
    source: {
      sourceId: `source_${id}`,
      connectionId: `connection_${id}`,
      sourcePositionKey: `native-${id}`,
      sourceVersion: "1",
      observedAt,
      evidenceRefs: [`evidence:source:${id}`],
    },
    accountRef: "account_example",
    networkRef: "network_example",
    venueRef: null,
    protocolRef: null,
    instrumentKey: `instrument_${id}`,
    underlyingKey: options.underlyingKey ?? `underlying_${id}`,
    representationKey: `representation_${id}`,
    positionType,
    positionSlotKey: `slot-${id}`,
    book: "LIVE",
    accountingRole: options.accountingRole ?? (reservation ? "RESERVATION" : "PRIMARY"),
    economicLot: { state: "VERIFIED", lotId: `lot-${id}`, evidenceRefs: [`evidence:lot:${id}`] },
    quantity: null,
    valuation: valuationState === "PRICED" ? {
      state: "PRICED",
      value: money(valueUnits),
      sourceRef: `price:${id}`,
      observedAt,
      validUntil: null,
      freshnessPolicy: { maxAgeSeconds: 120 },
      reason: null,
      conflictRefs: [],
    } : {
      state: "UNPRICED",
      value: null,
      sourceRef: null,
      observedAt,
      validUntil: null,
      freshnessPolicy: null,
      reason: "not valuation-bearing",
      conflictRefs: [],
    },
    valuationContribution: options.valuationContribution ?? (reservation ? "NONE" : "ASSET"),
    cashState: options.cashState ?? "NOT_CASH",
    settlementState: "SETTLED",
    custodyClass: "SELF_CUSTODY",
    exposureLegs: options.exposureLegs ?? [],
  });
}

function input(records, constraints = []) {
  return {
    schemaVersion: "1.0.0",
    formulaVersion: "1.0.0",
    scope: { scopeId: "scope_example", ownerRef: "owner_example", contextVersion: 1 },
    asOf,
    displayCurrency: "USD",
    scale: 2,
    roundingMode: "HALF_EVEN",
    inclusionMethod: "PRICED_ONLY",
    records,
    accountingIssues: [],
    fx: [],
    constraints,
  };
}

function known(units) {
  return { state: "KNOWN", value: money(units) };
}

test("LP valuation stays separate from two underlying exposure legs", () => {
  const lp = position("lp", {
    positionType: "LP",
    valueUnits: "10000",
    exposureLegs: [
      leg("leg-a", "6000", { role: "COMPONENT", underlyingKey: "asset-a" }),
      leg("leg-b", "4000", { role: "COMPONENT", underlyingKey: "asset-b" }),
    ],
  });
  const result = calculateRisk(input([lp]));
  assert.deepEqual(result.valuation.observedAssetValue, money("10000"));
  assert.deepEqual(result.metrics.grossExposure, known("10000"));
  assert.deepEqual(result.metrics.byUnderlying, [
    { underlyingKey: "asset-a", gross: known("6000"), long: known("6000"), short: known("0"), net: known("6000") },
    { underlyingKey: "asset-b", gross: known("4000"), long: known("4000"), short: known("0"), net: known("4000") },
  ]);
});

test("PERP observed equity is never reused as derivative notional", () => {
  const perp = position("perp", {
    positionType: "PERP",
    valueUnits: "5000",
    exposureLegs: [leg("perp-notional", "100000", { role: "DERIVATIVE_NOTIONAL", underlyingKey: "btc" })],
  });
  const result = calculateRisk(input([perp]));
  assert.deepEqual(result.valuation.observedAssetValue, money("5000"));
  assert.deepEqual(result.metrics.grossExposure, known("100000"));
});

test("debt and short use positive magnitudes with one negative net contribution", () => {
  const asset = position("asset", { valueUnits: "200000", exposureLegs: [leg("asset", "200000", { underlyingKey: "usd" })] });
  const debt = position("debt", {
    positionType: "DEBT",
    valueUnits: "50000",
    valuationContribution: "LIABILITY",
    exposureLegs: [leg("debt", "50000", { underlyingKey: "usd", direction: "LIABILITY" })],
  });
  const short = position("short", {
    positionType: "PERP",
    valueUnits: "0",
    valuationContribution: "NONE",
    exposureLegs: [leg("short", "30000", { underlyingKey: "btc", direction: "SHORT", role: "DERIVATIVE_NOTIONAL" })],
  });
  const result = calculateRisk(input([asset, debt, short]));
  assert.deepEqual(result.valuation.observedAssetValue, money("200000"));
  assert.deepEqual(result.valuation.observedLiabilities, money("50000"));
  assert.deepEqual(result.metrics.longExposure, known("200000"));
  assert.deepEqual(result.metrics.shortExposure, known("80000"));
  assert.deepEqual(result.metrics.grossExposure, known("280000"));
  assert.deepEqual(result.metrics.netExposure, known("120000"));
});

test("pending and committed exposure never inflate settled gross", () => {
  const pending = position("pending", {
    positionType: "FUNDS_IN_MOTION",
    valueUnits: null,
    cashState: "FUNDS_IN_MOTION",
    exposureLegs: [leg("pending", "3000", { phase: "PENDING", direction: "NEUTRAL", role: "CASH_FLOW" })],
  });
  const committed = position("committed", {
    positionType: "AGENT_COMMITMENT",
    valueUnits: null,
    cashState: "COMMITTED",
    exposureLegs: [leg("committed", "2000", { phase: "COMMITTED", direction: "NEUTRAL", role: "CASH_FLOW" })],
  });
  const result = calculateRisk(input([committed, pending]));
  assert.deepEqual(result.metrics.grossExposure, known("0"));
  assert.deepEqual(result.metrics.pendingExposure, known("3000"));
  assert.deepEqual(result.metrics.committedExposure, known("2000"));
  assert.deepEqual(result.cash.fundsInMotion, known("3000"));
  assert.deepEqual(result.cash.committed, known("2000"));
});

test("pending cash and funds in motion remain separate cash states", () => {
  const pending = position("pending-cash", {
    positionType: "ESCROW",
    valueUnits: null,
    cashState: "PENDING",
    exposureLegs: [leg("pending-cash", "1000", { phase: "PENDING", direction: "NEUTRAL", role: "CASH_FLOW" })],
  });
  const transit = position("transit-cash", {
    positionType: "FUNDS_IN_MOTION",
    valueUnits: null,
    cashState: "FUNDS_IN_MOTION",
    exposureLegs: [leg("transit-cash", "3000", { phase: "PENDING", direction: "NEUTRAL", role: "CASH_FLOW" })],
  });
  const result = calculateRisk(input([transit, pending]));
  assert.deepEqual(result.metrics.pendingExposure, known("4000"));
  assert.deepEqual(result.cash.pending, known("1000"));
  assert.deepEqual(result.cash.fundsInMotion, known("3000"));
});

test("unknown exposure decomposition makes only dependent metrics unknown", () => {
  const vault = position("vault", {
    positionType: "VAULT",
    valueUnits: "10000",
    exposureLegs: [leg("unknown-component", null, { role: "COMPONENT", underlyingKey: "unknown" })],
  });
  const result = calculateRisk(input([vault]));
  assert.deepEqual(result.valuation.observedAssetValue, money("10000"));
  assert.equal(result.metrics.grossExposure.state, "UNKNOWN");
  assert.equal(result.metrics.longExposure.state, "UNKNOWN");
});

test("zero risk-capital denominator keeps exposure-ratio constraints UNKNOWN", () => {
  const zero = position("zero", { valueUnits: "0", exposureLegs: [leg("zero", "0")] });
  const result = calculateRisk(input([zero], [{
    id: "max-gross-ratio",
    metric: "MAX_GROSS_EXPOSURE_BPS_OF_NET_OBSERVED_VALUE",
    limitBps: 10000,
  }]));
  assert.equal(result.metrics.riskCapitalValue.state, "UNKNOWN");
  assert.deepEqual(result.constraints, [{
    id: "max-gross-ratio",
    metric: "MAX_GROSS_EXPOSURE_BPS_OF_NET_OBSERVED_VALUE",
    status: "UNKNOWN",
    actual: null,
    limit: { basisPoints: 10000 },
    reason: "RISK_CAPITAL_UNAVAILABLE",
  }]);
});

test("absolute and ratio constraints are deterministic and canonically ordered", () => {
  const cash = position("cash", {
    valueUnits: "10000",
    cashState: "SPENDABLE",
    exposureLegs: [leg("cash", "5000", { underlyingKey: "cash" })],
  });
  const constraints = [
    { id: "z-min-cash", metric: "MIN_SPENDABLE_CASH", limit: money("12000") },
    { id: "a-max-gross", metric: "MAX_GROSS_EXPOSURE", limit: money("4000") },
    { id: "m-gross-ratio", metric: "MAX_GROSS_EXPOSURE_BPS_OF_NET_OBSERVED_VALUE", limitBps: 4000 },
  ];
  const result = calculateRisk(input([cash], constraints));
  assert.deepEqual(result.constraints.map((item) => [item.id, item.status]), [
    ["a-max-gross", "EXCEEDED"],
    ["m-gross-ratio", "EXCEEDED"],
    ["z-min-cash", "EXCEEDED"],
  ]);
  assert.deepEqual(result.bindingConstraintIds, ["a-max-gross", "m-gross-ratio", "z-min-cash"]);
});

test("input permutation leaves digest and semantic result byte-equivalent", () => {
  const first = position("a", { valueUnits: "6000", exposureLegs: [leg("a", "6000", { underlyingKey: "a" })] });
  const second = position("b", { valueUnits: "4000", exposureLegs: [leg("b", "4000", { underlyingKey: "b" })] });
  const left = calculateRisk(input([first, second]));
  const right = calculateRisk(input([second, first]));
  assert.equal(left.inputDigest, right.inputDigest);
  assert.deepEqual(left, right);
});

test("cross-source observations sharing one active position id still sort deterministically", () => {
  const first = position("shared", { valueUnits: "10000", exposureLegs: [leg("shared", "10000")] });
  const { positionId: _positionId, ...draft } = first;
  const second = createPositionRecord({
    ...draft,
    source: {
      ...draft.source,
      sourceId: "source_other",
      connectionId: "connection_other",
      sourcePositionKey: "native-other",
      sourceVersion: "2",
      evidenceRefs: ["evidence:other"],
    },
  });
  const issue = [{ code: "POTENTIAL_DUPLICATE", lotKey: "shared", positionIds: [first.positionId] }];
  const leftInput = { ...input([first, second]), accountingIssues: issue };
  const rightInput = { ...input([second, first]), accountingIssues: issue };
  const left = calculateRisk(leftInput);
  const right = calculateRisk(rightInput);
  assert.equal(left.inputDigest, right.inputDigest);
  assert.deepEqual(left, right);
});

test("RiskCalculation rejects an offset-less asOf even for an empty scope", () => {
  assert.throws(
    () => calculateRisk({ ...input([]), asOf: "2026-08-22T10:01:00" }),
    /asOf/,
  );
});
