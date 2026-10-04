/**
 * Browser-side safety state for one swap.
 *
 * This module is deliberately pure. The server uses the same review predicate
 * before it releases provider bytes, while the client repeats it before a
 * wallet prompt. Once a signature exists, every uncertain execute result is a
 * recovery state for that signature — never permission to request new bytes.
 */

import { getBase58Decoder, getTransactionDecoder } from "@solana/kit";

/* Rules from the pure module, the verdict shape as a type only: a client
   module that reaches `node:crypto` through a value import breaks the
   browser bundle, and `swap-policy.ts` hashes with it. */
import { SWAP_POLICY_RULES } from "./swap-policy-rules.ts";
import type { SwapPolicyVerdict } from "./swap-policy.ts";

const REQUIRED_RULES = SWAP_POLICY_RULES;

/**
 * The floor under a Review a person is asked to act on.
 *
 * A window that has not expired is not the same as a window somebody can use.
 * A recorded run showed the difference: *a Review lives about ninety seconds,
 * so reading it carefully produced a refusal after the wallet prompt.* The
 * check below used to be `now >= expiry`, which is true only once the order is
 * already dead — so at one second left the card still opened the wallet, the
 * person confirmed, and the venue refused bytes that had expired while the
 * prompt was on screen. The signature was real, the refusal was real, and
 * neither was their fault.
 *
 * Ten seconds is the smallest window in which a wallet can raise its prompt and
 * a person can read and press it. Below that the honest answer is a fresh
 * quote, given before the wallet opens rather than after.
 */
export const SWAP_MIN_ACTIONABLE_REVIEW_MS = 10_000;

export type SwapClientReviewAssessment = Readonly<
  | { ready: true; code: "READY_FOR_HUMAN_APPROVAL"; reason: string }
  | {
      ready: false;
      code:
        | "POLICY_BLOCKED"
        | "PROOF_NOT_SIGNED"
        | "SIMULATION_NOT_CLEAR"
        | "EFFECTS_NOT_VERIFIED"
        | "ORDER_EXPIRED"
        | "ORDER_TOO_SHORT"
        | "REVIEW_INVALIDATED";
      reason: string;
    }
>;

/**
 * How many times in a row the card may ask for a fresh price on its own.
 *
 * The bound is the whole safety property. Without it, a venue answering slower
 * than its own forty-five-second window would have the card refresh, receive
 * something already expired, refresh again, and keep going — a loop that spends
 * a read budget built to protect the action path, and one nobody asked for.
 * After three the card stops and the manual control is still there.
 */
export const SWAP_AUTO_REFRESH_CHASE_LIMIT = 3;

export type QuoteAutoRefreshInput = Readonly<{
  /** A price is on screen. Nothing is refreshed when there is nothing to replace. */
  hasQuote: boolean;
  /** Its remaining window, or null when no countdown is running. */
  secondsLeft: number | null;
  /** A Review is open: exact bytes a person may be reading right now. */
  reviewOpen: boolean;
  /** A signature exists and its outcome is unresolved. */
  attemptOpen: boolean;
  /** The card's own phase. Anything but rest means work is under way. */
  phase: string;
  /** Whether the page is actually on screen. */
  documentVisible: boolean;
  /** A quote request is already in flight. */
  quoting: boolean;
  /** Consecutive automatic refreshes that came back already expired. */
  chased: number;
}>;

