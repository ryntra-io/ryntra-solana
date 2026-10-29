import type { AllowanceReview } from "./contract.ts";

/** How far a new limit's end may move between the Review read and a build made again at signing. */
export const END_DRIFT_S = 300n;

const fixedTerms = (review: AllowanceReview) =>
  JSON.stringify({
    ...review,
    /* A new limit's account is at a fresh nonce each build; a subscription's end is the plan's own and stays in. */
    delegation: review.kind === "fixed" || review.kind === "recurring" ? null : review.delegation,
    endsAt: review.kind === "fixed" || review.kind === "recurring" ? null : review.endsAt,
  });

/**
 * Whether a build made again at signing carries what the person agreed to on the Review (SOL-7): who, how much, how
 * often, the plan's terms and where it pays, what is approved or replaced, what stays, what a merchant may still take
 * and until when — and a new limit's end («now + term») within a few minutes of the one read. Otherwise the new
 * Review is shown to the person again, never handed to the wallet.
 */
export function sameTerms(read: AllowanceReview, built: AllowanceReview): boolean {
  if (fixedTerms(read) !== fixedTerms(built)) return false;
  if (read.kind !== "fixed" && read.kind !== "recurring") return true;
  if (read.endsAt === null || built.endsAt === null) return read.endsAt === built.endsAt;
  const drift = BigInt(built.endsAt) - BigInt(read.endsAt);
  return drift >= -END_DRIFT_S && drift <= END_DRIFT_S;
}
