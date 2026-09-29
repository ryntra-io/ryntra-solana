import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  evaluateSolanaCanaryIntent,
  resolveSolanaCanaryPolicy,
  verifySolanaCanaryVerdictBinding,
  SolanaCanaryBudgetSnapshotSchema,
  SolanaCanaryIntentSchema,
  SolanaCanaryPolicySchema,
} from "./canary-policy.ts";
import { verifySolanaOutcomeReceipt } from "./receipt.ts";

const DESTINATION = "ATvsQx9F1stmRoHhs1e7ipzvRB3gtUcDuy6mTFzv3guu";
const OTHER_DESTINATION = "11111111111111111111111111111111";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const JUPITER_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const BASE_USDC = "eip155:8453:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_DESTINATION = "eip155:8453:0x1111111111111111111111111111111111111111";
const SOLANA_CCTP_PROGRAM = "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe";
const BASE_CCTP_PROGRAM = "eip155:8453:0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";

const LIMITS = {
  SEND: { minimumUsdMicros: "0", maximumUsdMicros: "1000000" },
  ATA_CREATE: { minimumUsdMicros: "0", maximumUsdMicros: "500000" },
  SWAP: { minimumUsdMicros: "2000000", maximumUsdMicros: "5000000" },
  CCTP: { minimumUsdMicros: "2000000", maximumUsdMicros: "5000000" },
  TOKEN_2022: { minimumUsdMicros: "0", maximumUsdMicros: "2000000" },
};

const BASE_POLICY = SolanaCanaryPolicySchema.parse({
  schema: "ryntra.solana.canary-policy",
  schemaVersion: "1.0.0",
  policyId: "owner-mainnet-canary-v1",
  state: "OPEN",
  totalLimitUsdMicros: "20000000",
  valuationMaxAgeSeconds: 60,
  families: {
    SEND: {
      ...LIMITS.SEND,
      allowedDestinations: [DESTINATION],
      allowedMints: [USDC],
      allowedPrograms: [TOKEN_PROGRAM],
      requireHumanApproval: true,
    },
    ATA_CREATE: {
      ...LIMITS.ATA_CREATE,
      allowedDestinations: [DESTINATION],
      allowedMints: [USDC],
      allowedPrograms: [TOKEN_PROGRAM, ATA_PROGRAM],
      requireHumanApproval: true,
    },
    SWAP: {
      ...LIMITS.SWAP,
      allowedDestinations: [DESTINATION],
      allowedMints: [USDC, WSOL],
      allowedPrograms: [JUPITER_PROGRAM],
      requireHumanApproval: true,
    },
    CCTP: {
      ...LIMITS.CCTP,
      allowedDestinations: [DESTINATION],
      allowedMints: [USDC],
      allowedPrograms: [TOKEN_PROGRAM],
      requireHumanApproval: true,
    },
    TOKEN_2022: {
      ...LIMITS.TOKEN_2022,
      allowedDestinations: [DESTINATION],
      allowedMints: [USDC],
      allowedPrograms: [TOKEN_PROGRAM],
      requireHumanApproval: true,
    },
  },
  source: {
    ref: "owner:decision:2026-08-27:solana-canary",
    label: "Founder-approved Solana owner-canary policy",
  },
});

function familyTotals(value = "0") {
  return {
    SEND: { reservedUsdMicros: value, spentUsdMicros: "0" },
    ATA_CREATE: { reservedUsdMicros: "0", spentUsdMicros: "0" },
    SWAP: { reservedUsdMicros: "0", spentUsdMicros: "0" },
    CCTP: { reservedUsdMicros: "0", spentUsdMicros: "0" },
    TOKEN_2022: { reservedUsdMicros: "0", spentUsdMicros: "0" },
  };
}

const BASE_BUDGET = SolanaCanaryBudgetSnapshotSchema.parse({
  schema: "ryntra.solana.canary-budget-snapshot",
  schemaVersion: "1.0.0",
  policyId: BASE_POLICY.policyId,
  readState: "AVAILABLE",
  storeBoundary: "DURABLE_MULTI_WRITER",
  totalLimitUsdMicros: "20000000",
  reservedUsdMicros: "0",
  spentUsdMicros: "0",
  feeReservedUsdMicros: "0",
  feeSpentUsdMicros: "0",
  families: familyTotals(),
  observedAt: "2026-08-27T14:00:00.000Z",
});

