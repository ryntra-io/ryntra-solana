/**
 * A plan that made no trade is a result.
 *
 * Until this existed, Results mapped executions and a plan that never traded
 * produced nothing at all, so the product could not answer the most useful
 * question a careful person asks: *why did I not buy?* A maximum price that
 * was never met, a liquidity floor the venue never cleared, an entry window
 * that closed, a plan cancelled on purpose — each of those is the plan
 * working, not failing, and the shape says so: `failure` is the literal
 * `false`.
 *
 * The reason is read off the records the plan already keeps — the Reviews it
 * judged, its status, its validity — and never invented. Where a Review
 * established it, `blockedBy` names the check and `expected` / `found` carry
 * that check's own words, so the sentence a person reads is the sentence the
 * Review wrote before the signature was ever offered. Pure; the clock is a
 * value.
 */

import type { PlanCheck, PlanCheckId, PlanNoTradeOutcome, PlanNoTradeReason, PlanReview } from "../api/v1/contract.ts";
import { projectedStatus, type TradingPlanRecord } from "./store.ts";

/** The check a Review was refused by, mapped to the reason a person would give. */
const REASON_OF_CHECK: Readonly<Partial<Record<PlanCheckId, PlanNoTradeReason>>> = {
  entryPrice: "entry-bound-unmet",
  liquidity: "liquidity-unavailable",
  evidence: "conditions-unmet",
  invalidation: "invalidated-before-entry",
};

/** The first required check a Review was refused by; advisory failures never block, so they are not a reason. */
function blockingCheck(review: PlanReview): PlanCheck | null {
  return review.checks.find((check) => check.required && check.outcome !== "pass") ?? null;
}

function reasonOf(check: PlanCheck | null): PlanNoTradeReason {
  if (!check) return "review-blocked";
  return REASON_OF_CHECK[check.id] ?? "review-blocked";
}

/** Every Review the plan holds, oldest first — the ones kept in the list and the ones an execution carries. */
function reviewsOf(record: TradingPlanRecord): readonly PlanReview[] {
  const seen = new Map<string, PlanReview>();
  for (const review of record.reviews) seen.set(review.reviewId, review);
  for (const execution of record.executions) {
    if (execution.review) seen.set(execution.review.reviewId, execution.review);
  }
  return [...seen.values()].sort((a, b) => Date.parse(a.checkedAt) - Date.parse(b.checkedAt));
}

/**
 * The plan's no-trade outcome, or null when it traded. A plan with a settled
 * execution has a result of its own and is never reported here as well —
 * that is what keeps the two feeds from telling the same plan's story twice.
 */
export function noTradeOutcomeOf(record: TradingPlanRecord, nowMs: number): PlanNoTradeOutcome | null {
  if (record.executions.some((execution) => execution.outcome === "DONE")) return null;

  const status = projectedStatus(record, nowMs);
  const reviews = reviewsOf(record);
  const last = reviews.length > 0 ? reviews[reviews.length - 1] : null;
  const blocked = reviews.filter((review) => review.verdict === "blocked");
  const version = record.history[record.history.length - 1];

  /* A rule that refused every Review is the honest reason, whatever the plan's
     status now says: a plan whose maximum price was never met and then
     expired was stopped by the price, and the expiry is the consequence. */
  const everyBlocked = reviews.length > 0 && blocked.length === reviews.length;
  const firstChecks = blocked.map(blockingCheck);
  const sharedCheck = everyBlocked && firstChecks.length > 0 && firstChecks.every((check) => check !== null && check.id === firstChecks[0]?.id) ? firstChecks[0] : null;

  let reason: PlanNoTradeReason;
  let check: PlanCheck | null = null;
  let observedAt = record.updatedAt;

  if (sharedCheck) {
    reason = reasonOf(sharedCheck);
    check = sharedCheck;
    observedAt = last?.checkedAt ?? record.updatedAt;
  } else if (record.status === "cancelled") {
    reason = "cancelled";
    observedAt = record.journal.filter((entry) => entry.event === "cancelled").at(-1)?.at ?? record.updatedAt;
  } else if (status === "expired") {
    reason = "expired";
    observedAt = version.rules.entry.validUntil ?? record.updatedAt;
  } else if (last === null) {
    reason = "no-review";
    observedAt = record.updatedAt;
  } else if (last.verdict === "blocked") {
    check = blockingCheck(last);
    reason = reasonOf(check);
    observedAt = last.checkedAt;
  } else {
    reason = "reviewed-not-taken";
    observedAt = last.checkedAt;
  }

  return {
    kind: "no-trade",
    planId: record.id,
    version: record.planVersion,
    asset: record.asset,
    status,
    reason,
    blockedBy: check?.id ?? null,
    expected: check?.expected ?? null,
    found: check?.actual ?? null,
    reviews: reviews.length,
    everyReview: sharedCheck !== null,
    lastReview: last ? { reviewId: last.reviewId, checkedAt: last.checkedAt, verdict: last.verdict } : null,
    observedAt,
    failure: false,
  };
}
