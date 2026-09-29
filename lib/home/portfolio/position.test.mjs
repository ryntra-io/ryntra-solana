import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNTING_ROLES,
  CASH_STATES,
  POSITION_TYPES,
  VALUATION_STATES,
  createPositionRecord,
  parsePositionRecord,
} from "./position.ts";

const at = "2026-08-22T10:00:00.000Z";

function priced(state = "PRICED") {
  return {
    state,
    value: { amount: { units: "10000", scale: 2 }, currency: "USD" },
    sourceRef: "price:test:asset",
    observedAt: at,
    validUntil: null,
    freshnessPolicy: { maxAgeSeconds: 60 },
    reason: null,
    conflictRefs: [],
  };
}

function valuation(state) {
  if (["PRICED", "ESTIMATED", "STALE"].includes(state)) return priced(state);
  if (state === "CONFLICTING") {
    return {
      state,
      value: null,
      sourceRef: null,
      observedAt: at,
      validUntil: null,
      freshnessPolicy: null,
      reason: "two current sources disagree",
      conflictRefs: ["evidence:price:a", "evidence:price:b"],
    };
  }
  return {
    state,
    value: null,
    sourceRef: null,
    observedAt: at,
    validUntil: null,
    freshnessPolicy: null,
    reason: state === "PRIVATE_HIDDEN" ? "value is client-private" : "no price source",
    conflictRefs: [],
  };
}

function draft(overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    ownerRef: "owner_example",
    source: {
      sourceId: "source_example",
      connectionId: "connection_example",
      sourcePositionKey: "source-position-1",
      sourceVersion: "7",
      observedAt: at,
      evidenceRefs: ["evidence:position:1"],
    },
    accountRef: "account_example",
    networkRef: "network_example",
    venueRef: null,
    protocolRef: null,
    instrumentKey: "instrument_example",
    underlyingKey: "underlying_example",
    representationKey: "representation_example",
    positionType: "WALLET_ASSET",
    positionSlotKey: "slot-1",
    book: "LIVE",
    accountingRole: "PRIMARY",
    economicLot: {
      state: "SOURCE_SCOPED",
      sourceId: "source_example",
      lotKey: "lot-1",
      evidenceRefs: ["evidence:lot:1"],
    },
    quantity: { amount: { units: "5", scale: 0 }, unitRef: "instrument_example" },
    valuation: priced(),
    valuationContribution: "ASSET",
    cashState: "NOT_CASH",
    settlementState: "SETTLED",
    custodyClass: "SELF_CUSTODY",
    exposureLegs: [
      {
        legId: "leg-principal",
        underlyingKey: "underlying_example",
        role: "PRINCIPAL",
        phase: "SETTLED",
        direction: "LONG",
        notional: { amount: { units: "10000", scale: 2 }, currency: "USD" },
        unknownReason: null,
        observedAt: at,
        validUntil: null,
        freshnessPolicy: { maxAgeSeconds: 60 },
        evidenceRefs: ["evidence:exposure:1"],
      },
    ],
    ...overrides,
  };
}

test("all fourteen canonical position types create strict records", () => {
  assert.equal(POSITION_TYPES.length, 14);
  for (const positionType of POSITION_TYPES) {
    const special = positionType === "PAPER"
      ? { book: "PAPER", accountingRole: "PAPER" }
      : ["ESCROW", "FUNDS_IN_MOTION", "AGENT_COMMITMENT"].includes(positionType)
        ? { accountingRole: "RESERVATION", valuationContribution: "NONE" }
        : {};
    const record = createPositionRecord(draft({ positionType, ...special }));
    assert.equal(record.positionType, positionType);
    assert.match(record.positionId, /^pos_v1_[0-9a-f]{64}$/);
  }
});

test("all six valuation states preserve missing and conflicting truth", () => {
  assert.equal(VALUATION_STATES.length, 6);
  for (const state of VALUATION_STATES) {
    const record = createPositionRecord(draft({ valuation: valuation(state) }));
    assert.equal(record.valuation.state, state);
    if (["UNPRICED", "CONFLICTING", "PRIVATE_HIDDEN"].includes(state)) {
      assert.equal(record.valuation.value, null);
    }
  }
});

test("accounting and cash vocabularies have no implicit fallback", () => {
  assert.deepEqual(ACCOUNTING_ROLES, ["PRIMARY", "RESERVATION", "REFERENCE", "PAPER"]);
  assert.deepEqual(CASH_STATES, [
    "NOT_CASH",
    "SPENDABLE",
    "PENDING",
    "FUNDS_IN_MOTION",
    "COMMITTED",
    "LOCKED_COLLATERAL",
    "PRIVATE_HIDDEN",
  ]);
});

