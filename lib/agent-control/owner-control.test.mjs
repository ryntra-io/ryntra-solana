// Run from repo root: node --test lib/agent-control/owner-control.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const {
  AgentBudgetLedgerSchema,
  AgentOwnerPolicySchema,
  AgentOwnerMandateSchema,
  OwnerControlError,
  actionEvidenceProfile,
  buildOwnerActionQueueItem,
  buildGoldenRwaOwnerControl,
  budgetSnapshot,
  resolveOwnerAuthority,
} = await import("./owner-control.ts");
const { buildActionCase } = await import("./action-case.ts");
const { createGoldenRwaDemo } = await import("./golden-rwa-demo.ts");

const NOW = new Date("2026-08-21T12:00:00.000Z");
const OWNER = "owner:sample-treasury";
const SUBJECT = "sample-treasury-agent";
const ASSET = "Sample tokenized equity";
const CHAIN = "eip155:84532";

function coverage(enforcement = "OBSERVE_ONLY") {
  return {
    pathId: "external-base-wallet",
    label: "External Base wallet",
    enforcement,
    limitation:
      enforcement === "OBSERVE_ONLY"
        ? "The wallet can be called outside Ryntra; this path is observed only."
        : "The wallet enforces this exact mandate binding before it signs.",
  };
}

function policy(overrides = {}) {
  return AgentOwnerPolicySchema.parse({
    schemaVersion: "1.0.0",
    policyId: "golden-rwa-owner-policy",
    version: 1,
    ownerRef: OWNER,
    publishedAt: "2026-08-21T10:00:00.000Z",
    immutable: true,
    defaultAuthorizationMode: "PER_ACTION",
    emergencyPause: false,
    allowedSubjects: [SUBJECT],
    allowedActionClasses: ["TRANSFER"],
    allowedNetworks: [CHAIN],
    allowedAssets: [ASSET],
    allowedCounterparties: ["Sample issuer transfer agent"],
    limits: {
      perAction: { amount: "500", assetRef: ASSET },
      daily: { amount: "1000", assetRef: ASSET },
    },
    additionalEvidenceRequirements: ["issuer_allowlist"],
    executionPaths: [coverage()],
    knownBypassRoutes: [
      {
        routeId: "external-direct-call",
        pathId: "external-base-wallet",
        status: "OPEN",
        description: "The sample external wallet is not bound to Ryntra policy.",
      },
    ],
    unknownActionBehavior: "BLOCK",
    ...overrides,
  });
}

function mandate(overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    mandateId: "golden-rwa-owner-mandate",
    version: 1,
    ownerRef: OWNER,
    subjectRef: SUBJECT,
    policyRef: { id: "golden-rwa-owner-policy", version: 1 },
    state: "ACTIVE",
    immutable: true,
    actionClasses: ["TRANSFER"],
    networks: [CHAIN],
    assets: [{ assetRef: ASSET, maxAmount: "500" }],
    counterparties: ["Sample issuer transfer agent"],
    limits: {
      perAction: { amount: "500", assetRef: ASSET },
      daily: { amount: "1000", assetRef: ASSET },
    },
    evidenceRequirements: ["issuer_allowlist", "transfer_eligibility"],
    authorizationMode: "PER_ACTION",
    enforcementCoverage: [coverage()],
    knownBypassRoutes: [
      {
        routeId: "external-direct-call",
        pathId: "external-base-wallet",
        status: "OPEN",
        description: "The sample external wallet is not bound to Ryntra policy.",
      },
    ],
    technicalAuthority: null,
    validFrom: "2026-08-21T10:00:00.000Z",
    validUntil: "2026-08-21T14:00:00.000Z",
    ...overrides,
  };
}

function proposal(overrides = {}) {
  return {
    ownerRef: OWNER,
    subjectRef: SUBJECT,
    actionClass: "TRANSFER",
    network: CHAIN,
    assetRef: ASSET,
    amount: "500",
    counterpartyRef: "Sample issuer transfer agent",
    executionPath: "external-base-wallet",
    at: NOW,
    ...overrides,
  };
}

const mitigatedBypass = {
  routeId: "external-direct-call",
  pathId: "external-base-wallet",
  status: "MITIGATED",
  description: "The wallet-native binding applies even when the request bypasses Ryntra.",
};