/**
 * Whether the card should fetch a fresh price without being asked.
 *
 * An expired price left on screen is the one number a person can read and the
 * one number that is no longer true, and the only way out used to be noticing
 * it and pressing a button. A quote is a read — it sits on the read budget, not
 * the twelve-per-minute action window, and it cannot move money — so asking
 * again is simply what the screen should do.
 *
 * Each refusal below is a way that could go wrong, and each is a separate line
 * so that a change to one cannot quietly become a change to another:
 *
 * - **A Review is open.** Exact bytes are in front of somebody. Replacing them
 *   underneath a person who is reading them is the worst thing this rule could
 *   do, and it is the first thing it refuses.
 * - **A signature exists.** Once bytes are out, every uncertain result is a
 *   recovery state for that signature — never permission to fetch new ones.
 * - **The page is not on screen.** A background card spending sixty reads a
 *   minute is how a budget meant to protect the action path gets spent by
 *   nobody.
 * - **The chase limit.** See {@link SWAP_AUTO_REFRESH_CHASE_LIMIT}: this is
 *   what makes the rule terminate rather than merely usually stop.
 *
 * Pure and total, so the loop it must not create is provable rather than
 * observed — the card that consumes it cannot be driven in a visible browser by
 * an automated session, and a hidden tab throttles the very timers this depends
 * on.
 */
export function shouldAutoRefreshQuote(input: QuoteAutoRefreshInput): boolean {
  if (!input.hasQuote) return false;
  if (input.secondsLeft === null || input.secondsLeft > 0) return false;
  if (input.reviewOpen || input.attemptOpen) return false;
  if (input.quoting) return false;
  if (input.phase !== "IDLE") return false;
  if (!input.documentVisible) return false;
  if (input.chased >= SWAP_AUTO_REFRESH_CHASE_LIMIT) return false;
  return true;
}

export function assessSwapClientReview(args: {
  verdict: Pick<SwapPolicyVerdict, "decision" | "findings">;
  proofStatus: string;
  simulationStatus: string;
  ownerEffectsStatus: string;
  expiresAt: string;
  now?: Date;
  /** A later check refused these bytes, even if the earlier proof was valid. */
  invalidated?: boolean;
}): SwapClientReviewAssessment {
  if (args.invalidated) {
    return { ready: false, code: "REVIEW_INVALIDATED", reason: "This Review was refused by a later check. Request fresh bytes." };
  }
  if (args.proofStatus !== "SIGNED") {
    return { ready: false, code: "PROOF_NOT_SIGNED", reason: "The exact review has no trusted issuer signature." };
  }
  if (args.simulationStatus !== "OK") {
    return { ready: false, code: "SIMULATION_NOT_CLEAR", reason: "The exact provider bytes did not pass simulation." };
  }
  if (args.ownerEffectsStatus !== "VERIFIED") {
    return {
      ready: false,
      code: "EFFECTS_NOT_VERIFIED",
      reason: "The exact simulation did not prove the owner's complete allowed asset deltas.",
    };
  }
  const nowMs = (args.now ?? new Date()).getTime();
  const expiresMs = Date.parse(args.expiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresMs) || nowMs >= expiresMs) {
    return { ready: false, code: "ORDER_EXPIRED", reason: "The exact executable order is no longer fresh." };
  }
  if (expiresMs - nowMs < SWAP_MIN_ACTIONABLE_REVIEW_MS) {
    return {
      ready: false,
      code: "ORDER_TOO_SHORT",
      reason: "Too little of this order's window is left to open a wallet and confirm inside it.",
    };
  }

  /*
   * A REVIEW finding is information for the person about to sign — a wider
   * slippage, a thin route, a leg the venue could not price. It belongs on
   * the card, not in front of the wallet. Only a BLOCK stops the bytes, and
   * every BLOCK in `swap-policy.ts` is a structural failure: the payout does
   * not land on the signer, the fee payer is someone else, the bytes did not
   * decode or simulate, the proven deltas do not match the reviewed legs, or
   * the window has closed.
   */
  const byRule = new Map(args.verdict.findings.map((finding) => [finding.rule, finding]));
  const complete = byRule.size === REQUIRED_RULES.length && REQUIRED_RULES.every((rule) => byRule.has(rule));
  const blocking = REQUIRED_RULES.filter((rule) => byRule.get(rule)?.outcome === "BLOCK");
  if (!complete || blocking.length > 0 || args.verdict.decision === "BLOCK") {
    return {
      ready: false,
      code: "POLICY_BLOCKED",
      reason: complete
        ? `The swap policy blocks these bytes: ${blocking.join(", ") || args.verdict.decision}. No wallet may receive them.`
        : "The swap policy returned an incomplete verdict; no wallet may receive these bytes.",
    };
  }

  return {
    ready: true,
    code: "READY_FOR_HUMAN_APPROVAL",
    reason: "The exact reviewed order is ready for the wallet's visible approval.",
  };
}

