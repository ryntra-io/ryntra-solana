import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateSolanaCanaryIntent,
  SolanaCanaryBudgetSnapshotSchema,
  SolanaCanaryIntentSchema,
  SolanaCanaryPolicySchema,
  SolanaCanaryVerdictSchema,
  solanaCanaryPolicyDigest,
} from "./canary-policy.ts";
import { openCctpCanaryExposure, settleCctpCanaryExposure } from "./cctp-canary-exposure.ts";
import {
  CANARY_FALLBACK_POLICY,
  CANARY_FALLBACK_POLICY_ID,
  canaryFlowPermitted,
  canaryLedgerWritable,
  describeCanaryRuntime,
  reportCanaryRuntime,
  resetCanaryRuntimeReporting,
  resolveCanaryRuntime,
} from "./canary-runtime.ts";

/**
 * The deterministic closed fallback, and the line it must not let anyone cross.
 *
 * An unreadable owner-canary configuration stops refusing customers, and does
 * so as a declared degraded state rather than a silent stand-in for a healthy
 * policy. The owner's own instrument is disabled while it lasts, and it may not
 * be smuggled through as a customer action just because empty allowlists put
 * it outside the envelope.
 */

const VALID_ENV = {
  RYNTRA_SOLANA_CANARY_STATE: "PAUSED",
};

const BROKEN_ENV = {
  RYNTRA_SOLANA_CANARY_STATE: "SORT-OF-OPEN",
};

const AT = new Date("2026-09-03T18:00:00.000Z");

test("a readable configuration is strict, and an unreadable one is a declared fallback", () => {
  const healthy = resolveCanaryRuntime(VALID_ENV, AT);
  assert.equal(healthy.mode, "STRICT");
  assert.equal(healthy.reason, null);
  assert.notEqual(healthy.policy.policyId, CANARY_FALLBACK_POLICY_ID);

  const degraded = resolveCanaryRuntime(BROKEN_ENV, AT);
  assert.equal(degraded.mode, "FALLBACK_CLOSED");
  assert.equal(degraded.policy.policyId, CANARY_FALLBACK_POLICY_ID);
  assert.ok(degraded.reason && degraded.reason.length > 0, "a fallback must carry the exact parse failure");
  assert.equal(degraded.checkedAt, AT.toISOString());
});

test("resolving never throws, whatever the environment holds", () => {
  /* A customer path calls this. It may refuse nothing and it may crash on
     nothing, or the refusal simply moves from a 503 to a 500. */
  for (const env of [{}, BROKEN_ENV, { RYNTRA_SOLANA_CANARY_DESTINATIONS: "not-an-address" }]) {
    const runtime = resolveCanaryRuntime(env, AT);
    assert.ok(["STRICT", "FALLBACK_CLOSED"].includes(runtime.mode));
  }
});

test("the fallback is a schema-valid policy with a deterministic identity", () => {
  assert.doesNotThrow(() => SolanaCanaryPolicySchema.parse(CANARY_FALLBACK_POLICY));
  assert.equal(CANARY_FALLBACK_POLICY.policyId, "ryntra.solana.canary-policy.fallback-closed.v1");
  assert.equal(CANARY_FALLBACK_POLICY.state, "PAUSED");
  assert.equal(CANARY_FALLBACK_POLICY.totalLimitUsdMicros, "0");
  assert.match(CANARY_FALLBACK_POLICY.source.ref, /fallback/i);

  /* Deterministic, and distinct from any production policy. */
  const first = solanaCanaryPolicyDigest(CANARY_FALLBACK_POLICY);
  const again = resolveCanaryRuntime(BROKEN_ENV, AT).policyDigest;
  assert.equal(first, again);
  assert.match(first, /^0x[0-9a-f]{64}$/);
  assert.notEqual(first, solanaCanaryPolicyDigest(resolveCanaryRuntime(VALID_ENV, AT).policy));

  /* Every family is closed, so no action can be inside the envelope. */
  for (const family of Object.values(CANARY_FALLBACK_POLICY.families)) {
    assert.deepEqual(family.allowedDestinations, []);
    assert.deepEqual(family.allowedMints, []);
    assert.deepEqual(family.allowedPrograms, []);
    assert.equal(family.maximumUsdMicros, "0");
  }
});

