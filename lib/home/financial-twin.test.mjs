import assert from "node:assert/strict";
import test from "node:test";

import { addWatchConnection, emptyHomeConnectionState, revokeConnection } from "./connections.ts";
import { createInvestorContextVersion } from "./investor-context.ts";
import {
  HOME_LOCAL_MAX_BYTES,
  emptyHomeLocalEnvelope,
  encodeHomeLocalEnvelope,
  parseHomeLocalEnvelope,
  projectFinancialTwin,
} from "./financial-twin.ts";

const ownerRef = "owner_0123456789abcdef";
const contextDraft = {
  displayCurrency: "USD",
  horizon: "UNDECLARED",
  liquidityNeed: "MEDIUM",
  lossCapacity: "LOW",
  riskTolerance: "MEDIUM",
  goals: ["CAPITAL_PRESERVATION"],
  excludedActivities: ["AUTOMATED_EXECUTION"],
  notes: "",
};

test("the empty Financial Twin states missing context and exact-action-only authority", () => {
  const envelope = emptyHomeLocalEnvelope(ownerRef, "2026-08-22T03:00:00.000Z");
  const twin = projectFinancialTwin({
    identity: {
      authenticated: true,
      subjectKind: "TELEGRAM",
      identityWallet: null,
      telegramVerified: true,
    },
    envelope,
    venueCredentials: [],
  });

  assert.deepEqual(twin.identity, {
    authenticated: true,
    subjectKind: "TELEGRAM",
    walletOwnership: "NOT_PROVEN_IN_THIS_SESSION",
    identityWallet: null,
  });
  assert.deepEqual(twin.data, { active: 0, revoked: 0, scopes: [] });
  assert.equal(twin.context.state, "MISSING");
  assert.equal(twin.context.version, null);
  assert.deepEqual(twin.authority, {
    state: "EXACT_ACTION_ONLY",
    granted: false,
    owner: "ACTION_CASE_AGENT_CONTROL",
  });
  assert.equal(Object.hasOwn(twin, "portfolioValue"), false);
  assert.equal(Object.hasOwn(twin, "riskVerdict"), false);
});

test("the projection counts active and revoked reads without promoting venue credentials", () => {
  const baseConnections = emptyHomeConnectionState(ownerRef);
  const first = addWatchConnection(baseConnections, {
    network: "EVM",
    address: "0x1111111111111111111111111111111111111111",
    label: "Primary watch",
    scopes: ["BALANCES", "POSITIONS"],
  }, { id: "conn_001", now: "2026-08-22T03:01:00.000Z" });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = addWatchConnection(first.state, {
    network: "SOLANA",
    address: "11111111111111111111111111111111",
    label: "Solana watch",
    scopes: ["ASSET_EVIDENCE"],
  }, { id: "conn_002", now: "2026-08-22T03:02:00.000Z" });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  const revoked = revokeConnection(second.state, "conn_002", "2026-08-22T03:03:00.000Z");
  assert.equal(revoked.ok, true);
  if (!revoked.ok) return;

  const context = createInvestorContextVersion([], contextDraft, {
    id: "ictx_001",
    now: "2026-08-22T03:04:00.000Z",
  });
  assert.equal(context.ok, true);
  if (!context.ok) return;

  const envelope = {
    ...emptyHomeLocalEnvelope(ownerRef, "2026-08-22T03:00:00.000Z"),
    connections: revoked.state,
    investorContexts: context.history,
    updatedAt: "2026-08-22T03:04:00.000Z",
  };
  const twin = projectFinancialTwin({
    identity: {
      authenticated: true,
      subjectKind: "WALLET",
      identityWallet: "0x2222222222222222222222222222222222222222",
      telegramVerified: false,
    },
    envelope,
    venueCredentials: [{ provider: "ARCUS", state: "ACTIVE", scopes: ["SPOT_REQUEST_SIGNING"] }],
  });

  assert.deepEqual(twin.data, {
    active: 1,
    revoked: 1,
    scopes: ["BALANCES", "POSITIONS"],
  });
  assert.deepEqual(twin.venues, { active: 1, providers: ["ARCUS"] });
  assert.equal(twin.authority.granted, false);
  assert.equal(twin.context.state, "PARTIAL");
  assert.equal(twin.context.version, 1);
  assert.deepEqual(twin.context.missingFields, ["horizon"]);
});

test("the local envelope round-trips only for its exact owner", () => {
  const envelope = emptyHomeLocalEnvelope(ownerRef, "2026-08-22T03:00:00.000Z");
  const encoded = encodeHomeLocalEnvelope(envelope);
  assert.equal(parseHomeLocalEnvelope(encoded, ownerRef).ok, true);
  assert.deepEqual(parseHomeLocalEnvelope(encoded, "owner_foreign"), {
    ok: false,
    error: "FOREIGN_OWNER",
  });
});

test("corrupt, future and oversized browser state fail closed", () => {
  assert.deepEqual(parseHomeLocalEnvelope("{", ownerRef), { ok: false, error: "INVALID_JSON" });
  assert.deepEqual(
    parseHomeLocalEnvelope(JSON.stringify({ schemaVersion: 2, ownerRef }), ownerRef),
    { ok: false, error: "FUTURE_SCHEMA" },
  );
  assert.deepEqual(
    parseHomeLocalEnvelope("x".repeat(HOME_LOCAL_MAX_BYTES + 1), ownerRef),
    { ok: false, error: "TOO_LARGE" },
  );
});

test("connection records cannot smuggle private key material into the Financial Twin", () => {
  const envelope = emptyHomeLocalEnvelope(ownerRef, "2026-08-22T03:00:00.000Z");
  const hostile = JSON.stringify({
    ...envelope,
    connections: {
      ...envelope.connections,
      records: [{
        id: "conn_001",
        kind: "WATCH_ONLY",
        state: "ACTIVE",
        network: "EVM",
        address: "0x1111111111111111111111111111111111111111",
        label: "Hostile",
        scopes: ["BALANCES"],
        source: "USER_DECLARED",
        ownership: "UNPROVEN",
        authority: "NONE",
        storage: "THIS_BROWSER",
        createdAt: "2026-08-22T03:00:00.000Z",
        revokedAt: null,
        privateKey: "secret",
      }],
    },
  });
  assert.deepEqual(parseHomeLocalEnvelope(hostile, ownerRef), {
    ok: false,
    error: "INVALID_STATE",
  });
});