/** Bind every displayed quote to the current form, including the empty-input case. */
export function swapQuoteMatches(
  order: { inputMint: string; outputMint: string; inAmountRaw: string } | null | undefined,
  input: { inputMint: string; outputMint: string; amountRaw: string | null },
): boolean {
  return order != null && input.amountRaw !== null && order.inputMint === input.inputMint &&
    order.outputMint === input.outputMint && order.inAmountRaw === input.amountRaw;
}

export type SwapClientAttemptState = "SIGNED_NOT_SENT" | "SUBMITTED_UNKNOWN" | "SETTLED";

export type SwapClientAttempt = Readonly<{
  schema: "ryntra.solana.swap-client-attempt";
  schemaVersion: "1.0.0";
  requestId: string;
  signature: string;
  taker: string;
  state: SwapClientAttemptState;
  recordedAt: string;
}>;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function parseSwapClientAttempt(value: string | null): SwapClientAttempt | null {
  if (!value || value.length > 2_048) return null;
  try {
    const candidate = JSON.parse(value) as Partial<SwapClientAttempt>;
    if (
      candidate.schema !== "ryntra.solana.swap-client-attempt" ||
      candidate.schemaVersion !== "1.0.0" ||
      typeof candidate.requestId !== "string" ||
      candidate.requestId.length < 1 ||
      candidate.requestId.length > 128 ||
      typeof candidate.signature !== "string" ||
      candidate.signature.length < 64 ||
      candidate.signature.length > 96 ||
      !BASE58.test(candidate.signature) ||
      typeof candidate.taker !== "string" ||
      candidate.taker.length < 32 ||
      candidate.taker.length > 44 ||
      !BASE58.test(candidate.taker) ||
      !["SIGNED_NOT_SENT", "SUBMITTED_UNKNOWN", "SETTLED"].includes(candidate.state ?? "") ||
      typeof candidate.recordedAt !== "string" ||
      !Number.isFinite(Date.parse(candidate.recordedAt))
    ) {
      return null;
    }
    return candidate as SwapClientAttempt;
  } catch {
    return null;
  }
}

export function transitionSwapClientAttempt(
  attempt: SwapClientAttempt,
  result: Readonly<
    | { kind: "FAILURE" }
    | { kind: "SUCCESS"; serverState: string }
  >,
): SwapClientAttempt {
  const unresolved =
    result.kind === "FAILURE" ||
    result.serverState === "SUBMITTED_UNKNOWN" ||
    result.serverState === "RECOVERY_PENDING";
  return { ...attempt, state: unresolved ? "SUBMITTED_UNKNOWN" : "SETTLED" };
}

export function readSwapClientSignature(args: {
  signedWireBase64: string;
  expectedTaker: string;
}): string | null {
  try {
    let wire: Uint8Array;
    if (typeof Buffer !== "undefined") {
      wire = new Uint8Array(Buffer.from(args.signedWireBase64, "base64"));
    } else {
      const binary = atob(args.signedWireBase64);
      wire = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }
    const decoded = getTransactionDecoder().decode(wire);
    const raw = (decoded.signatures as unknown as Readonly<Record<string, Uint8Array | null>>)[args.expectedTaker];
    if (!raw || raw.length !== 64 || raw.every((byte) => byte === 0)) return null;
    return getBase58Decoder().decode(raw);
  } catch {
    return null;
  }
}
