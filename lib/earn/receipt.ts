/**
 * The receipt an Earn action ends with.
 *
 * A Review is a promise and a receipt is the record; they are not the same figures. The receipt names what
 * was signed and what the chain did with it — including the case the product cares about most, which is a
 * transaction whose answer was lost on the way back to the browser. Once a wallet has signed, «nothing was
 * sent» is never the honest answer: the signature exists, so the receipt waits on the chain's word instead of
 * guessing ({@link EARN_RECEIPT_STATES}).
 *
 * Pure. The chain read behind it is `service.server.ts`, and the surface draws this with the core's Receipt.
 */

import { EARN_FEE_BPS, type EarnAction, type EarnProviderId } from "./model.ts";

/**
 * `LANDED` — the chain has it and it succeeded. `FAILED` — the chain has it and it failed, with its reason.
 * `UNKNOWN` — signed and sent, and the chain has not been read yet or did not answer; the one state a
 * surface must keep asking about rather than resolve on its own.
 */
export const EARN_RECEIPT_STATES = ["LANDED", "FAILED", "UNKNOWN"] as const;
export type EarnReceiptState = (typeof EARN_RECEIPT_STATES)[number];

export type EarnReceipt = Readonly<{
  provider: EarnProviderId;
  action: EarnAction;
  signature: string;
  state: EarnReceiptState;
  /** Why it failed, in the words the chain gave; null otherwise. */
  reason: string | null;
  /** What the signed transaction carried, base units, and the asset it was. */
  amountRaw: string;
  asset: Readonly<{ mint: string; symbol: string; decimals: number }>;
  /** The rate on the Review the person signed, per cent a year; null when none was stated. */
  rateAnnualPercent: number | null;
  /** How far the rate had moved by the time the bytes were sent, basis points; null when either was unread. */
  rateDriftBps: number | null;
  /** Ryntra's cut: zero, stated on the record as well as on the Review. */
  feeBps: number;
  /** When the bytes were sent, ISO. */
  sentAt: string;
}>;

export function buildEarnReceipt(args: {
  provider: EarnProviderId;
  action: EarnAction;
  signature: string;
  state: EarnReceiptState;
  reason?: string | null;
  amountRaw: bigint | string;
  asset: EarnReceipt["asset"];
  rateAnnualPercent: number | null;
  rateDriftBps: number | null;
  sentAt: number;
}): EarnReceipt {
  return {
    provider: args.provider,
    action: args.action,
    signature: args.signature,
    state: args.state,
    reason: args.reason ?? null,
    amountRaw: typeof args.amountRaw === "bigint" ? args.amountRaw.toString() : args.amountRaw,
    asset: args.asset,
    rateAnnualPercent: args.rateAnnualPercent,
    rateDriftBps: args.rateDriftBps,
    feeBps: EARN_FEE_BPS,
    sentAt: new Date(args.sentAt).toISOString(),
  };
}

/** Whether this receipt is still waiting on the chain, and the surface should ask again. */
export const unsettled = (receipt: Pick<EarnReceipt, "state">): boolean => receipt.state === "UNKNOWN";

/**
 * One signature's state from a `getSignatureStatuses` answer.
 *
 * A status the endpoint has not seen is `UNKNOWN` rather than `FAILED`: a transaction the cluster has not
 * processed yet and a transaction that failed are different facts, and only one of them is final.
 */
export function stateFromStatus(status: unknown): Readonly<{ state: EarnReceiptState; reason: string | null }> {
  if (status === null || typeof status !== "object") return { state: "UNKNOWN", reason: null };
  const entry = status as { err?: unknown; confirmationStatus?: unknown };
  if (entry.err !== null && entry.err !== undefined) {
    return { state: "FAILED", reason: typeof entry.err === "string" ? entry.err : JSON.stringify(entry.err) };
  }
  const confirmation = typeof entry.confirmationStatus === "string" ? entry.confirmationStatus : null;
  return confirmation === "confirmed" || confirmation === "finalized" || confirmation === "processed"
    ? { state: "LANDED", reason: null }
    : { state: "UNKNOWN", reason: null };
}
