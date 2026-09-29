/**
 * Retention of a judged figure — the rights map's window applied at read.
 *
 * A Review that judged an evidence condition kept the figure it judged (the
 * observation's value) beside its own verdict. The figure is licensed data:
 * it stays with the review until `retainedUntil`, and after that every read
 * of the review redacts it — `value: null`, the check's `actual` replaced by
 * *retained until <date>* — while `outcome`, `expected` and the verdict,
 * which are Ryntra's own decision and the person's own rule, stay for as
 * long as the plan does. Nothing is rewritten in the store: redaction is a
 * projection, so the retention rule can be tightened later and applies to
 * every review already kept.
 *
 * Pure: a review and a clock in, a review out.
 */

import type { PlanReview } from "../api/v1/contract.ts";

export function redactExpiredEvidence<T extends PlanReview>(review: T, nowMs: number): T {
  const evidence = review.evidence;
  if (!evidence || Date.parse(evidence.retainedUntil) > nowMs) return review;
  const words = `retained until ${evidence.retainedUntil.slice(0, 10)}`;
  return {
    ...review,
    checks: review.checks.map((check) => (check.id === "evidence" ? { ...check, actual: check.actual === null ? null : words } : check)),
    evidence: {
      ...evidence,
      reads: evidence.reads.map((read) => ({ ...read, reason: read.reason === null ? null : words })),
      conditions: evidence.conditions.map((condition) => ({ ...condition, value: null })),
    },
  };
}
