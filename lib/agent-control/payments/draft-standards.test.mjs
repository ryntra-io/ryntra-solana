// Run from repo root:
// node --test --test-isolation=none lib/agent-control/payments/draft-standards.test.mjs
//
// ERC-8004 and ERC-8183 are Draft. The same rule holds for both: pin the
// revision, mirror the vocabulary, never build against a moving specification
// and never let a registry entry become a safety verdict.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DRAFT_STANDARD_REFUSALS,
  DraftStandardError,
  ERC_8004_PIN,
  ERC_8183_PIN,
  JOB_LIFECYCLE_STATES,
  JOB_TERMINAL_KINDS,
  REPUTATION_SIGNAL_STATES,
  assertJobTransition,
  buildJobObservation,
  buildReputationEvidence,
  nextJobStates,
  pinDraftStandard,
} from "./draft-standards.ts";

function throwsWith(reasonCode, run) {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof DraftStandardError, `expected a draft-standard refusal, got ${error}`);
    assert.equal(error.reasonCode, reasonCode, `expected ${reasonCode}, got ${error.reasonCode}`);
    return error;
  }
  assert.fail(`expected ${reasonCode}, nothing was thrown`);
}

test("both standards are recorded as Draft, with a revision and a date", () => {
  for (const pin of [ERC_8004_PIN, ERC_8183_PIN]) {
    assert.equal(pin.status, "DRAFT");
    assert.ok(pin.revision.length >= 4, `${pin.standard} carries no usable revision`);
    assert.match(pin.sourceUrl, /^https:\/\//);
    assert.match(pin.observedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Object.isFrozen(pin));
  }
  assert.equal(ERC_8004_PIN.standard, "ERC-8004");
  assert.equal(ERC_8183_PIN.standard, "ERC-8183");
});

test("an unpinned Draft reference is refused", () => {
  /* GATE-PROVED. The convenient value is whatever the specification says today,
     and that is the exact mistake to avoid: a moving Draft is never consumed
     as "latest". Each of these is a way of saying "latest" while looking like
     a pin. */
  for (const revision of ["", "   ", "latest", "LATEST", "main", "HEAD", "master", "draft"]) {
    throwsWith("DRAFT_STANDARD_REVISION_UNPINNED", () =>
      pinDraftStandard({
        standard: "ERC-8004",
        revision,
        sourceUrl: "https://eips.ethereum.org/EIPS/eip-8004",
        observedAt: "2026-08-24",
      }),
    );
  }
  const pinned = pinDraftStandard({
    standard: "ERC-8004",
    revision: "eip-8004@2026-08-20",
    sourceUrl: "https://eips.ethereum.org/EIPS/eip-8004",
    observedAt: "2026-08-24",
  });
  assert.equal(pinned.revision, "eip-8004@2026-08-20");
});

test("a reputation signal can never reach PROVEN", () => {
  /* Ryntra's capability states include PROVEN. A third-party registry entry
     is not one of the things that can prove a capability, so the mirror is
     that list minus its top rung — and the omission is asserted so a later
     edit cannot restore it quietly. */
  assert.deepEqual([...REPUTATION_SIGNAL_STATES], [
    "DECLARED",
    "DISCOVERED",
    "OBSERVED",
    "UNAVAILABLE",
    "CONFLICTING",
    "UNKNOWN",
  ]);
  assert.ok(!REPUTATION_SIGNAL_STATES.includes("PROVEN"));
  throwsWith("REPUTATION_STATE_NOT_MIRRORED", () =>
    buildReputationEvidence({
      pin: ERC_8004_PIN,
      subjectRef: "agent_1",
      registry: "IDENTITY",
      state: "PROVEN",
      sourceLabel: "ERC-8004 Identity registry, revision-pinned read",
      observedAt: "2026-08-24T00:00:00.000Z",
    }),
  );
});

test("reputation evidence is source-labelled and carries no aggregate", () => {
  const evidence = buildReputationEvidence({
    pin: ERC_8004_PIN,
    subjectRef: "agent_1",
    registry: "REPUTATION",
    state: "DECLARED",
    sourceLabel: "ERC-8004 Reputation registry, revision-pinned read",
    observedAt: "2026-08-24T00:00:00.000Z",
  });
  assert.equal(evidence.kind, "REPUTATION_SIGNAL");
  assert.equal(evidence.state, "DECLARED");
  assert.equal(evidence.sourceLabel, "ERC-8004 Reputation registry, revision-pinned read");
  assert.equal(evidence.standard, "ERC-8004");
  assert.equal(evidence.standardStatus, "DRAFT");
  for (const key of Object.keys(evidence)) {
    assert.ok(
      !/score|rating|rank|stars|points|trustLevel|reputationValue/i.test(key),
      `reputation evidence carries an aggregate field: ${key}`,
    );
  }
  assert.ok(Object.isFrozen(evidence));
});

test("handing the builder an aggregate is refused rather than dropped", () => {
  /* GATE-PROVED. Silently ignoring the field would be worse than failing: the
     caller would believe the number was recorded and act on it. */
  throwsWith("REPUTATION_AGGREGATE_FORBIDDEN", () =>
    buildReputationEvidence({
      pin: ERC_8004_PIN,
      subjectRef: "agent_1",
      registry: "REPUTATION",
      state: "DECLARED",
      sourceLabel: "ERC-8004 Reputation registry",
      observedAt: "2026-08-24T00:00:00.000Z",
      score: 4.8,
    }),
  );
  throwsWith("REPUTATION_AGGREGATE_FORBIDDEN", () =>
    buildReputationEvidence({
      pin: ERC_8004_PIN,
      subjectRef: "agent_1",
      registry: "VALIDATION",
      state: "OBSERVED",
      sourceLabel: "ERC-8004 Validation registry",
      observedAt: "2026-08-24T00:00:00.000Z",
      trustScore: 90,
    }),
  );
});

test("the three registries stay three separate evidence dimensions", () => {
  const identity = buildReputationEvidence({
    pin: ERC_8004_PIN,
    subjectRef: "agent_1",
    registry: "IDENTITY",
    state: "DISCOVERED",
    sourceLabel: "ERC-8004 Identity registry",
    observedAt: "2026-08-24T00:00:00.000Z",
  });
  const reputation = buildReputationEvidence({
    pin: ERC_8004_PIN,
    subjectRef: "agent_1",
    registry: "REPUTATION",
    state: "DECLARED",
    sourceLabel: "ERC-8004 Reputation registry",
    observedAt: "2026-08-24T00:00:00.000Z",
  });
  assert.notEqual(identity.registry, reputation.registry);
  /* Registered is not safe, and high reputation is not an allowed action.
     Neither record carries a field that could be read as one. */
  for (const record of [identity, reputation]) {
    assert.ok(!("verdict" in record));
    assert.ok(!("allowed" in record));
    assert.ok(!("safe" in record));
  }
});

test("a reputation record cannot be built against an unpinned standard", () => {
  throwsWith("DRAFT_STANDARD_REVISION_UNPINNED", () =>
    buildReputationEvidence({
      pin: { standard: "ERC-8004", status: "DRAFT", revision: "latest", sourceUrl: "https://x", observedAt: "2026-08-24" },
      subjectRef: "agent_1",
      registry: "REPUTATION",
      state: "DECLARED",
      sourceLabel: "ERC-8004 Reputation registry",
      observedAt: "2026-08-24T00:00:00.000Z",
    }),
  );
});

test("the job lifecycle mirrors ERC-8183, including the exits its own summary hides", () => {
  assert.deepEqual([...JOB_LIFECYCLE_STATES], ["OPEN", "FUNDED", "SUBMITTED", "TERMINAL"]);

  /* The specification's abstract writes the lifecycle as `Open → Funded →
     Submitted → Terminal`, which reads as a straight line. Its state machine is
     not one: `Open → Rejected`, `Funded → Rejected` and `Funded → Expired` are
     all listed as allowed. A mirror built from the arrow chain would call a
     real, legal job state impossible — so the transitions come from the table,
     not from the sentence. */
  assert.deepEqual([...nextJobStates("OPEN")], ["FUNDED", "TERMINAL"]);
  assert.deepEqual([...nextJobStates("FUNDED")], ["SUBMITTED", "TERMINAL"]);
  assert.deepEqual([...nextJobStates("SUBMITTED")], ["TERMINAL"]);
  assert.deepEqual([...nextJobStates("TERMINAL")], []);
});

test("a job can only be completed out of SUBMITTED", () => {
  /* The invariant that makes the escrow mean anything: the specification lists
     `Submitted → Completed` and no other route to Completed, so an escrow
     cannot be released to a provider that never submitted work. */
  assert.equal(assertJobTransition("SUBMITTED", "TERMINAL", "COMPLETED"), undefined);
  throwsWith("JOB_TERMINAL_KIND_UNREACHABLE", () =>
    assertJobTransition("OPEN", "TERMINAL", "COMPLETED"),
  );
  throwsWith("JOB_TERMINAL_KIND_UNREACHABLE", () =>
    assertJobTransition("FUNDED", "TERMINAL", "COMPLETED"),
  );
  /* And expiry cannot happen before anything was escrowed. */
  throwsWith("JOB_TERMINAL_KIND_UNREACHABLE", () =>
    assertJobTransition("OPEN", "TERMINAL", "EXPIRED"),
  );
  assert.equal(assertJobTransition("FUNDED", "TERMINAL", "EXPIRED"), undefined);
});

test("a transition the specification does not list is refused", () => {
  throwsWith("JOB_TRANSITION_NOT_ALLOWED", () => assertJobTransition("OPEN", "SUBMITTED", null));
  throwsWith("JOB_TRANSITION_NOT_ALLOWED", () => assertJobTransition("SUBMITTED", "FUNDED", null));
  throwsWith("JOB_TRANSITION_NOT_ALLOWED", () => assertJobTransition("TERMINAL", "OPEN", null));
});

test("an observation that cannot name the terminal kind says UNKNOWN rather than guessing", () => {
  assert.equal(assertJobTransition("FUNDED", "TERMINAL", "UNKNOWN"), undefined);
  const job = buildJobObservation({
    pin: ERC_8183_PIN,
    jobRef: "job_2",
    network: "eip155:56",
    state: "TERMINAL",
    terminalKind: "UNKNOWN",
    sourceLabel: "ERC-8183 escrow read, revision-pinned",
    observedAt: "2026-08-24T00:00:00.000Z",
  });
  assert.equal(job.terminalKind, "UNKNOWN");
});

test("a job observation is evidence and says so", () => {
  const job = buildJobObservation({
    pin: ERC_8183_PIN,
    jobRef: "job_1",
    network: "eip155:56",
    state: "TERMINAL",
    terminalKind: "COMPLETED",
    sourceLabel: "ERC-8183 escrow read, revision-pinned",
    observedAt: "2026-08-24T00:00:00.000Z",
  });
  assert.equal(job.kind, "JOB_OBSERVATION");
  assert.equal(job.state, "TERMINAL");
  assert.equal(job.terminalKind, "COMPLETED");
  assert.equal(job.standardStatus, "DRAFT");
  /* The load-bearing field. A provider's own completed state is not a Ryntra
     MATCHED, and this record states that about itself rather than leaving it
     to whoever reads it. */
  assert.equal(job.reconciliationSupport, "NONE");
  assert.match(job.reconciliationSupportReason, /does not/i);
});

test("a terminal state needs a terminal kind, and a non-terminal state may not carry one", () => {
  throwsWith("JOB_TERMINAL_KIND_MISSING", () =>
    buildJobObservation({
      pin: ERC_8183_PIN,
      jobRef: "job_1",
      network: "eip155:56",
      state: "TERMINAL",
      terminalKind: null,
      sourceLabel: "ERC-8183 escrow read",
      observedAt: "2026-08-24T00:00:00.000Z",
    }),
  );
  throwsWith("JOB_TERMINAL_KIND_UNEXPECTED", () =>
    buildJobObservation({
      pin: ERC_8183_PIN,
      jobRef: "job_1",
      network: "eip155:56",
      state: "FUNDED",
      terminalKind: "COMPLETED",
      sourceLabel: "ERC-8183 escrow read",
      observedAt: "2026-08-24T00:00:00.000Z",
    }),
  );
  assert.ok(JOB_TERMINAL_KINDS.includes("UNKNOWN"));
});

test("an unknown lifecycle state is refused rather than mapped to the nearest one", () => {
  throwsWith("JOB_STATE_NOT_MIRRORED", () =>
    buildJobObservation({
      pin: ERC_8183_PIN,
      jobRef: "job_1",
      network: "eip155:56",
      state: "COMPLETED",
      terminalKind: null,
      sourceLabel: "ERC-8183 escrow read",
      observedAt: "2026-08-24T00:00:00.000Z",
    }),
  );
});

test("neither mirror imports an ABI, an address or a contract client", () => {
  /* Comments stripped: saying "there is no ABI here" is the documentation this
     boundary deserves, and shipping one is the defect. */
  const source = readFileSync("lib/agent-control/payments/draft-standards.ts", "utf8")
    .split("\r\n")
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.ok(!/\babi\b/i.test(source), "the mirror carries an ABI");
  assert.ok(!/0x[0-9a-fA-F]{40}/.test(source), "the mirror hard-codes a contract address");
  assert.ok(!/from ["'](viem|ethers|@solana)/.test(source), "the mirror imports a chain client");
  assert.ok(!/\bfetch\s*\(/.test(source), "the mirror calls the network");
});

test("every refusal this module can raise is a declared code", () => {
  assert.equal(new Set(DRAFT_STANDARD_REFUSALS).size, DRAFT_STANDARD_REFUSALS.length);
  const error = throwsWith("JOB_STATE_NOT_MIRRORED", () =>
    buildJobObservation({
      pin: ERC_8183_PIN,
      jobRef: "job_1",
      network: "eip155:56",
      state: "NOPE",
      terminalKind: null,
      sourceLabel: "ERC-8183 escrow read",
      observedAt: "2026-08-24T00:00:00.000Z",
    }),
  );
  assert.ok(DRAFT_STANDARD_REFUSALS.includes(error.reasonCode));
});
