/**
 * The bounded proposal ledger a write tool writes into.
 *
 * **It lives in the server process and nowhere else.** No database, no
 * migration, no shared state, no persistence across a restart. That is not a
 * placeholder for a durable queue that is nearly ready — there is no durable
 * queue, and this module says so in the one place a caller would otherwise
 * assume one. A durable queue is a stated non-goal of this ledger.
 *
 * ## Bounded means refused, not dropped
 *
 * A ring buffer that silently overwrote the oldest proposal would make a lost
 * decision look like a decision nobody made. Capacity is a refusal with a name.
 *
 * ## The ledger cannot authorize
 *
 * Every mutation this module exposes is on the proposal's own record:
 * evidence, a review request, a withdrawal. There is no method that moves
 * `ownerAuthorization`, and a test enumerates the exported surface and fails if
 * one appears. `GRANTED_BY_OWNER` is a value this file never writes.
 */

import type { AgentActionClass } from "../registry.ts";
import type { RyntraOwnerAuthorization } from "../a2a/inbound.ts";

export const PROPOSAL_LEDGER_CAPACITY = 64;
export const PROPOSAL_MAX_EVIDENCE = 16;

export const PROPOSAL_LEDGER_REFUSALS = [
  "PROPOSAL_LEDGER_FULL",
  "PROPOSAL_UNKNOWN",
  "PROPOSAL_ALREADY_WITHDRAWN",
  "PROPOSAL_EVIDENCE_LIMIT_REACHED",
] as const;

export type ProposalLedgerRefusal = (typeof PROPOSAL_LEDGER_REFUSALS)[number];

export class ProposalLedgerError extends Error {
  readonly reasonCode: ProposalLedgerRefusal;

  constructor(reasonCode: ProposalLedgerRefusal, detail: string) {
    super(`${reasonCode}: ${detail}`);
    this.name = "ProposalLedgerError";
    this.reasonCode = reasonCode;
  }
}

export type ProposalEvidence = Readonly<{
  /** Where the evidence came from, kept beside it rather than folded into a verdict. */
  sourceRef: string;
  note: string;
}>;

export type ProposalRecord = Readonly<{
  id: string;
  kind: "AGENT_CONTROL_PROPOSAL";
  phase: "PROPOSE";
  source: "MCP_CLIENT" | "A2A_INBOUND";
  tool: string;
  actionRef: string | null;
  adapterRef: string | null;
  canonicalClass: AgentActionClass | null;
  subjectRef: string;
  summary: string;
  status: "OPEN" | "WITHDRAWN";
  /** Whether a person has been asked to look. Asking is the whole effect. */
  reviewRequested: boolean;
  ownerAuthorization: RyntraOwnerAuthorization;
  evidence: readonly ProposalEvidence[];
  withdrawalReason: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type ProposalSeed = Readonly<{
  source: ProposalRecord["source"];
  tool: string;
  actionRef: string | null;
  adapterRef: string | null;
  canonicalClass: AgentActionClass | null;
  subjectRef: string;
  summary: string;
  /**
   * The authorization state the producing path computed.
   *
   * Accepted rather than assumed because the A2A path legitimately records
   * `REQUESTED` when a task reached `TASK_STATE_AUTH_REQUIRED`. It is still not
   * a caller field: `admitMcpWrite` refuses any authority-shaped key before
   * this module is reached, so the only writer is Ryntra's own code.
   */
  ownerAuthorization: RyntraOwnerAuthorization;
}>;

export type ProposalLedger = Readonly<{
  capacity: number;
  size: () => number;
  list: () => readonly ProposalRecord[];
  read: (id: string) => ProposalRecord;
  open: (seed: ProposalSeed) => ProposalRecord;
  attachEvidence: (id: string, evidence: ProposalEvidence) => ProposalRecord;
  requestReview: (id: string) => ProposalRecord;
  withdraw: (id: string, reason: string) => ProposalRecord;
}>;

/**
 * Create one ledger.
 *
 * `clock` is a parameter so a test can pin timestamps; the server passes the
 * real one. A module-level `Date.now()` would make every record in the suite
 * depend on when it ran.
 */
export function createProposalLedger(clock: () => string): ProposalLedger {
  const records = new Map<string, ProposalRecord>();
  let sequence = 0;

  function require(id: string): ProposalRecord {
    const record = records.get(id);
    if (!record) {
      throw new ProposalLedgerError("PROPOSAL_UNKNOWN", "this ledger holds no proposal with that id");
    }
    return record;
  }

  function requireOpen(id: string): ProposalRecord {
    const record = require(id);
    if (record.status === "WITHDRAWN") {
      throw new ProposalLedgerError(
        "PROPOSAL_ALREADY_WITHDRAWN",
        "a withdrawn proposal keeps its record and takes no further writes",
      );
    }
    return record;
  }

  function commit(next: ProposalRecord): ProposalRecord {
    const frozen = Object.freeze({ ...next, updatedAt: clock() });
    records.set(frozen.id, frozen);
    return frozen;
  }

  return Object.freeze({
    capacity: PROPOSAL_LEDGER_CAPACITY,
    size: () => records.size,
    list: () => Object.freeze([...records.values()]),
    read: (id: string) => require(id),

    open(seed: ProposalSeed): ProposalRecord {
      if (records.size >= PROPOSAL_LEDGER_CAPACITY) {
        throw new ProposalLedgerError(
          "PROPOSAL_LEDGER_FULL",
          `this process holds ${PROPOSAL_LEDGER_CAPACITY} proposals and refuses rather than dropping one`,
        );
      }
      sequence += 1;
      const at = clock();
      const record: ProposalRecord = Object.freeze({
        id: `proposal-${sequence}`,
        kind: "AGENT_CONTROL_PROPOSAL" as const,
        phase: "PROPOSE" as const,
        source: seed.source,
        tool: seed.tool,
        actionRef: seed.actionRef,
        adapterRef: seed.adapterRef,
        canonicalClass: seed.canonicalClass,
        subjectRef: seed.subjectRef,
        summary: seed.summary,
        status: "OPEN" as const,
        reviewRequested: false,
        ownerAuthorization: seed.ownerAuthorization,
        evidence: Object.freeze([]),
        withdrawalReason: null,
        createdAt: at,
        updatedAt: at,
      });
      records.set(record.id, record);
      return record;
    },

    attachEvidence(id: string, evidence: ProposalEvidence): ProposalRecord {
      const record = requireOpen(id);
      if (record.evidence.length >= PROPOSAL_MAX_EVIDENCE) {
        throw new ProposalLedgerError(
          "PROPOSAL_EVIDENCE_LIMIT_REACHED",
          `a proposal carries at most ${PROPOSAL_MAX_EVIDENCE} evidence references`,
        );
      }
      return commit({
        ...record,
        evidence: Object.freeze([...record.evidence, Object.freeze({ ...evidence })]),
      });
    },

    /* Requesting review sets a flag and nothing else. It does not advance the
       phase, because the phase after PROPOSE is Ryntra's own VERIFY and the one
       after that is the owner's — neither is a caller's to reach. */
    requestReview(id: string): ProposalRecord {
      const record = requireOpen(id);
      return commit({ ...record, reviewRequested: true });
    },

    /* A withdrawn proposal keeps its record. Erasing it would let a caller
       remove the evidence that it ever asked. */
    withdraw(id: string, reason: string): ProposalRecord {
      const record = requireOpen(id);
      return commit({ ...record, status: "WITHDRAWN" as const, withdrawalReason: reason });
    },
  });
}
