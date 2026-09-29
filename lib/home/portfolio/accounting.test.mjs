import assert from "node:assert/strict";
import test from "node:test";

import { validateAccounting } from "./accounting.ts";
import { createPositionRecord } from "./position.ts";

const at = "2026-08-22T10:00:00.000Z";

function record(overrides = {}) {
  return createPositionRecord({
    schemaVersion: "1.0.0",
    ownerRef: "owner_example",
    source: {
      sourceId: "source_a",
      connectionId: "connection_a",
      sourcePositionKey: overrides.positionSlotKey ?? "native-1",
      sourceVersion: "1",
      observedAt: at,
      evidenceRefs: ["evidence:source"],
    },
    accountRef: "account_example",
    networkRef: "network_example",
    venueRef: null,
    protocolRef: null,
    instrumentKey: "instrument_example",
    underlyingKey: "underlying_example",
    representationKey: overrides.representationKey ?? "representation_example",
    positionType: "WALLET_ASSET",
    positionSlotKey: "slot-1",
    book: "LIVE",
    accountingRole: "PRIMARY",
    economicLot: { state: "VERIFIED", lotId: "lot-1", evidenceRefs: ["evidence:lot"] },
    quantity: null,
    valuation: {
      state: "UNPRICED",
      value: null,
      sourceRef: null,
      observedAt: at,
      validUntil: null,
      freshnessPolicy: null,
      reason: "not priced",
      conflictRefs: [],
    },
    valuationContribution: "ASSET",
    cashState: "NOT_CASH",
    settlementState: "SETTLED",
    custodyClass: "SELF_CUSTODY",
    exposureLegs: [],
    ...overrides,
  });
}

test("wallet reference and lending primary own one verified lot exactly once", () => {
  const wallet = record({ accountingRole: "REFERENCE", positionSlotKey: "wallet", representationKey: "wallet-token" });
  const lending = record({ positionType: "LENDING_SUPPLY", positionSlotKey: "supply", representationKey: "lending-claim" });
  const result = validateAccounting([wallet, lending]);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.validRecords.map((item) => item.positionId).sort(), [wallet.positionId, lending.positionId].sort());
});

test("two primary owners for one verified lot are an accounting conflict", () => {
  const first = record({ positionSlotKey: "wallet" });
  const second = record({ positionType: "LENDING_SUPPLY", positionSlotKey: "supply", representationKey: "lending-claim" });
  const result = validateAccounting([first, second]);
  assert.equal(result.validRecords.length, 0);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, "ACCOUNTING_CONFLICT");
});

test("one LP owner may retain multiple reserve references without extra value owners", () => {
  const lp = record({ positionType: "LP", positionSlotKey: "lp-nft-7", representationKey: "lp-share" });
  const reserveA = record({ accountingRole: "REFERENCE", positionSlotKey: "reserve-a", representationKey: "token-a" });
  const reserveB = record({ accountingRole: "REFERENCE", positionSlotKey: "reserve-b", representationKey: "token-b" });
  const result = validateAccounting([reserveB, lp, reserveA]);
  assert.deepEqual(result.issues, []);
  assert.equal(result.validRecords.length, 3);
});

test("bridge source and destination references plus one funds-in-motion reservation do not double count", () => {
  const source = record({ accountingRole: "REFERENCE", positionSlotKey: "source", representationKey: "source-token" });
  const destination = record({ accountingRole: "REFERENCE", positionSlotKey: "destination", representationKey: "destination-token" });
  const transit = record({
    positionType: "FUNDS_IN_MOTION",
    positionSlotKey: "bridge-transfer-1",
    representationKey: "bridge-transfer",
    accountingRole: "RESERVATION",
    valuationContribution: "NONE",
    cashState: "FUNDS_IN_MOTION",
  });
  const result = validateAccounting([destination, transit, source]);
  assert.deepEqual(result.issues, []);
  assert.equal(result.validRecords.length, 3);
});

test("two active reservations for one verified lot are refused", () => {
  const first = record({
    positionType: "AGENT_COMMITMENT",
    positionSlotKey: "action-1",
    accountingRole: "RESERVATION",
    valuationContribution: "NONE",
  });
  const second = record({
    positionType: "AGENT_COMMITMENT",
    positionSlotKey: "action-2",
    accountingRole: "RESERVATION",
    valuationContribution: "NONE",
  });
  const result = validateAccounting([first, second]);
  assert.equal(result.validRecords.length, 0);
  assert.equal(result.issues[0].code, "ACCOUNTING_CONFLICT");
});

test("potential duplicate input makes the affected records uncertain and unavailable to totals", () => {
  const first = record({ positionSlotKey: "same-slot" });
  const second = record({ positionSlotKey: "same-slot", source: {
    ...first.source,
    sourceId: "source_b",
    sourcePositionKey: "native-b",
  } });
  const issue = {
    code: "POTENTIAL_DUPLICATE",
    activePositionKey: "same",
    positionIds: [second.positionId, first.positionId],
    fields: ["economicLot"],
  };
  const result = validateAccounting([first, second], [issue]);
  assert.equal(result.validRecords.length, 0);
  assert.deepEqual(result.uncertainPositionIds, [first.positionId]);
  assert.equal(result.issues[0].code, "POTENTIAL_DUPLICATE");
});
