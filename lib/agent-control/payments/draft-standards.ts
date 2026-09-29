/**
 * ERC-8004 and ERC-8183, mirrored rather than integrated.
 *
 * Both are **Draft**. Canon `12 §5.1` and `§6` give the same instruction for
 * each: pin the exact revision before writing a line against it, and never
 * consume a moving Draft as "latest". This module is that instruction in code.
 *
 * What "mirrored" means here, precisely:
 *
 * - the **vocabulary** is reproduced, so Ryntra can record an observation about
 *   a job or a registry entry in the specification's own words;
 * - the **revision** is pinned to the exact document that was read, by content
 *   digest, so a later reader can prove they are looking at the same text;
 * - **nothing else**. There is no ABI, no contract address, no chain client and
 *   no network call. A test reads this file and fails on any of them.
 *
 * ## Two boundaries that are the whole point
 *
 * **A registry entry is evidence, never a verdict.** Canon `06 §7` states it as
 * a prohibition — never derive `registered = safe` or `high reputation = action
 * allowed` — and the enforcement here is structural: the top capability rung
 * `PROVEN` is absent from the mirrored state list, and any aggregate handed to
 * the builder is refused rather than dropped. Dropping it silently would be
 * worse: the caller would believe the number was recorded.
 *
 * **A completed job is the provider's state, not Ryntra's outcome.** Canon
 * `03 §8.2` says a provider `completed` is not a Receipt `MATCHED`. Every job
 * observation therefore carries `reconciliationSupport: "NONE"` as a field
 * about itself, so a reader does not have to remember the rule.
 *
 * ## A discrepancy worth carrying rather than smoothing over
 *
 * ERC-8183's abstract summarises the lifecycle as `Open → Funded → Submitted →
 * Terminal`, which reads as a straight line. Its own state machine is not one:
 * `Open → Rejected`, `Funded → Rejected` and `Funded → Expired` are all listed
 * as allowed transitions. A mirror written from the abstract would refuse a
 * legal job state as impossible, so the transition table below comes from the
 * specification's table and the four-state summary is kept as the shape of the
 * vocabulary, not as the shape of the graph.
 */

export const DRAFT_STANDARD_REFUSALS = [
  "DRAFT_STANDARD_REVISION_UNPINNED",
  "DRAFT_STANDARD_UNKNOWN",
  "REPUTATION_STATE_NOT_MIRRORED",
  "REPUTATION_REGISTRY_UNKNOWN",
  "REPUTATION_AGGREGATE_FORBIDDEN",
  "JOB_STATE_NOT_MIRRORED",
  "JOB_TERMINAL_KIND_MISSING",
  "JOB_TERMINAL_KIND_UNEXPECTED",
  "JOB_TERMINAL_KIND_UNKNOWN_VALUE",
  "JOB_TERMINAL_KIND_UNREACHABLE",
  "JOB_TRANSITION_NOT_ALLOWED",
] as const;

export type DraftStandardRefusal = (typeof DRAFT_STANDARD_REFUSALS)[number];

export class DraftStandardError extends Error {
  readonly reasonCode: DraftStandardRefusal;

  constructor(reasonCode: DraftStandardRefusal, detail: string) {
    super(`${reasonCode}: ${detail}`);
    this.name = "DraftStandardError";
    this.reasonCode = reasonCode;
  }
}

export const MIRRORED_STANDARDS = ["ERC-8004", "ERC-8183"] as const;

export type MirroredStandard = (typeof MIRRORED_STANDARDS)[number];

export type DraftStandardPin = Readonly<{
  standard: MirroredStandard;
  status: "DRAFT";
  /** The exact document, not a branch. A content digest is the strongest pin available. */
  revision: string;
  sourceUrl: string;
  observedAt: string;
}>;

/**
 * The ways of writing "latest" while looking like a pin.
 *
 * A branch name resolves to different bytes tomorrow, which is the exact
 * failure canon `12 §5.1` names. The list is explicit because a length check
 * alone would accept `main`.
 */
const MOVING_REFERENCES = new Set(["latest", "main", "master", "head", "draft", "dev", "next"]);

