import assert from "node:assert/strict";
import test from "node:test";

import { activePositionKey, mergePositionRecords, observationKey } from "./identity.ts";
import { createPositionRecord } from "./position.ts";

const at = "2026-08-22T10:00:00.000Z";

function record(overrides = {}) {
  const source = {
    sourceId: "source_a",
    connectionId: "connection_a",
    sourcePositionKey: "native-position-1",
    sourceVersion: "1",
    observedAt: at,
    evidenceRefs: ["evidence:source:a"],
    ...(overrides.source ?? {}),
  };
  const value = {
    schemaVersion: "1.0.0",
    ownerRef: "owner_example",
    source,
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
      state: "VERIFIED",
      lotId: "verified-lot-1",
      evidenceRefs: ["evidence:lot:1"],
    },
    quantity: { amount: { units: "5", scale: 0 }, unitRef: "instrument_example" },
    valuation: {
      state: "PRICED",
      value: { amount: { units: "10000", scale: 2 }, currency: "USD" },
      sourceRef: "price:test",
      observedAt: at,
      validUntil: null,
      freshnessPolicy: { maxAgeSeconds: 60 },
      reason: null,
      conflictRefs: [],
    },
    valuationContribution: "ASSET",
    cashState: "NOT_CASH",
    settlementState: "SETTLED",
    custodyClass: "SELF_CUSTODY",
    exposureLegs: [],
    ...overrides,
    source,
  };
  return createPositionRecord(value);
}

test("observation identity changes by source while active identity does not", () => {
  const first = record();
  const second = record({
    source: {
      sourceId: "source_b",
      connectionId: "connection_b",
      sourcePositionKey: "other-native-key",
      sourceVersion: "4",
      observedAt: at,
      evidenceRefs: ["evidence:source:b"],
    },
  });
  assert.notEqual(observationKey(first), observationKey(second));
  assert.equal(activePositionKey(first), activePositionKey(second));
});

test("an identical same-source replay collapses to one record", () => {
  const first = record();
  const result = mergePositionRecords([first, first]);
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.issues, []);
});

test("a newer observation supersedes only its exact source lineage", () => {
  const old = record();
  const next = record({
    source: { ...old.source, sourceVersion: "2", observedAt: "2026-08-22T10:00:01.000Z" },
    quantity: { amount: { units: "6", scale: 0 }, unitRef: "instrument_example" },
  });
  const result = mergePositionRecords([next, old]);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].quantity.amount.units, "6");
  assert.deepEqual(result.issues, []);
});

test("equal-time material divergence is a conflict with no guessed winner", () => {
  const first = record();
  const divergent = record({
    quantity: { amount: { units: "6", scale: 0 }, unitRef: "instrument_example" },
  });
  const result = mergePositionRecords([first, divergent]);
  assert.equal(result.records.length, 0);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, "IDENTITY_CONFLICT");
});

test("verified matching cross-source observations corroborate deterministically", () => {
  const first = record();
  const second = record({
    source: {
      sourceId: "source_b",
      connectionId: "connection_b",
      sourcePositionKey: "native-b",
      sourceVersion: "9",
      observedAt: at,
      evidenceRefs: ["evidence:source:b"],
    },
  });
  const left = mergePositionRecords([first, second]);
  const right = mergePositionRecords([second, first]);
  assert.deepEqual(left, right);
  assert.equal(left.records.length, 1);
  assert.deepEqual(left.issues, []);
  assert.deepEqual(left.records[0].source.evidenceRefs, ["evidence:source:a", "evidence:source:b"]);
});

test("non-verified cross-source collision remains a potential duplicate", () => {
  const lot = { state: "UNKNOWN", reason: "sources do not expose shared lineage", evidenceRefs: ["evidence:lot:unknown"] };
  const first = record({ economicLot: lot });
  const second = record({
    economicLot: lot,
    source: {
      sourceId: "source_b",
      connectionId: "connection_b",
      sourcePositionKey: "native-b",
      sourceVersion: "1",
      observedAt: at,
      evidenceRefs: ["evidence:source:b"],
    },
  });
  const result = mergePositionRecords([second, first]);
  assert.equal(result.records.length, 2);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, "POTENTIAL_DUPLICATE");
  assert.deepEqual(result.issues[0].positionIds, [first.positionId]);
  assert.deepEqual(result.issues[0].observationKeys, [observationKey(first), observationKey(second)].sort());
});

test("two commitments of one asset remain distinct by action slot", () => {
  const common = {
    positionType: "AGENT_COMMITMENT",
    accountingRole: "RESERVATION",
    valuationContribution: "NONE",
    economicLot: { state: "SOURCE_SCOPED", sourceId: "source_a", lotKey: "budget", evidenceRefs: ["evidence:budget"] },
  };
  const first = record({ ...common, positionSlotKey: "action-1" });
  const second = record({ ...common, positionSlotKey: "action-2", source: { ...first.source, sourcePositionKey: "entry-2" } });
  const result = mergePositionRecords([second, first]);
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.issues, []);
});