const BASE_INTENT = SolanaCanaryIntentSchema.parse({
  schema: "ryntra.solana.canary-intent",
  schemaVersion: "1.0.0",
  intentId: "int_canary_send_1",
  revision: 1,
  family: "SEND",
  network: "mainnet",
  destination: DESTINATION,
  mints: [USDC],
  programs: [TOKEN_PROGRAM],
  principalUsdMicros: "1000000",
  feeReserveUsdMicros: "0",
  usdMicros: "1000000",
  valuation: {
    method: "USDC_NOMINAL",
    sourceRef: "solana:mainnet:mint:usdc",
    observedAt: "2026-08-27T14:00:00.000Z",
    validUntil: "2026-08-27T14:01:00.000Z",
  },
  humanApproval: "RECORDED",
});

function evaluate({ policy = BASE_POLICY, budget = BASE_BUDGET, intent = BASE_INTENT, now = "2026-08-27T14:00:30.000Z" } = {}) {
  return evaluateSolanaCanaryIntent({ policy, budget, intent, now: new Date(now) });
}

test("an EVM destination matches whatever case it was written in, and base58 still does not", () => {
  /* The plan lowercases the EVM destination it puts in the intent; every block
     explorer shows the checksummed form, which is what a person pastes into the
     environment. An exact comparison makes those two the same account written
     two ways and refuses the transfer with a permanent BLOCK that reads as a
     policy decision. Solana addresses are excluded on purpose: base58 is
     case-sensitive, and folding it would let a near-miss through. */
  const checksummed = "eip155:8453:0x28b5A0e9C621a5BadaA536219b3a228C8168CF5D";
  const lowercased = checksummed.toLowerCase();

  const policy = {
    ...BASE_POLICY,
    families: {
      ...BASE_POLICY.families,
      CCTP: { ...BASE_POLICY.families.CCTP, allowedDestinations: [checksummed] },
    },
  };
  const intent = SolanaCanaryIntentSchema.parse({
    ...BASE_INTENT,
    intentId: "int_canary_cctp_case",
    family: "CCTP",
    destination: lowercased,
    principalUsdMicros: "2000000",
    usdMicros: "2000000",
  });

  const matched = evaluate({ policy, intent });
  assert.equal(
    matched.findings.find((finding) => finding.rule === "DESTINATION_ALLOWLISTED")?.outcome,
    "PASS",
    "the same EVM account written in two cases must be one account",
  );

  /* And the fold must not reach base58: a Solana destination differing only in
     case is a different account and stays blocked. */
  const solanaPolicy = {
    ...BASE_POLICY,
    families: {
      ...BASE_POLICY.families,
      SEND: { ...BASE_POLICY.families.SEND, allowedDestinations: [DESTINATION] },
    },
  };
  const swappedCase = DESTINATION.slice(0, -1) + (DESTINATION.slice(-1) === "h" ? "H" : "h");
  const nearMiss = SolanaCanaryIntentSchema.parse({ ...BASE_INTENT, intentId: "int_canary_near", destination: swappedCase });
  assert.equal(
    evaluate({ policy: solanaPolicy, intent: nearMiss }).findings.find((f) => f.rule === "DESTINATION_ALLOWLISTED")?.outcome,
    "BLOCK",
    "a base58 address that differs only in case is a different account",
  );
});

test("the emergency stop drill pauses new risk and releasing it restores the same allowed intent", () => {
  const paused = evaluate({ policy: { ...BASE_POLICY, state: "PAUSED" } });
  assert.equal(paused.decision, "PAUSE");
  assert.equal(paused.newRiskAllowed, false);
  assert.equal(paused.findings.find((finding) => finding.rule === "EMERGENCY_STOP")?.outcome, "PAUSE");

  const receipt = JSON.parse(readFileSync("lib/solana/fixtures/receipt-solana-matched-signed.json", "utf8"));
  const verification = verifySolanaOutcomeReceipt(receipt);
  assert.equal(verification.recognised, true, "the kill switch must not gate receipt reads");
  assert.equal(verification.schema.valid, true);

  const released = evaluate();
  assert.equal(released.decision, "ALLOW");
  assert.equal(released.newRiskAllowed, true);
});

test("family and total ceilings are engine refusals", () => {
  const family = evaluate({
    intent: {
      ...BASE_INTENT,
      principalUsdMicros: "1000001",
      feeReserveUsdMicros: "0",
      usdMicros: "1000001",
    },
  });
  assert.equal(family.decision, "BLOCK");
  assert.equal(family.findings.find((finding) => finding.rule === "FAMILY_LIMIT")?.outcome, "BLOCK");

  const budget = SolanaCanaryBudgetSnapshotSchema.parse({
    ...BASE_BUDGET,
    reservedUsdMicros: "19500000",
    families: familyTotals("19500000"),
  });
  const total = evaluate({ budget });
  assert.equal(total.decision, "BLOCK");
  assert.equal(total.findings.find((finding) => finding.rule === "TOTAL_LIMIT")?.outcome, "BLOCK");
});