test("every product action class owns a deterministic evidence profile and unknown fails closed", () => {
  const transfer = actionEvidenceProfile("TRANSFER");
  assert.equal(transfer.actionClass, "TRANSFER");
  assert.equal(transfer.canonicalClass, "VALUE_TRANSFER");
  assert.ok(transfer.requiredEvidence.includes("recipient_identity"));
  assert.ok(transfer.requiredEvidence.includes("asset_identity"));

  const unknown = resolveOwnerAuthority({
    policy: policy(),
    mandate: null,
    proposal: proposal({ actionClass: "NOT_A_CLASS" }),
  });
  assert.equal(unknown.decision, "BLOCKED");
  assert.deepEqual(unknown.reasonCodes, ["ACTION_CLASS_UNKNOWN"]);
});

test("PER_ACTION is the default and BOUNDED_MANDATE needs exact revocable technical authority", () => {
  const perActionMandate = AgentOwnerMandateSchema.parse(mandate());
  const consumer = resolveOwnerAuthority({
    policy: policy(),
    mandate: perActionMandate,
    proposal: proposal(),
  });
  assert.equal(consumer.decision, "PER_ACTION_REQUIRED");
  assert.equal(consumer.authorizationMode, "PER_ACTION");

  assert.equal(
    AgentOwnerMandateSchema.safeParse(
      mandate({ authorizationMode: "BOUNDED_MANDATE", technicalAuthority: null }),
    ).success,
    false,
    "a UI mode without a technical binding must not become authority",
  );
  assert.equal(
    AgentOwnerMandateSchema.safeParse(
      mandate({
        authorizationMode: "BOUNDED_MANDATE",
        technicalAuthority: {
          bindingId: "binding-observe-only",
          pathId: "external-base-wallet",
          authorityRef: "sample://wallet/permission",
          enforcement: "OBSERVE_ONLY",
          state: "ACTIVE",
          grantedAt: "2026-08-21T10:00:00.000Z",
          expiresAt: "2026-08-21T14:00:00.000Z",
          revocation: {
            method: "OWNER_WALLET",
            reference: "sample://wallet/revoke",
            state: "AVAILABLE",
          },
          evidenceRef: "sample://wallet/authority-proof",
        },
      }),
    ).success,
    false,
    "observe-only evidence is not delegated technical authority",
  );

  const bounded = AgentOwnerMandateSchema.parse(
    mandate({
      authorizationMode: "BOUNDED_MANDATE",
      enforcementCoverage: [coverage("WALLET_NATIVE_ENFORCED")],
      knownBypassRoutes: [mitigatedBypass],
      technicalAuthority: {
        bindingId: "binding-wallet-native",
        pathId: "external-base-wallet",
        authorityRef: "sample://wallet/permission",
        enforcement: "WALLET_NATIVE_ENFORCED",
        state: "ACTIVE",
        grantedAt: "2026-08-21T10:00:00.000Z",
        expiresAt: "2026-08-21T14:00:00.000Z",
        revocation: {
          method: "OWNER_WALLET",
          reference: "sample://wallet/revoke",
          state: "AVAILABLE",
        },
        evidenceRef: "sample://wallet/authority-proof",
      },
    }),
  );
  const allowed = resolveOwnerAuthority({
    policy: policy({
      executionPaths: [coverage("WALLET_NATIVE_ENFORCED")],
      knownBypassRoutes: [mitigatedBypass],
    }),
    mandate: bounded,
    proposal: proposal(),
  });
  assert.equal(allowed.decision, "ALLOWED_BY_MANDATE");
  assert.equal(allowed.authorizationMode, "BOUNDED_MANDATE");
  assert.equal(allowed.enforcement, "WALLET_NATIVE_ENFORCED");

  const redirected = resolveOwnerAuthority({
    policy: policy({
      executionPaths: [coverage("WALLET_NATIVE_ENFORCED")],
      knownBypassRoutes: [mitigatedBypass],
    }),
    mandate: bounded,
    proposal: proposal({ executionPath: "unbound-provider-path" }),
  });
  assert.equal(redirected.decision, "BLOCKED");
  assert.ok(redirected.reasonCodes.includes("TECHNICAL_AUTHORITY_PATH_MISMATCH"));
});