test("the verdict the fallback produces is honest, and says so in CONFIG_VALID", () => {
  /*
   * Nothing is faked here: the fallback is a real policy artifact and the
   * ordinary evaluator reads it. What the owner decision requires falls out of
   * the artifact rather than being asserted into the verdict.
   */
  const budget = SolanaCanaryBudgetSnapshotSchema.parse({
    schema: "ryntra.solana.canary-budget-snapshot",
    schemaVersion: "1.0.0",
    /*
     * Derived from the policy under test, exactly as `readSolanaCanaryBudget`
     * derives it in production.
     *
     * This test first hand-wrote the real policy's id and ceiling here, so the
     * snapshot disagreed with the fallback and CONFIG_VALID came out UNKNOWN for
     * the wrong reason. A live degraded preview then answered PASS — in a signed
     * bundle, about a configuration nobody could read — because a fallback and
     * its own snapshot agree on both fields. The fixture now reproduces the
     * production shape, so the assertion below means what it says.
     */
    policyId: CANARY_FALLBACK_POLICY.policyId,
    readState: "AVAILABLE",
    storeBoundary: "DURABLE_MULTI_WRITER",
    totalLimitUsdMicros: CANARY_FALLBACK_POLICY.totalLimitUsdMicros,
    reservedUsdMicros: "0",
    spentUsdMicros: "0",
    feeReservedUsdMicros: "0",
    feeSpentUsdMicros: "0",
    families: Object.fromEntries(
      ["SEND", "ATA_CREATE", "SWAP", "CCTP", "TOKEN_2022"].map((family) => [
        family,
        { reservedUsdMicros: "0", spentUsdMicros: "0" },
      ]),
    ),
    observedAt: "2026-09-03T18:00:00.000Z",
  });
  const intent = SolanaCanaryIntentSchema.parse({
    schema: "ryntra.solana.canary-intent",
    schemaVersion: "1.0.0",
    intentId: "int_fallback_1",
    revision: 1,
    family: "SEND",
    network: "mainnet",
    destination: "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM",
    mints: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
    programs: ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"],
    principalUsdMicros: "1000000",
    feeReserveUsdMicros: "0",
    usdMicros: "1000000",
    valuation: {
      method: "USDC_NOMINAL",
      sourceRef: "solana:mainnet:mint:usdc",
      observedAt: "2026-09-03T18:00:00.000Z",
      validUntil: "2026-09-03T18:01:00.000Z",
    },
    humanApproval: "RECORDED",
  });

  const verdict = evaluateSolanaCanaryIntent({
    policy: CANARY_FALLBACK_POLICY,
    budget,
    intent,
    now: AT,
  });

  assert.doesNotThrow(() => SolanaCanaryVerdictSchema.parse(verdict));
  assert.equal(verdict.decision, "PAUSE");
  assert.equal(verdict.newRiskAllowed, false);
  assert.equal(verdict.scope.status, "OUTSIDE_ENVELOPE");
  assert.equal(verdict.scope.decidedBy, "TRANSFER_CAPABILITY");
  assert.equal(verdict.policyId, CANARY_FALLBACK_POLICY_ID);
  assert.equal(verdict.policyDigest, solanaCanaryPolicyDigest(CANARY_FALLBACK_POLICY));

  /* The one the owner decision names explicitly: a signed bundle may not claim
     a healthy configuration while running on a fallback. */
  const configValid = verdict.findings.find((entry) => entry.rule === "CONFIG_VALID");
  assert.ok(configValid, "the verdict lost its CONFIG_VALID finding");
  assert.notEqual(configValid.outcome, "PASS", "a signed bundle claimed a healthy configuration under a fallback");
  assert.ok(["PAUSE", "UNKNOWN"].includes(configValid.outcome), configValid.outcome);
  assert.match(configValid.detail, /could not be read/i, "the finding does not say why it is not configured");
});

test("a customer is never refused for the state of the founder's configuration", () => {
  for (const env of [VALID_ENV, BROKEN_ENV, {}]) {
    const runtime = resolveCanaryRuntime(env, AT);
    assert.deepEqual(canaryFlowPermitted(runtime, "CUSTOMER"), { ok: true }, JSON.stringify(env));
  }
});

test("an owner canary is refused while the configuration is unreadable", () => {
  /*
   * The asymmetry is the whole design. Empty allowlists put every action
   * outside the envelope, so without this line a real owner canary would run as
   * an ordinary transfer: real money, no reservation, no ceiling and no ledger
   * entry behind it.
   */
  const degraded = resolveCanaryRuntime(BROKEN_ENV, AT);
  const decision = canaryFlowPermitted(degraded, "OWNER_CANARY");
  assert.equal(decision.ok, false);
  assert.equal(decision.code, "OWNER_CANARY_UNAVAILABLE");
  assert.match(decision.reason, /could not be read/i);

  /* And permitted again the moment the configuration parses, with no manual step. */
  assert.deepEqual(canaryFlowPermitted(resolveCanaryRuntime(VALID_ENV, AT), "OWNER_CANARY"), { ok: true });
});

test("the ledger is writable only under a strict policy", () => {
  assert.equal(canaryLedgerWritable(resolveCanaryRuntime(VALID_ENV, AT)), true);
  assert.equal(canaryLedgerWritable(resolveCanaryRuntime(BROKEN_ENV, AT)), false);
});