test("family limits use principal while the package ceiling includes fee and rent reserve", () => {
  const feeAware = SolanaCanaryIntentSchema.parse({
    ...BASE_INTENT,
    principalUsdMicros: "1000000",
    feeReserveUsdMicros: "25000",
    usdMicros: "1025000",
  });
  const budget = SolanaCanaryBudgetSnapshotSchema.parse({
    ...BASE_BUDGET,
    reservedUsdMicros: "19000000",
    feeReservedUsdMicros: "18000000",
    families: familyTotals("1000000"),
  });
  const verdict = evaluate({ intent: feeAware, budget });
  assert.equal(verdict.findings.find((finding) => finding.rule === "FAMILY_LIMIT")?.outcome, "BLOCK");
  assert.equal(verdict.findings.find((finding) => finding.rule === "TOTAL_LIMIT")?.outcome, "BLOCK");

  const withinFamily = evaluate({ intent: feeAware });
  assert.equal(withinFamily.findings.find((finding) => finding.rule === "FAMILY_LIMIT")?.outcome, "PASS");
  assert.equal(withinFamily.findings.find((finding) => finding.rule === "TOTAL_LIMIT")?.outcome, "PASS");
});

test("destination, mint and program allowlists fail closed as BLOCK", () => {
  const cases = [
    [{ ...BASE_INTENT, destination: OTHER_DESTINATION }, "DESTINATION_ALLOWLISTED"],
    [{ ...BASE_INTENT, mints: [WSOL] }, "MINTS_ALLOWLISTED"],
    [{ ...BASE_INTENT, programs: [ATA_PROGRAM] }, "PROGRAMS_ALLOWLISTED"],
  ];
  for (const [intent, rule] of cases) {
    const verdict = evaluate({ intent });
    assert.equal(verdict.decision, "BLOCK", rule);
    assert.equal(verdict.findings.find((finding) => finding.rule === rule)?.outcome, "BLOCK", rule);
  }
});

/**
 * A verdict that is signed into evidence has to say what it was about.
 *
 * The membership rules ask whether the owner ever recorded *this* destination,
 * mint, program set and approval as a canary action. An action that fails them
 * was never inside the envelope, and since 2026-08-29 an ordinary user-signed
 * Send is decided by the transfer-capability classifier instead — so a `BLOCK`
 * carried into a receipt with no scope beside it reads as a refusal somebody
 * overrode. It was not one, and the record must not need a footnote to say so.
 */
test("the verdict states whether the action was ever inside the envelope it judges", () => {
  const inside = evaluate({ intent: BASE_INTENT });
  assert.equal(inside.scope.status, "INSIDE_ENVELOPE");
  assert.equal(inside.scope.decidedBy, "OWNER_CANARY");

  for (const outsider of [
    { ...BASE_INTENT, destination: OTHER_DESTINATION },
    { ...BASE_INTENT, mints: [WSOL] },
    { ...BASE_INTENT, programs: [ATA_PROGRAM] },
  ]) {
    const verdict = evaluate({ intent: outsider });
    assert.equal(verdict.scope.status, "OUTSIDE_ENVELOPE");
    assert.equal(verdict.scope.decidedBy, "TRANSFER_CAPABILITY");
    assert.match(verdict.scope.detail, /is not the gate/);
  }

  /* A ceiling is judgement, not membership: an action the owner did record and
     the policy then refused on value stays inside the envelope. */
  const overLimit = evaluate({ intent: { ...BASE_INTENT, principalUsdMicros: "999000000", usdMicros: "999000000" } });
  assert.equal(overLimit.decision, "BLOCK");
  assert.equal(overLimit.scope.status, "INSIDE_ENVELOPE");
});

test("missing, stale or unread budget evidence is UNKNOWN rather than zero", () => {
  const missing = evaluate({
    intent: {
      ...BASE_INTENT,
      principalUsdMicros: null,
      feeReserveUsdMicros: null,
      usdMicros: null,
      valuation: null,
    },
  });
  assert.equal(missing.decision, "UNKNOWN");
  assert.equal(missing.findings.find((finding) => finding.rule === "VALUATION_CURRENT")?.outcome, "UNKNOWN");

  const stale = evaluate({ now: "2026-08-27T14:01:00.000Z" });
  assert.equal(stale.decision, "UNKNOWN");

  const unavailable = evaluate({
    budget: { ...BASE_BUDGET, readState: "UNAVAILABLE", storeBoundary: "UNAVAILABLE" },
  });
  assert.equal(unavailable.decision, "UNKNOWN");
});