test("reserved pending value and committed escrowed value both reduce availability", () => {
  const ledger = AgentBudgetLedgerSchema.parse({
    schemaVersion: "1.0.0",
    ledgerId: "golden-rwa-daily-budget",
    version: 1,
    ownerRef: OWNER,
    mandateRef: { id: "golden-rwa-owner-mandate", version: 1 },
    assetRef: ASSET,
    period: {
      startsAt: "2026-08-21T00:00:00.000Z",
      endsAt: "2026-08-22T00:00:00.000Z",
    },
    allocated: "1000",
    available: "250",
    entries: [
      { entryId: "entry-pending", actionId: "action-pending", state: "RESERVED", amount: "500", updatedAt: NOW.toISOString() },
      { entryId: "entry-escrowed", actionId: "action-escrowed", state: "COMMITTED", amount: "150", updatedAt: NOW.toISOString() },
      { entryId: "entry-settled", actionId: "action-settled", state: "SETTLED", amount: "100", updatedAt: NOW.toISOString() },
      { entryId: "entry-released", actionId: "action-released", state: "RELEASED", amount: "50", updatedAt: NOW.toISOString() },
    ],
  });
  const snapshot = budgetSnapshot(ledger);
  assert.deepEqual(
    {
      allocated: snapshot.allocated,
      available: snapshot.available,
      reserved: snapshot.reserved,
      committed: snapshot.committed,
      settled: snapshot.settled,
      released: snapshot.released,
    },
    {
      allocated: "1000",
      available: "250",
      reserved: "500",
      committed: "150",
      settled: "100",
      released: "50",
    },
  );

  assert.throws(
    () => budgetSnapshot({ ...ledger, available: "400" }),
    /BUDGET_RECONCILIATION_DRIFT/,
    "the ledger must not pretend escrowed value is available",
  );
});

test("the queue rejects a lower or foreign ledger instead of understating action exposure", () => {
  const actionCase = buildActionCase(createGoldenRwaDemo(NOW).fresh);
  const control = buildGoldenRwaOwnerControl(actionCase);
  const build = (ledger, mandate = control.mandate) =>
    buildOwnerActionQueueItem({
      actionCase,
      policy: control.policy,
      mandate,
      ledger,
      executionPath: "external-base-wallet",
    });
  const rejects = (ledger, reasonCode, mandate = control.mandate) => {
    assert.throws(
      () => build(ledger, mandate),
      (error) => {
        assert.ok(error instanceof OwnerControlError);
        assert.equal(error.reasonCode, reasonCode);
        return true;
      },
    );
  };

  rejects(
    { ...control.ledger, ownerRef: "owner:foreign-treasury" },
    "BUDGET_OWNER_MISMATCH",
  );
  rejects(
    {
      ...control.ledger,
      mandateRef: { id: "foreign-mandate", version: control.mandate.version },
    },
    "BUDGET_MANDATE_MISMATCH",
  );
  rejects(
    { ...control.ledger, assetRef: "Foreign asset" },
    "BUDGET_ASSET_MISMATCH",
  );

  const underReserved = control.ledger.entries.map((entry) =>
    entry.actionId === actionCase.id ? { ...entry, amount: "100" } : entry,
  );
  rejects(
    {
      ...control.ledger,
      available: "650",
      entries: underReserved,
    },
    "BUDGET_ACTION_AMOUNT_MISMATCH",
  );
  rejects(control.ledger, "BUDGET_MANDATE_MISSING", null);
  rejects(
    {
      ...control.ledger,
      period: {
        startsAt: "2026-08-20T00:00:00.000Z",
        endsAt: "2026-08-21T11:00:00.000Z",
      },
    },
    "BUDGET_PERIOD_MISMATCH",
  );
  rejects(
    { ...control.ledger, allocated: "1100", available: "350" },
    "BUDGET_ALLOCATION_LIMIT_EXCEEDED",
  );

  const released = control.ledger.entries.map((entry) =>
    entry.actionId === actionCase.id ? { ...entry, state: "RELEASED" } : entry,
  );
  rejects(
    { ...control.ledger, available: "750", entries: released },
    "BUDGET_ACTION_ENTRY_RELEASED",
  );
});

test("the Golden RWA queue is one Action Case with PER_ACTION and pessimistic budget exposure", () => {
  const preview = createGoldenRwaDemo(NOW).fresh;
  const actionCase = buildActionCase(preview);
  const control = buildGoldenRwaOwnerControl(actionCase);

  assert.equal(control.queue.actionId, actionCase.id);
  assert.equal(control.queue.policyVersion, actionCase.policyVersion);
  assert.equal(control.queue.authorizationMode, "PER_ACTION");
  assert.equal(control.queue.decision, "REVIEW");
  assert.equal(control.queue.queueState, "PENDING_REVIEW");
  assert.equal(control.queue.budget.reserved, "500");
  assert.equal(control.queue.budget.committed, "150");
  assert.equal(control.queue.budget.available, "250");
  assert.ok(control.queue.requiredEvidence.includes("recipient_identity"));
  assert.ok(control.queue.reasonCodes.includes("EXACT_HUMAN_AUTHORIZATION_REQUIRED"));
});