test("positionSlotKey keeps two same-asset commitments distinct", () => {
  const common = {
    positionType: "AGENT_COMMITMENT",
    accountingRole: "RESERVATION",
    valuationContribution: "NONE",
  };
  const first = createPositionRecord(draft({ ...common, positionSlotKey: "action-1" }));
  const second = createPositionRecord(draft({ ...common, positionSlotKey: "action-2" }));
  assert.notEqual(first.positionId, second.positionId);
});

test("canonical evidence and exposure order make repeated normalization identical", () => {
  const secondLeg = {
    ...draft().exposureLegs[0],
    legId: "leg-a",
    underlyingKey: "underlying_a",
    evidenceRefs: ["evidence:z", "evidence:a", "evidence:z"],
  };
  const first = createPositionRecord(draft({
    source: { ...draft().source, evidenceRefs: ["evidence:z", "evidence:a", "evidence:z"] },
    exposureLegs: [draft().exposureLegs[0], secondLeg],
  }));
  const second = createPositionRecord({
    ...first,
    positionId: undefined,
    source: { ...first.source, evidenceRefs: [...first.source.evidenceRefs].reverse() },
    exposureLegs: [...first.exposureLegs].reverse(),
  });
  assert.deepEqual(second, first);
  assert.deepEqual(first.source.evidenceRefs, ["evidence:a", "evidence:z"]);
  assert.deepEqual(first.exposureLegs.map((leg) => leg.legId), ["leg-a", "leg-principal"]);
});

test("strict parsing refuses unknown fields and a forged position id", () => {
  const record = createPositionRecord(draft());
  assert.deepEqual(parsePositionRecord(record), record);
  assert.throws(() => createPositionRecord({ ...draft(), surprise: true }), /unrecognized|unknown/i);
  assert.throws(() => parsePositionRecord({ ...record, positionId: `pos_v1_${"0".repeat(64)}` }), /positionId/);
});

test("money magnitudes cannot carry negative units", () => {
  assert.throws(
    () => createPositionRecord(draft({
      valuation: {
        ...priced(),
        value: { amount: { units: "-1", scale: 2 }, currency: "USD" },
      },
    })),
    /non-negative|amount/i,
  );
});

test("money unit refs may be namespaced onchain assets rather than fiat tickers", () => {
  const assetRef = "eip155:8453/erc20:0x3600000000000000000000000000000000000000";
  const record = createPositionRecord(draft({
    valuation: {
      ...priced(),
      value: { amount: { units: "1", scale: 6 }, currency: assetRef },
    },
    exposureLegs: [{
      ...draft().exposureLegs[0],
      notional: { amount: { units: "1", scale: 6 }, currency: assetRef },
    }],
  }));
  assert.equal(record.valuation.value.currency, assetRef);
});

test("valuation state combinations fail closed", () => {
  assert.throws(() => createPositionRecord(draft({
    valuation: { ...priced(), sourceRef: null },
  })), /source/i);
  assert.throws(() => createPositionRecord(draft({
    valuation: { ...valuation("CONFLICTING"), conflictRefs: ["only-one"] },
  })), /conflict/i);
  assert.throws(() => createPositionRecord(draft({
    valuation: { ...valuation("PRIVATE_HIDDEN"), value: priced().value },
  })), /PRIVATE_HIDDEN|value/i);
});

test("exposure legs require either notional or an unknown reason, never both", () => {
  const leg = draft().exposureLegs[0];
  assert.throws(() => createPositionRecord(draft({
    exposureLegs: [{ ...leg, notional: null, unknownReason: null }],
  })), /unknownReason|notional/);
  assert.throws(() => createPositionRecord(draft({
    exposureLegs: [{ ...leg, unknownReason: "not known" }],
  })), /unknownReason|notional/);
  assert.throws(() => createPositionRecord(draft({
    exposureLegs: [leg, { ...leg }],
  })), /legId|duplicate/i);
});

test("paper and reservation types cannot enter the Live primary book", () => {
  assert.throws(() => createPositionRecord(draft({ positionType: "PAPER" })), /PAPER|book|accounting/i);
  assert.throws(() => createPositionRecord(draft({ positionType: "ESCROW" })), /ESCROW|RESERVATION|accounting/i);
  assert.throws(() => createPositionRecord(draft({
    positionType: "AGENT_COMMITMENT",
    accountingRole: "RESERVATION",
    valuationContribution: "ASSET",
  })), /valuationContribution|NONE/i);
});