function assertPinned(pin: DraftStandardPin): void {
  if (!MIRRORED_STANDARDS.includes(pin.standard)) {
    throw new DraftStandardError("DRAFT_STANDARD_UNKNOWN", String(pin.standard));
  }
  const revision = typeof pin.revision === "string" ? pin.revision.trim() : "";
  if (revision.length < 4 || MOVING_REFERENCES.has(revision.toLowerCase())) {
    throw new DraftStandardError(
      "DRAFT_STANDARD_REVISION_UNPINNED",
      `"${pin.revision}" resolves to different bytes tomorrow, so it is not a pin`,
    );
  }
}

export function pinDraftStandard(input: {
  standard: MirroredStandard;
  revision: string;
  sourceUrl: string;
  observedAt: string;
}): DraftStandardPin {
  const pin: DraftStandardPin = Object.freeze({
    standard: input.standard,
    status: "DRAFT" as const,
    revision: input.revision,
    sourceUrl: input.sourceUrl,
    observedAt: input.observedAt,
  });
  assertPinned(pin);
  return pin;
}

/**
 * The two documents this repository actually read, pinned by the SHA-256 of the
 * exact bytes.
 *
 * `ERCS/erc-8004.md` and `ERCS/erc-8183.md` from `ethereum/ERCs@master`, both
 * `status: Draft`, fetched 2026-08-24. A digest rather than a commit id because
 * it is what a later reader can reproduce from the document alone.
 */
export const ERC_8004_PIN: DraftStandardPin = pinDraftStandard({
  standard: "ERC-8004",
  revision: "sha256:249dc3d96ad7bbe4afd25cacd14be942eb87751abcf1608bab19a610f3c3f8a9",
  sourceUrl: "https://github.com/ethereum/ERCs/blob/master/ERCS/erc-8004.md",
  observedAt: "2026-08-24",
});

export const ERC_8183_PIN: DraftStandardPin = pinDraftStandard({
  standard: "ERC-8183",
  revision: "sha256:257c35bbaecab58d0c36823fe8fb2d0fffc83d6f1fd7301d97674707784efa3a",
  sourceUrl: "https://github.com/ethereum/ERCs/blob/master/ERCS/erc-8183.md",
  observedAt: "2026-08-24",
});

/* -------------------------------------------------------------------------
 * ERC-8004 — Trustless Agents. Three registries, three separate dimensions.
 * ---------------------------------------------------------------------- */

/** The specification's three registries. Kept apart; never averaged. */
export const REPUTATION_REGISTRIES = ["IDENTITY", "REPUTATION", "VALIDATION"] as const;

export type ReputationRegistry = (typeof REPUTATION_REGISTRIES)[number];

/**
 * Canon `03 §6.1a`'s capability states, **minus `PROVEN`**.
 *
 * The omission is the rule. A third-party registry entry is not one of the
 * things that can prove a capability, and a state list that offered `PROVEN`
 * would make `registered = safe` a one-word edit away.
 */
export const REPUTATION_SIGNAL_STATES = [
  "DECLARED",
  "DISCOVERED",
  "OBSERVED",
  "UNAVAILABLE",
  "CONFLICTING",
  "UNKNOWN",
] as const;

export type ReputationSignalState = (typeof REPUTATION_SIGNAL_STATES)[number];

/** Any field name that would turn three dimensions into one number. */
const AGGREGATE_FIELD = /score|rating|rank|stars|points|trustlevel|reputationvalue|average|weight/i;

export type ReputationEvidence = Readonly<{
  kind: "REPUTATION_SIGNAL";
  standard: "ERC-8004";
  standardStatus: "DRAFT";
  standardRevision: string;
  subjectRef: string;
  registry: ReputationRegistry;
  state: ReputationSignalState;
  /** Who said it, in words a reader can check. Canon 03 §7.3. */
  sourceLabel: string;
  observedAt: string;
  limitation: string;
}>;

