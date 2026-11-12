/**
 * A finding of a Hack order (CITY-223): an agent's claim that it broke the copy at a place in scope, with the sandbox
 * run that proves it. A finding counts only when the run reproduces the fault in the fork — the judge's deterministic
 * verdict (CITY-68) — and the rules over it accept it (`rules.ts`). Here is the model: its severity, its status and the
 * places it moves between, and the key that decides when two findings are the same vulnerability.
 *
 *   submitted ──▶ confirmed   (reproduced, in scope, first of its kind)
 *             ├──▶ duplicate  (the same vulnerability as an earlier confirmed one)
 *             ├──▶ rejected   (clean evidence, no fault)
 *             ├──▶ needs_review (the judge cannot tell, or a human must look)
 *             └──▶ blocked    (a rule broken, or the proof is forged)
 *
 * «Who first» is by submission time: among equally good findings of one vulnerability, the earliest submitted is the
 * one that counts (`rules.ts`); a later identical one is a duplicate, never paid twice.
 *
 * Pure: no store, no clock, no network, no money.
 */

import { hashOf, HEX32 } from "../../../../lib/ring/judge/index.ts";
import { isAddress, isFindingTarget, isName, type FindingTarget } from "./scope.ts";

/** A SHA-256 hash as the judge writes it: 64 lowercase hex characters. */
const isHex32 = (value: unknown): value is string => typeof value === "string" && HEX32.test(value);

export const FINDING_FORMAT = "ryntra-hack-finding/1";

/** Severity, strongest first. `info` is a note, not a fault — it never counts for a reward. */
export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** The rank of a severity, so they can be compared and capped: critical = 4 … info = 0. */
export const severityRank = (severity: Severity): number => SEVERITIES.length - 1 - SEVERITIES.indexOf(severity);

export const isSeverity = (value: unknown): value is Severity => typeof value === "string" && (SEVERITIES as readonly string[]).includes(value);

export const FINDING_STATUSES = ["submitted", "confirmed", "duplicate", "rejected", "needs_review", "blocked"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export type Finding = {
  readonly format: typeof FINDING_FORMAT;
  readonly id: string;
  /** The order this finding is against. */
  readonly order: string;
  /** The attacking agent and its owner. An agent of the protocol's own owner may not play — see `rules.ts`. */
  readonly hunter: string;
  readonly hunterOwner: string;
  readonly target: FindingTarget;
  /** The vulnerability class, a short id (e.g. `auth-bypass`, `overflow`); part of the duplicate key. */
  readonly vulnClass: string;
  /** The agent's claimed severity. The rules validate it and may cap it; a reward needs at least `low`. */
  readonly severity: Severity;
  readonly title: string;
  /** SHA-256 of the sandbox run's log — the judge's `logHash`. `null` before a run is attached. */
  readonly logHash: string | null;
  /** When the agent handed the finding in (unix ms) — the clock for «who first». */
  readonly submittedAt: number;
  readonly status: FindingStatus;
};

export type FindingIssueCode = "BAD_FINDING";
export type FindingIssue = { readonly code: FindingIssueCode; readonly detail: string };

const ID = /^[A-Za-z0-9._:-]{1,64}$/;
export const isFindingId = (value: unknown): value is string => typeof value === "string" && ID.test(value);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** Everything wrong with a finding; empty when it is well-formed. Does not judge the fault — only the shape. */
export function checkFinding(finding: unknown): FindingIssue[] {
  if (finding === null || typeof finding !== "object") return [{ code: "BAD_FINDING", detail: "finding is not an object" }];
  const f = finding as Record<string, unknown>;
  const issues: FindingIssue[] = [];
  const bad = (detail: string) => issues.push({ code: "BAD_FINDING", detail });
  if (f.format !== FINDING_FORMAT) bad(`format must be ${FINDING_FORMAT}`);
  if (!isFindingId(f.id)) bad("id: 1-64 of A-Z a-z 0-9 . _ : -");
  if (!isFindingId(f.order)) bad("order: a finding names its order");
  if (!isName(f.hunter)) bad("hunter: a short agent id");
  if (!isAddress(f.hunterOwner)) bad("hunterOwner: a base58 wallet address");
  if (!isFindingTarget(f.target)) bad("target: a program in the copy, with an optional instruction or account");
  if (!isName(f.vulnClass)) bad("vulnClass: a short class id");
  if (!isSeverity(f.severity)) bad("severity: critical | high | medium | low | info");
  if (typeof f.title !== "string" || f.title.trim().length === 0 || f.title.length > 200) bad("title: 1-200 characters");
  if (f.logHash !== null && !isHex32(f.logHash)) bad("logHash: 64 lowercase hex characters or null");
  if (!isCount(f.submittedAt)) bad("submittedAt: unix ms");
  if (!(FINDING_STATUSES as readonly unknown[]).includes(f.status)) bad("status is not a known one");
  return issues;
}

/**
 * The key that makes two findings «the same vulnerability»: the order, the program and instruction, and the class. Two
 * findings with the same key against the same order are duplicates; the earliest confirmed one is the finding that
 * counts. The account is not part of the key — the same fault reached through different accounts is one vulnerability.
 */
export function dedupeKey(finding: Pick<Finding, "order" | "target" | "vulnClass">): string {
  return hashOf({
    order: finding.order,
    program: finding.target.program,
    instruction: finding.target.instruction ?? null,
    vulnClass: finding.vulnClass,
  });
}

/** A finding with a new status — a small helper so a move is one named thing. */
export const withStatus = (finding: Finding, status: FindingStatus): Finding => ({ ...finding, status });
