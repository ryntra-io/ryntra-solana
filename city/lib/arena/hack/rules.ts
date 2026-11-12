/**
 * The rules over the judge (CITY-223, over CITY-68): one decision on one finding, by fixed rules, in a fixed order, the
 * same on every machine. The judge (`lib/ring/judge`) already says whether a sandbox run reproduced the fault in the
 * fork — PASS / FAIL / BLOCKED / NEEDS_REVIEW. These rules sit on top of it and answer the Hack questions the judge
 * does not:
 *
 *   • Is the order open, and the finding inside its window?
 *   • Did the protocol owner permit this audit, on this copy, within this scope? (`permission.ts`)
 *   • Is the target in scope? (`scope.ts`)
 *   • Is the attacker someone other than the protocol's own owner? (no agent plays both sides)
 *   • Does the proof match this finding, and was it decided by code — not just a model's description?
 *   • Is this the first finding of its vulnerability, or a duplicate of one already confirmed?
 *   • What severity does it count at, and is it reward-eligible at all?
 *
 * The checks run in a fixed order and the first failure decides, so a forged permission is caught before a replay is
 * trusted and an out-of-scope target before severity is read. Determinism is the basis of the verdict: only a
 * deterministic proof (a replay or hidden tests — the «verified» class, CITY-68) can make a counted, reward-eligible
 * finding; a model's score (the «show» class) describes a finding and never counts or pays it. No money moves here —
 * `payable` is only «the rules would allow a reward», and the reward pool and payout are CITY-229.
 *
 * Pure: no store, no clock, no network, no keys, no money.
 */

import { type Judgement } from "../../../../lib/ring/judge/index.ts";
import { checkFinding, dedupeKey, severityRank, type Finding, type Severity } from "./finding.ts";
import { checkGrant, scopeHash, type PermissionVerifier } from "./permission.ts";
import { inScope } from "./scope.ts";
import { takesFindingAt, type Order } from "./order.ts";

/** What became of a finding under the rules. */
export const HACK_OUTCOMES = ["counts", "duplicate", "rejected", "review", "blocked", "description"] as const;
export type HackOutcome = (typeof HACK_OUTCOMES)[number];

export type HackReason =
  // counts
  | "COUNTS"
  // duplicate
  | "DUPLICATE"
  // rejected
  | "NOT_REPRODUCED"
  // review
  | "NEEDS_REVIEW"
  | "NO_EVIDENCE"
  // description (a model's score — never counts or pays)
  | "DESCRIPTION_ONLY"
  // blocked
  | "BAD_FINDING"
  | "WRONG_ORDER"
  | "ORDER_CLOSED"
  | "WINDOW"
  | "NO_PERMISSION"
  | "OUT_OF_SCOPE"
  | "SELF_AUDIT"
  | "EVIDENCE_MISMATCH"
  | "CHEAT";

/** The least severity a reward may be given for: below this a finding counts but is never reward-eligible. */
export const MIN_REWARDED: Severity = "low";

/** The judge's verdict on the sandbox run, and whether it was decided by code. */
export type HackProof = {
  /** The judge's verdict (CITY-68) on the run that proves — or fails to prove — the fault. */
  readonly judgement: Judgement;
  /**
   * `true` when a replay or hidden tests decided it (the «verified» class): deterministic, and the only kind that can
   * make a counted finding. `false` for a model's score (the «show» class), which only describes a finding.
   */
  readonly deterministic: boolean;
};

export type Assessment = {
  readonly outcome: HackOutcome;
  /** The status the finding should take. */
  readonly status: Finding["status"];
  readonly reason: HackReason;
  /** The severity the finding counts at — the agent's claim — or `null` when it does not count. */
  readonly severity: Severity | null;
  /** The first finding of its vulnerability among those that would be confirmed. */
  readonly first: boolean;
  /** The key that makes two findings the same vulnerability. */
  readonly dedupeKey: string;
  /** The rules would allow a reward: counted, first, and at least `low`. Money itself is CITY-229. */
  readonly payable: boolean;
  readonly detail: string;
};

export type AssessInput = {
  readonly order: Order;
  /** The owner's permission grant for the order (`permission.ts`). */
  readonly grant: unknown;
  readonly finding: Finding;
  readonly proof: HackProof;
  /** Every other finding already recorded for this order — for duplicates and «who first». */
  readonly prior: readonly Finding[];
};

const DETAIL_MAX = 160;

/** The decision on one finding. Never throws: anything unexpected is a review, fail-closed. */
export function assessFinding(input: AssessInput, verify: PermissionVerifier): Assessment {
  const key = safeKey(input?.finding);
  try {
    return finish(decide(input, verify), key);
  } catch (error) {
    return finish(review("NEEDS_REVIEW", error instanceof Error ? error.message : "unknown"), key);
  }
}

