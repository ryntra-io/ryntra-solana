/**
 * Send states, as a function of facts rather than of UI steps.
 *
 * The numbered wizard on the page was a different list from this one, and
 * that is how LANDED_FAILED, EXPIRED and UNKNOWN collapsed into "something
 * went wrong". Recovery starts with signature status. An undetermined
 * submit is never retried from here.
 */

export const SEND_STATES = [
  "DRAFT",
  "REVIEW",
  "SIGNATURE_REQUIRED",
  "SIGNED",
  "SUBMITTED",
  "CONFIRMED",
  "FINALIZED",
  "LANDED_FAILED",
  "EXPIRED",
  "UNKNOWN",
  "RECOVERY",
  "RECEIPTED",
] as const;

export type SendState = (typeof SEND_STATES)[number];

export type SignatureStatusRead = Readonly<{
  /** Cluster confirmation, when the signature is known at all. */
  confirmationStatus: "processed" | "confirmed" | "finalized" | null;
  /** On-chain error payload, stringified. Null when the tx succeeded or is unseen. */
  err: string | null;
  /** True when getSignatureStatuses returned a row for this signature. */
  seen: boolean;
  slot: string | null;
}>;

export type RecoveryFacts = Readonly<{
  signature: string;
  status: SignatureStatusRead;
  /** Current chain height, for expiry. Null when the height read failed. */
  blockHeight: string | null;
  lastValidBlockHeight: string;
}>;

/**
 * Classify a submit/observe outcome into one Send state.
 *
 * Order is the product: signature status first, then confirmation, then
 * expiry vs unknown. A missing transaction after its blockhash has expired
 * is EXPIRED; a missing transaction that could still land is UNKNOWN.
 */
export function classifySendOutcome(facts: RecoveryFacts): SendState {
  const { status, blockHeight, lastValidBlockHeight } = facts;
  if (status.seen && status.err) return "LANDED_FAILED";
  if (status.confirmationStatus === "finalized") return "FINALIZED";
  if (status.confirmationStatus === "confirmed") return "CONFIRMED";
  if (status.confirmationStatus === "processed") return "SUBMITTED";
  if (!status.seen) {
    if (blockHeight !== null && BigInt(blockHeight) > BigInt(lastValidBlockHeight)) {
      return "EXPIRED";
    }
    return "UNKNOWN";
  }
  return "UNKNOWN";
}

/**
 * Advance the machine one event. Illegal transitions return the current
 * state rather than inventing a skip — a submit from DRAFT is not SUBMITTED.
 */
export function nextSendState(
  current: SendState,
  event:
    | "PREVIEWED"
    | "POLICY_ALLOWED"
    | "POLICY_BLOCKED"
    | "SIGNED"
    | "SUBMITTED"
    | "CONFIRMED"
    | "FINALIZED"
    | "LANDED_FAILED"
    | "EXPIRED"
    | "UNKNOWN"
    | "RECOVER"
    | "RECEIPTED"
    | "RETURN_TO_REVIEW",
): SendState {
  if (event === "RETURN_TO_REVIEW") return "REVIEW";
  if (event === "RECOVER") return "RECOVERY";
  switch (current) {
    case "DRAFT":
      return event === "PREVIEWED" ? "REVIEW" : current;
    case "REVIEW":
      if (event === "POLICY_BLOCKED") return "REVIEW";
      if (event === "POLICY_ALLOWED") return "SIGNATURE_REQUIRED";
      return current;
    case "SIGNATURE_REQUIRED":
      return event === "SIGNED" ? "SIGNED" : current;
    case "SIGNED":
      return event === "SUBMITTED" ? "SUBMITTED" : current;
    case "SUBMITTED":
      if (event === "CONFIRMED") return "CONFIRMED";
      if (event === "FINALIZED") return "FINALIZED";
      if (event === "LANDED_FAILED") return "LANDED_FAILED";
      if (event === "EXPIRED") return "EXPIRED";
      if (event === "UNKNOWN") return "UNKNOWN";
      return current;
    case "CONFIRMED":
      if (event === "FINALIZED") return "FINALIZED";
      if (event === "RECEIPTED") return "RECEIPTED";
      return current;
    case "FINALIZED":
      return event === "RECEIPTED" ? "RECEIPTED" : current;
    case "RECOVERY":
      if (event === "CONFIRMED") return "CONFIRMED";
      if (event === "FINALIZED") return "FINALIZED";
      if (event === "LANDED_FAILED") return "LANDED_FAILED";
      if (event === "EXPIRED") return "EXPIRED";
      if (event === "UNKNOWN") return "UNKNOWN";
      if (event === "RECEIPTED") return "RECEIPTED";
      return current;
    default:
      return current;
  }
}

export const RECOVERY_READS_FIRST = "SIGNATURE_STATUS" as const;
