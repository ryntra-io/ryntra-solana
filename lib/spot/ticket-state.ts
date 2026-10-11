import { scaleRawAmount } from "../solana/amounts.ts";

export type SpotTradeContext = Readonly<{
  side: "BUY" | "SELL";
  baseMint: string;
  baseSymbol: string;
  baseDecimals: number;
  quoteMint: string;
  quoteSymbol: string;
  quoteDecimals: number;
}>;

/** The side of a purchase on the one execution path — an order parameter, never a word a surface says to a person. */
export const SPOT_PURCHASE_SIDE: SpotTradeContext["side"] = "BUY";

/** The side of a sale on the same path — a pre-IPO token swapped before its issuer's deadline, or sold for USDC (the IPO and conversion watch); an order parameter too. */
export const SPOT_SALE_SIDE: SpotTradeContext["side"] = "SELL";

/** Data stays attached to the request that produced it, also between effects. */
export function currentSpotSnapshot<T>(snapshot: { key: string | null; state: T }, key: string | null, empty: T): T {
  return key !== null && snapshot.key === key ? snapshot.state : empty;
}

export type SpotTicketAction = "WAIT" | "RECOVER" | "REFRESH_REVIEW" | "SIGN" | "AMOUNT" |
  "NETWORK_FEE" | "INSUFFICIENT_BALANCE" | "UNAVAILABLE" | "REVIEW";

/**
 * The ticket's one action. «Перевірка» (`REVIEW`) asks the order route for its
 * own fresh order on the amount in the field: it waits for no estimate and no
 * fresh one (2026-10-11 — the first press is the one that works);
 * the Review's own window binds the signature. An estimate that refused for
 * this very amount for a reason no press changes — the same asset, a refused
 * passport — offers no Review.
 */
export function spotTicketAction(state: {
  phase: string;
  hasAttempt: boolean;
  lockedReview: boolean;
  hasPrepared: boolean;
  reviewReady: boolean;
  amountValid: boolean;
  insufficientBalance: boolean;
  cannotPayFee: boolean;
  blocked: boolean;
  quoteFailureRetryable: boolean | null;
  actionFailureRetryable: boolean | null;
}): SpotTicketAction {
  if (["PREPARING", "SIGNING", "EXECUTING", "RECOVERING"].includes(state.phase)) return "WAIT";
  if (state.hasAttempt) return "RECOVER";
  if (state.lockedReview) return "REFRESH_REVIEW";
  if (state.hasPrepared) return state.reviewReady ? "SIGN" : "REFRESH_REVIEW";
  if (!state.amountValid) return "AMOUNT";
  if (state.cannotPayFee) return "NETWORK_FEE";
  if (state.insufficientBalance) return "INSUFFICIENT_BALANCE";
  if (state.blocked || state.actionFailureRetryable === false || state.quoteFailureRetryable === false) return "UNAVAILABLE";
  return "REVIEW";
}

/** A recovered signature without its original market context must not invent units. */
export function spotFillAmounts(
  observation: { actualInputRaw: string; actualOutputRaw: string } | null,
  context: SpotTradeContext | null,
): { base: number | null; quote: number | null; price: number | null } {
  if (!observation || !context) return { base: null, quote: null, price: null };
  const baseRaw = context.side === "BUY" ? observation.actualOutputRaw : observation.actualInputRaw;
  const quoteRaw = context.side === "BUY" ? observation.actualInputRaw : observation.actualOutputRaw;
  const base = Number(scaleRawAmount(baseRaw, context.baseDecimals).replace(/,/g, ""));
  const quote = Number(scaleRawAmount(quoteRaw, context.quoteDecimals).replace(/,/g, ""));
  return {
    base: Number.isFinite(base) ? base : null,
    quote: Number.isFinite(quote) ? quote : null,
    price: base > 0 && Number.isFinite(quote / base) ? quote / base : null,
  };
}