test("the founder's report names the degradation and never blames it on customers", () => {
  const healthy = describeCanaryRuntime(resolveCanaryRuntime(VALID_ENV, AT));
  assert.equal(healthy.state, "HEALTHY");
  assert.equal(healthy.ownerCanaries, "ENABLED");
  assert.equal(healthy.budgetWrites, "ENABLED");

  const degraded = describeCanaryRuntime(resolveCanaryRuntime(BROKEN_ENV, AT));
  assert.equal(degraded.state, "DEGRADED");
  assert.equal(degraded.label, "DEGRADED · FALLBACK CLOSED");
  assert.equal(degraded.ownerCanaries, "DISABLED");
  assert.equal(degraded.budgetWrites, "DISABLED");
  assert.ok(degraded.reason && degraded.reason.length > 0);
  assert.equal(degraded.checkedAt, AT.toISOString());

  /* The claim the whole row rests on, in both states. */
  for (const report of [healthy, degraded]) {
    assert.equal(report.customerMoneyFlows, "UNAFFECTED");
  }
});

test("recovery needs no manual step", () => {
  /* A deployment that is repaired reports healthy on the next read, and the
     ledger is writable again without anybody rewriting it. */
  assert.equal(resolveCanaryRuntime(BROKEN_ENV, AT).mode, "FALLBACK_CLOSED");
  const repaired = resolveCanaryRuntime(VALID_ENV, AT);
  assert.equal(repaired.mode, "STRICT");
  assert.equal(canaryLedgerWritable(repaired), true);
  assert.equal(describeCanaryRuntime(repaired).state, "HEALTHY");
});

test("the degradation is logged once per transition, not once per request", () => {
  resetCanaryRuntimeReporting();
  const lines = [];
  const sink = (line) => lines.push(line);

  const degraded = resolveCanaryRuntime(BROKEN_ENV, AT);
  assert.equal(reportCanaryRuntime(degraded, sink), true, "the first degraded read must be reported");
  assert.equal(reportCanaryRuntime(degraded, sink), false, "a repeat must not be reported again");
  assert.equal(lines.length, 1);

  const payload = JSON.parse(lines[0].replace("[solana-canary] ", ""));
  assert.equal(payload.event, "owner_canary_policy_state");
  assert.equal(payload.state, "DEGRADED");
  assert.equal(payload.ownerCanaries, "DISABLED");
  assert.equal(payload.budgetWrites, "DISABLED");
  assert.equal(payload.customerMoneyFlows, "UNAFFECTED");
  assert.ok(payload.reason && payload.reason.length > 0);

  /* Recovery is a transition too, and is worth exactly one line. */
  assert.equal(reportCanaryRuntime(resolveCanaryRuntime(VALID_ENV, AT), sink), true);
  assert.equal(JSON.parse(lines[1].replace("[solana-canary] ", "")).state, "HEALTHY");
  resetCanaryRuntimeReporting();
});

test("an ordinary customer action touches the canary ledger not at all", () => {
  /*
   * The claim `001C` rests on, tested against a store that fails loudly if it is
   * used: a stranger's transfer must neither reserve nor spend the founder's
   * twenty dollars, and must not be able to exhaust it for him by repeating.
   */
  const forbidden = () => {
    throw new Error("a customer action reached the owner-canary ledger");
  };
  const store = new Proxy({}, { get: forbidden });

  const outside = {
    schema: "ryntra.solana.canary-verdict",
    schemaVersion: "1.0.0",
    decision: "BLOCK",
    scope: { status: "OUTSIDE_ENVELOPE", decidedBy: "TRANSFER_CAPABILITY", detail: "x" },
  };

  return Promise.all([
    openCctpCanaryExposure({
      store,
      policy: CANARY_FALLBACK_POLICY,
      canaryIntent: {},
      canaryVerdict: outside,
    }).then((exposure) => {
      assert.equal(exposure.kind, "OUT_OF_SCOPE", "an outside action opened an exposure");
      return settleCctpCanaryExposure({
        store,
        policy: CANARY_FALLBACK_POLICY,
        exposure,
        outcome: { kind: "CONFIRMED_CLEAN", signature: "sig" },
      });
    }).then((settlement) => {
      assert.equal(settlement.action, "NONE", "an outside action settled something");
      assert.equal(settlement.failure, null);
    }),
    /* Repeating it changes nothing, which is what "cannot exhaust" means. */
    openCctpCanaryExposure({
      store,
      policy: CANARY_FALLBACK_POLICY,
      canaryIntent: {},
      canaryVerdict: outside,
    }).then((again) => assert.equal(again.kind, "OUT_OF_SCOPE")),
  ]);
});
