import assert from "node:assert/strict";
import test from "node:test";

import {
  MANDATE_SCOPE_KINDS,
  compileResearchMandate,
  mandateState,
  monitoringAllows,
} from "./mandate.ts";

const ownedSource = {
  sourceId: "arcus-perps",
  label: "Arcus positions",
  rights: {
    entitlement: "OWN_ACCOUNT",
    storage: true,
    aiProcessing: true,
    alerting: true,
    redistribution: false,
  },
  freshnessPolicy: { maxAgeSeconds: 120 },
};

const base = {
  mandateId: "home",
  ownerRef: "owner-1",
  effectiveFrom: "2026-08-23T09:00:00.000Z",
  reviewAt: "2026-09-23T09:00:00.000Z",
  expiresAt: "2026-11-23T09:00:00.000Z",
  scope: [{ kind: "HOLDING", ref: "arcus:perp:TSLA-USD", label: "TSLA-USD" }],
  sources: [ownedSource],
  freshness: { maxAgeSeconds: 120 },
  materiality: [
    { factKey: "markPrice", comparison: "RELATIVE_BPS", value: 500, severity: "MEDIUM", scopeKinds: ["HOLDING"] },
  ],
  cadence: { mode: "SCHEDULE", cron: "0 7 * * *", quietHours: null, cooldownSeconds: 3600 },
  budgets: { dataReadsPerDay: 24, aiCallsPerDay: 0, maxAlertsPerDay: 6 },
  notificationChannels: ["surface"],
};

const compiled = () => {
  const result = compileResearchMandate(base);
  assert.equal(result.ok, true, result.ok ? "" : `${result.code}: ${result.reason}`);
  return result.mandate;
};

test("a mandate compiles with every declared field and a content version", () => {
  const mandate = compiled();
  assert.equal(mandate.mandateId, "home");
  assert.equal(mandate.scope.length, 1);
  assert.equal(mandate.sources.length, 1);
  assert.equal(mandate.freshness.maxAgeSeconds, 120);
  assert.equal(mandate.materiality.length, 1);
  assert.equal(mandate.cadence.cron, "0 7 * * *");
  assert.equal(mandate.budgets.maxAlertsPerDay, 6);
  assert.deepEqual(mandate.notificationChannels, ["surface"]);
  assert.equal(mandate.expiresAt, "2026-11-23T09:00:00.000Z");
  assert.match(mandate.version, /^v1-[0-9a-f]{12}$/);
});

test("the version is content-addressed: same inputs, same version; changed materiality, new version", () => {
  const first = compiled();
  const again = compiled();
  assert.equal(first.version, again.version);

  const moved = compileResearchMandate({
    ...base,
    materiality: [{ factKey: "markPrice", comparison: "RELATIVE_BPS", value: 250, severity: "MEDIUM", scopeKinds: ["HOLDING"] }],
  });
  assert.equal(moved.ok, true);
  assert.notEqual(moved.mandate.version, first.version);
});

test("scope order does not change the version, because a set is not a sequence", () => {
  const one = compileResearchMandate({
    ...base,
    scope: [
      { kind: "HOLDING", ref: "b", label: "B" },
      { kind: "WATCHLIST", ref: "a", label: "A" },
    ],
  });
  const other = compileResearchMandate({
    ...base,
    scope: [
      { kind: "WATCHLIST", ref: "a", label: "A" },
      { kind: "HOLDING", ref: "b", label: "B" },
    ],
  });
  assert.equal(one.ok && other.ok, true);
  assert.equal(one.mandate.version, other.mandate.version);
  assert.deepEqual(one.mandate.scope, other.mandate.scope);
});

test("monitoring scope never expands execution authority", () => {
  const mandate = compiled();
  assert.equal(mandate.executionAuthority, "NONE");
  for (const verb of ["READ", "MONITOR", "INVESTIGATE", "ALERT"]) {
    assert.equal(monitoringAllows(mandate, verb), true, `${verb} is a monitoring verb`);
  }
  for (const verb of ["SIGN", "EXECUTE", "TRANSFER", "AUTHORIZE", "WITHDRAW", "ORDER"]) {
    assert.equal(monitoringAllows(mandate, verb), false, `${verb} must never be allowed`);
  }
});