export function buildReputationEvidence(input: {
  pin: DraftStandardPin;
  subjectRef: string;
  registry: string;
  state: string;
  sourceLabel: string;
  observedAt: string;
  [extra: string]: unknown;
}): ReputationEvidence {
  assertPinned(input.pin as DraftStandardPin);

  /* Refuse an aggregate before anything else. A caller that passed one believes
     it will be recorded, and a silent drop leaves them acting on a number this
     module never stored. */
  for (const key of Object.keys(input)) {
    if (AGGREGATE_FIELD.test(key)) {
      throw new DraftStandardError(
        "REPUTATION_AGGREGATE_FORBIDDEN",
        `${key} is an aggregate; ERC-8004 evidence carries three separate dimensions and no number`,
      );
    }
  }

  if (!REPUTATION_REGISTRIES.includes(input.registry as ReputationRegistry)) {
    throw new DraftStandardError("REPUTATION_REGISTRY_UNKNOWN", String(input.registry));
  }
  if (!REPUTATION_SIGNAL_STATES.includes(input.state as ReputationSignalState)) {
    throw new DraftStandardError(
      "REPUTATION_STATE_NOT_MIRRORED",
      `${String(input.state)} is not in the mirrored state list; PROVEN in particular is unreachable from a registry entry`,
    );
  }

  return Object.freeze({
    kind: "REPUTATION_SIGNAL" as const,
    standard: "ERC-8004" as const,
    standardStatus: "DRAFT" as const,
    standardRevision: input.pin.revision,
    subjectRef: input.subjectRef,
    registry: input.registry as ReputationRegistry,
    state: input.state as ReputationSignalState,
    sourceLabel: input.sourceLabel,
    observedAt: input.observedAt,
    limitation:
      "Source-labelled evidence from a Draft registry. It is not a score, not a safety verdict and not an authorization; risk stays specific to the action being proposed.",
  });
}

/* -------------------------------------------------------------------------
 * ERC-8183 — Agentic Commerce. Job escrow with an evaluator.
 * ---------------------------------------------------------------------- */

/** The four-state summary the specification's abstract uses. */
export const JOB_LIFECYCLE_STATES = ["OPEN", "FUNDED", "SUBMITTED", "TERMINAL"] as const;

export type JobLifecycleState = (typeof JOB_LIFECYCLE_STATES)[number];

/**
 * The three terminal outcomes the specification names, plus the honest fourth.
 *
 * `UNKNOWN` exists because an observer can see that a job ended without seeing
 * which way. Mapping that to `REJECTED` because it is the common case would be
 * inventing the fact the observation was supposed to establish.
 */
export const JOB_TERMINAL_KINDS = ["COMPLETED", "REJECTED", "EXPIRED", "UNKNOWN"] as const;

export type JobTerminalKind = (typeof JOB_TERMINAL_KINDS)[number];

/** From the specification's transition table, not from its abstract. */
const ALLOWED_TRANSITIONS: Readonly<Record<JobLifecycleState, readonly JobLifecycleState[]>> =
  Object.freeze({
    OPEN: Object.freeze(["FUNDED", "TERMINAL"] as const),
    FUNDED: Object.freeze(["SUBMITTED", "TERMINAL"] as const),
    SUBMITTED: Object.freeze(["TERMINAL"] as const),
    TERMINAL: Object.freeze([] as const),
  });

/**
 * Which terminal outcomes are reachable from which state.
 *
 * `Completed` appears only under `SUBMITTED`, which is the invariant that makes
 * the escrow mean anything: value cannot be released to a provider that never
 * submitted work. `Expired` requires something to have been escrowed, so it is
 * unreachable from `OPEN`.
 */
const TERMINAL_KINDS_BY_ORIGIN: Readonly<Record<JobLifecycleState, readonly JobTerminalKind[]>> =
  Object.freeze({
    OPEN: Object.freeze(["REJECTED", "UNKNOWN"] as const),
    FUNDED: Object.freeze(["REJECTED", "EXPIRED", "UNKNOWN"] as const),
    SUBMITTED: Object.freeze(["COMPLETED", "REJECTED", "EXPIRED", "UNKNOWN"] as const),
    TERMINAL: Object.freeze([] as const),
  });

export function nextJobStates(state: JobLifecycleState): readonly JobLifecycleState[] {
  return ALLOWED_TRANSITIONS[state] ?? [];
}

/**
 * Check one observed transition against the specification's table.
 *
 * Returns nothing on success and throws a named refusal otherwise, because a
 * boolean here invites a call site that ignores it.
 */