function decide(input: AssessInput, verify: PermissionVerifier): Draft {
  if (input === null || typeof input !== "object") return blocked("BAD_FINDING", "no finding to assess");
  const { order, grant, finding, proof, prior } = input;

  // Shape.
  const shape = checkFinding(finding);
  if (shape.length > 0) return blocked("BAD_FINDING", shape[0]!.detail);
  if (finding.order !== order.id) return blocked("WRONG_ORDER", "the finding is for another order");

  // The order must be open, and the finding inside its window.
  if (order.status !== "open") return blocked("ORDER_CLOSED", `the order is ${order.status}, not open`);
  if (!takesFindingAt(order, finding.submittedAt)) return blocked("WINDOW", "the finding was submitted outside the order's window");

  // The owner's permission for this order, copy, scope and window.
  const grantIssues = checkGrant(
    grant,
    { order: order.id, protocol: order.protocol, scopeHash: scopeHash(order.scope), opensAt: order.opensAt, closesAt: order.closesAt },
    verify,
  );
  if (grantIssues.length > 0) return blocked("NO_PERMISSION", grantIssues[0]!.detail);

  // The target must be inside the closed scope.
  if (!inScope(order.scope, finding.target)) return blocked("OUT_OF_SCOPE", "the finding's target is not in the order's scope");

  // No agent plays both sides: the attacker's owner is not the protocol's owner.
  if (finding.hunterOwner === order.protocol) return blocked("SELF_AUDIT", "an agent of the protocol's own owner may not attack it");

  // The proof must be about this finding's run.
  const proven = proof?.judgement;
  if (proven === null || typeof proven !== "object") return review("NO_EVIDENCE", "no judge verdict for the run");
  if (finding.logHash === null || proven.logHash === null || proven.logHash === undefined) return review("NO_EVIDENCE", "the run's log hash is missing");
  if (finding.logHash !== proven.logHash) return blocked("EVIDENCE_MISMATCH", "the proof is for another run than the finding");

  // A model's score only describes a finding; it never counts or pays (determinism is the basis of the verdict).
  if (!proof.deterministic) return describe("DESCRIPTION_ONLY", "a model's score describes this finding; only a deterministic proof counts");

  // The judge's deterministic verdict.
  if (proven.verdict === "BLOCKED") return blocked("CHEAT", `the judge blocked the run: ${proven.reason}`);
  if (proven.verdict === "NEEDS_REVIEW") return review("NEEDS_REVIEW", `the judge could not tell: ${proven.reason}`);
  if (proven.verdict === "FAIL") return rejected("NOT_REPRODUCED", "the run did not reproduce the fault");
  if (proven.verdict !== "PASS" || !proven.payable) return review("NEEDS_REVIEW", `an unexpected verdict: ${proven.verdict}`);

  // A reproduced fault. Is it the first of its kind, or a duplicate of one already confirmed?
  const key = dedupeKey(finding);
  const earlier = (prior ?? []).filter((p) => p.id !== finding.id && p.status === "confirmed" && dedupeKey(p) === key);
  if (earlier.length > 0) return { outcome: "duplicate", status: "duplicate", reason: "DUPLICATE", severity: finding.severity, first: false, detail: "the same vulnerability is already confirmed" };

  return { outcome: "counts", status: "confirmed", reason: "COUNTS", severity: finding.severity, first: true, detail: `reproduced; counts at ${finding.severity}` };
}

type Draft = {
  outcome: HackOutcome;
  status: Finding["status"];
  reason: HackReason;
  severity: Severity | null;
  first: boolean;
  detail: string;
};

function finish(draft: Draft, key: string): Assessment {
  const payable = draft.outcome === "counts" && draft.first && draft.severity !== null && severityRank(draft.severity) >= severityRank(MIN_REWARDED);
  return { ...draft, dedupeKey: key, payable, detail: clip(draft.detail) };
}

const blocked = (reason: HackReason, detail: string): Draft => ({ outcome: "blocked", status: "blocked", reason, severity: null, first: false, detail });
const review = (reason: HackReason, detail: string): Draft => ({ outcome: "review", status: "needs_review", reason, severity: null, first: false, detail });
const rejected = (reason: HackReason, detail: string): Draft => ({ outcome: "rejected", status: "rejected", reason, severity: null, first: false, detail });
const describe = (reason: HackReason, detail: string): Draft => ({ outcome: "description", status: "needs_review", reason, severity: null, first: false, detail });

/** The dedupe key of a finding when it is well-formed enough to have one; a stable placeholder otherwise. */
function safeKey(finding: unknown): string {
  try {
    const f = finding as Finding;
    if (checkFinding(f).length === 0) return dedupeKey(f);
  } catch {
    /* fall through */
  }
  return "";
}

function clip(text: string): string {
  return text.length <= DETAIL_MAX ? text : text.slice(0, DETAIL_MAX);
}