test("no input can smuggle execution authority into a compiled mandate", () => {
  const result = compileResearchMandate({
    ...base,
    executionAuthority: "FULL",
    notificationChannels: ["surface"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.mandate.executionAuthority, "NONE");
});

test("data rights precede ingestion: a source with no entitlement is refused", () => {
  const result = compileResearchMandate({
    ...base,
    sources: [{ ...ownedSource, rights: { ...ownedSource.rights, entitlement: "NONE" } }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "SOURCE_NOT_ENTITLED");
});

test("untrusted public content may be read but never redistributed or used for AI processing", () => {
  const refused = compileResearchMandate({
    ...base,
    sources: [{
      ...ownedSource,
      sourceId: "public-web",
      rights: { entitlement: "PUBLIC_UNTRUSTED", storage: true, aiProcessing: true, alerting: true, redistribution: false },
    }],
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "RIGHTS_EXCEED_ENTITLEMENT");

  const accepted = compileResearchMandate({
    ...base,
    sources: [{
      ...ownedSource,
      sourceId: "public-web",
      rights: { entitlement: "PUBLIC_UNTRUSTED", storage: false, aiProcessing: false, alerting: false, redistribution: false },
    }],
  });
  assert.equal(accepted.ok, true);
});

test("a provider's own public API is first-party evidence and may alert", () => {
  const result = compileResearchMandate({
    ...base,
    sources: [{
      ...ownedSource,
      sourceId: "arcus-markets",
      rights: { entitlement: "PROVIDER_PUBLIC", storage: true, aiProcessing: true, alerting: true, redistribution: false },
    }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.mandate.sources[0].rights.entitlement, "PROVIDER_PUBLIC");

  /* And it is still not licensed for redistribution. */
  const republished = compileResearchMandate({
    ...base,
    sources: [{
      ...ownedSource,
      sourceId: "arcus-markets",
      rights: { entitlement: "PROVIDER_PUBLIC", storage: true, aiProcessing: true, alerting: true, redistribution: true },
    }],
  });
  assert.equal(republished.ok, false);
  assert.equal(republished.code, "RIGHTS_EXCEED_ENTITLEMENT");
});

test("an unknown scope kind is refused rather than coerced", () => {
  const result = compileResearchMandate({ ...base, scope: [{ kind: "VIBES", ref: "x", label: "X" }] });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNKNOWN_SCOPE_KIND");
  assert.equal(MANDATE_SCOPE_KINDS.includes("VIBES"), false);
});

test("an empty scope is refused: a mandate that watches nothing is a mistake, not a calm state", () => {
  const result = compileResearchMandate({ ...base, scope: [] });
  assert.equal(result.ok, false);
  assert.equal(result.code, "EMPTY_SCOPE");
});

test("budgets must be whole non-negative counts", () => {
  for (const budgets of [
    { dataReadsPerDay: -1, aiCallsPerDay: 0, maxAlertsPerDay: 1 },
    { dataReadsPerDay: 1.5, aiCallsPerDay: 0, maxAlertsPerDay: 1 },
  ]) {
    const result = compileResearchMandate({ ...base, budgets });
    assert.equal(result.ok, false);
    assert.equal(result.code, "INVALID_BUDGET");
  }
});

test("every instant must carry an explicit offset", () => {
  const result = compileResearchMandate({ ...base, effectiveFrom: "2026-08-23 09:00:00" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_TIME");
});

test("expiry cannot precede the moment the mandate becomes effective", () => {
  const result = compileResearchMandate({ ...base, expiresAt: "2026-08-22T09:00:00.000Z" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_WINDOW");
});

test("a materiality threshold needs a value unless it measures a state change", () => {
  const missing = compileResearchMandate({
    ...base,
    materiality: [{ factKey: "markPrice", comparison: "RELATIVE_BPS", value: null, severity: "LOW", scopeKinds: null }],
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "INVALID_MATERIALITY");

  const stateChange = compileResearchMandate({
    ...base,
    materiality: [{ factKey: "oracleState", comparison: "STATE_CHANGE", value: null, severity: "HIGH", scopeKinds: null }],
  });
  assert.equal(stateChange.ok, true);
});

test("mandate state is read against a clock the caller supplies, never a hidden one", () => {
  const mandate = compiled();
  assert.equal(mandateState(mandate, "2026-08-24T09:00:00.000Z"), "ACTIVE");
  assert.equal(mandateState(mandate, "2026-10-01T09:00:00.000Z"), "REVIEW_DUE");
  assert.equal(mandateState(mandate, "2026-12-01T09:00:00.000Z"), "EXPIRED");
  assert.equal(mandateState(mandate, "2026-08-01T09:00:00.000Z"), "NOT_YET_EFFECTIVE");
  assert.equal(mandateState(mandate, "whenever"), "UNKNOWN");
});