export function assertJobTransition(
  from: JobLifecycleState,
  to: JobLifecycleState,
  terminalKind: JobTerminalKind | null,
): void {
  if (!JOB_LIFECYCLE_STATES.includes(from)) {
    throw new DraftStandardError("JOB_STATE_NOT_MIRRORED", String(from));
  }
  if (!JOB_LIFECYCLE_STATES.includes(to)) {
    throw new DraftStandardError("JOB_STATE_NOT_MIRRORED", String(to));
  }
  if (!nextJobStates(from).includes(to)) {
    throw new DraftStandardError(
      "JOB_TRANSITION_NOT_ALLOWED",
      `${from} → ${to} is not in the ERC-8183 transition table`,
    );
  }
  if (to !== "TERMINAL") {
    if (terminalKind !== null) {
      throw new DraftStandardError("JOB_TERMINAL_KIND_UNEXPECTED", `${to} is not a terminal state`);
    }
    return;
  }
  if (terminalKind === null) {
    throw new DraftStandardError("JOB_TERMINAL_KIND_MISSING", "a terminal state must name its outcome");
  }
  if (!JOB_TERMINAL_KINDS.includes(terminalKind)) {
    throw new DraftStandardError("JOB_TERMINAL_KIND_UNKNOWN_VALUE", String(terminalKind));
  }
  if (!TERMINAL_KINDS_BY_ORIGIN[from].includes(terminalKind)) {
    throw new DraftStandardError(
      "JOB_TERMINAL_KIND_UNREACHABLE",
      `${terminalKind} is not reachable from ${from} under ERC-8183`,
    );
  }
}

export type JobObservation = Readonly<{
  kind: "JOB_OBSERVATION";
  standard: "ERC-8183";
  standardStatus: "DRAFT";
  standardRevision: string;
  jobRef: string;
  network: string;
  state: JobLifecycleState;
  terminalKind: JobTerminalKind | null;
  sourceLabel: string;
  observedAt: string;
  /** Canon 03 §8.2, stated on the record rather than left to the reader. */
  reconciliationSupport: "NONE";
  reconciliationSupportReason: string;
}>;

export function buildJobObservation(input: {
  pin: DraftStandardPin;
  jobRef: string;
  network: string;
  state: string;
  terminalKind: string | null;
  sourceLabel: string;
  observedAt: string;
}): JobObservation {
  assertPinned(input.pin);

  if (!JOB_LIFECYCLE_STATES.includes(input.state as JobLifecycleState)) {
    throw new DraftStandardError(
      "JOB_STATE_NOT_MIRRORED",
      `${String(input.state)} is not one of the four mirrored states`,
    );
  }
  const state = input.state as JobLifecycleState;

  if (state === "TERMINAL") {
    if (input.terminalKind === null || input.terminalKind === undefined) {
      throw new DraftStandardError("JOB_TERMINAL_KIND_MISSING", "a terminal job must name its outcome");
    }
    if (!JOB_TERMINAL_KINDS.includes(input.terminalKind as JobTerminalKind)) {
      throw new DraftStandardError("JOB_TERMINAL_KIND_UNKNOWN_VALUE", String(input.terminalKind));
    }
  } else if (input.terminalKind !== null && input.terminalKind !== undefined) {
    throw new DraftStandardError(
      "JOB_TERMINAL_KIND_UNEXPECTED",
      `${state} is not terminal and cannot carry ${String(input.terminalKind)}`,
    );
  }

  return Object.freeze({
    kind: "JOB_OBSERVATION" as const,
    standard: "ERC-8183" as const,
    standardStatus: "DRAFT" as const,
    standardRevision: input.pin.revision,
    jobRef: input.jobRef,
    network: input.network,
    state,
    terminalKind: state === "TERMINAL" ? (input.terminalKind as JobTerminalKind) : null,
    sourceLabel: input.sourceLabel,
    observedAt: input.observedAt,
    reconciliationSupport: "NONE" as const,
    reconciliationSupportReason:
      "A job state is the escrow contract's own account of itself. It does not settle Ryntra's reconciliation: that needs an independent observation of the expected effect, compared against what was authorized.",
  });
}