test("below-proof floors and missing human approval require REVIEW", () => {
  const swap = SolanaCanaryIntentSchema.parse({
    ...BASE_INTENT,
    intentId: "int_canary_swap_1",
    family: "SWAP",
    mints: [USDC, WSOL],
    programs: [JUPITER_PROGRAM],
    usdMicros: "1000000",
  });
  const belowFloor = evaluate({ intent: swap });
  assert.equal(belowFloor.decision, "REVIEW");
  assert.equal(belowFloor.findings.find((finding) => finding.rule === "FAMILY_LIMIT")?.outcome, "REVIEW");

  const missingApproval = evaluate({ intent: { ...BASE_INTENT, humanApproval: "NOT_RECORDED" } });
  assert.equal(missingApproval.decision, "REVIEW");
  assert.equal(missingApproval.findings.find((finding) => finding.rule === "HUMAN_APPROVAL")?.outcome, "REVIEW");
});

test("an exact current allowlisted intent is ALLOW without safety or profit language", () => {
  const verdict = evaluate();
  assert.equal(verdict.decision, "ALLOW");
  assert.equal(verdict.newRiskAllowed, true);
  assert.match(verdict.policyDigest, /^0x[0-9a-f]{64}$/);
  assert.match(verdict.intentDigest, /^0x[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(verdict), /safe|legal|profit/i);
});

test("a canary verdict cannot be rebound to a different intent", () => {
  const verdict = evaluate();
  assert.deepEqual(verifySolanaCanaryVerdictBinding({ intent: BASE_INTENT, verdict }), { ok: true });
  const rebound = verifySolanaCanaryVerdictBinding({
    intent: { ...BASE_INTENT, destination: OTHER_DESTINATION },
    verdict,
  });
  assert.equal(rebound.ok, false);
  assert.match(rebound.reason, /intent digest/i);
});

test("environment policy resolution defaults to PAUSED and rejects malformed allowlists", () => {
  const defaults = resolveSolanaCanaryPolicy({});
  assert.equal(defaults.ok, true);
  assert.equal(defaults.policy.state, "PAUSED");
  assert.deepEqual(defaults.policy.families.SEND.allowedDestinations, []);

  const configured = resolveSolanaCanaryPolicy({
    RYNTRA_SOLANA_CANARY_STATE: "OPEN",
    RYNTRA_SOLANA_CANARY_DESTINATIONS: DESTINATION,
    RYNTRA_SOLANA_CANARY_SWAP_PROGRAMS: JUPITER_PROGRAM,
  });
  assert.equal(configured.ok, true);
  assert.equal(configured.policy.state, "OPEN");
  assert.deepEqual(configured.policy.families.SEND.allowedDestinations, [DESTINATION]);
  assert.deepEqual(configured.policy.families.ATA_CREATE.allowedDestinations, []);
  assert.deepEqual(configured.policy.families.SWAP.allowedPrograms, [JUPITER_PROGRAM]);

  const duplicate = resolveSolanaCanaryPolicy({
    RYNTRA_SOLANA_CANARY_DESTINATIONS: `${DESTINATION},${DESTINATION}`,
  });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.reason, /duplicate/i);
});

test("the CCTP family can represent both Solana programs and chain-qualified Base contracts/assets", () => {
  const configured = resolveSolanaCanaryPolicy({
    RYNTRA_SOLANA_CANARY_STATE: "OPEN",
    RYNTRA_SOLANA_CANARY_BRIDGE_DESTINATIONS: `${DESTINATION},${BASE_DESTINATION}`,
    RYNTRA_SOLANA_CANARY_CCTP_PROGRAMS: `${SOLANA_CCTP_PROGRAM},${BASE_CCTP_PROGRAM}`,
  });
  assert.equal(configured.ok, true);
  assert.deepEqual(configured.policy.families.CCTP.allowedMints, [USDC, BASE_USDC].sort());
  assert.deepEqual(configured.policy.families.CCTP.allowedPrograms, [BASE_CCTP_PROGRAM, SOLANA_CCTP_PROGRAM].sort());
  const intent = SolanaCanaryIntentSchema.parse({
    ...BASE_INTENT,
    intentId: "int_canary_cctp_1",
    family: "CCTP",
    destination: BASE_DESTINATION,
    mints: [USDC, BASE_USDC],
    programs: [SOLANA_CCTP_PROGRAM, BASE_CCTP_PROGRAM],
    principalUsdMicros: "2000000",
    feeReserveUsdMicros: "10000",
    usdMicros: "2010000",
  });
  const budget = SolanaCanaryBudgetSnapshotSchema.parse({
    ...BASE_BUDGET,
    families: familyTotals(),
  });
  const verdict = evaluateSolanaCanaryIntent({
    policy: configured.policy,
    budget,
    intent,
    now: new Date("2026-08-27T14:00:30.000Z"),
  });
  assert.equal(verdict.decision, "ALLOW");
});
