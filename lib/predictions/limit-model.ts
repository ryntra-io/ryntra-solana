/**
 * A limit order on a market of outcomes: the price the person names, the
 * amount they put behind it, how long it stands, and the state it is visibly
 * in — accepted, partly filled, filled, cancelled, lapsed.
 *
 * A limit order is nothing like a market order here. There is no smart route
 * and no quote to age out: one venue, one price, one size, one order. So the
 * figures are arithmetic the person can check — contracts at the price,
 * Ryntra's rate on them, the payout a share pays if the outcome wins — and
 * the one figure nobody can know in advance is said to be unknown rather
 * than printed as zero: the venue takes its own fee out of what actually
 * fills, and does not name it before the order fills.
 *
 * Two things the aggregator decides, not this file: whether the size suits
 * the market (it validates `sizeRaw` itself) and what the order's state is
 * once it is live. What this file does decide is the price grid — a limit
 * price is moved to the venue's tick **in the person's favour**, never
 * against them — and, with real money switched off, the simulated fill:
 * the aggregator has no paper limit order (its limit call takes no mode), so
 * a simulated one is Ryntra's own and is marked as a simulation everywhere a
 * person reads it.
 *
 * This file is the model — the shapes, the grid, the arithmetic and the
 * states — and imports nothing of the server, so the ticket in the browser
 * computes what it shows the one way the server computes what it stores.
 */

import { RYNTRA_BUY_FEE_BIPS } from "./costs.ts";
import type { PredictionBookLevel } from "./model.ts";
import type { PredictionPlanRules } from "./plan-model.ts";

/** Ryntra's own id for a limit Review and the order it becomes; also the `clientOrderId` the venue is given. */
export const LIMIT_ID = /^plim_[0-9a-f]{24}$/;

/** Prices and sizes travel to the aggregator as integers of a millionth. */
export const LIMIT_RAW_SCALE = 1_000_000;

/**
 * Shares are aligned down to a hundredth of a share. The aggregator
 * validates the size against the market's own floor and step and may still
 * refuse it; the Review says so rather than promising the venue will take it.
 */
export const LIMIT_SIZE_STEP = 0.01;

/** A price is a probability: never 0 and never 1, because neither is a market. */
export const LIMIT_PRICE_MIN = 0.001;
export const LIMIT_PRICE_MAX = 0.999;

/** The least and the most a limit order may put on an outcome; a live one is capped lower still (`live.ts`). */
export const LIMIT_MIN_AMOUNT_USD = 1;
export const LIMIT_MAX_AMOUNT_USD = 10_000;

/** How long a limit Review stands before its figures are re-read. */
export const LIMIT_REVIEW_MAX_AGE_S = 90;

/** How long after the Review's own expiry a send that left no trace is still waited on. */
export const LIMIT_UNSEEN_GRACE_MS = 2 * 60_000;

/* ------------------------------------------------------------- how long it stands */

/** How long the order stands: a window, or until the person cancels it. */
export const LIMIT_LIVES = Object.freeze(["1h", "6h", "1d", "3d", "7d", "until_cancelled"] as const);
export type LimitLife = (typeof LIMIT_LIVES)[number];

const LIFE_MS: Readonly<Record<Exclude<LimitLife, "until_cancelled">, number>> = { "1h": 3_600_000, "6h": 6 * 3_600_000, "1d": 86_400_000, "3d": 3 * 86_400_000, "7d": 7 * 86_400_000 };

export function isLimitLife(value: unknown): value is LimitLife {
  return typeof value === "string" && (LIMIT_LIVES as readonly string[]).includes(value);
}

/** When the order lapses by itself; null — it stands until it is cancelled. */
export function limitExpiryAt(life: LimitLife, nowMs: number): string | null {
  return life === "until_cancelled" ? null : new Date(nowMs + LIFE_MS[life]).toISOString();
}

/** The venue's own word for how long the order stands: good till cancelled, or good till a date. */
export function limitTimeInForce(life: LimitLife): "GTC" | "GTD" {
  return life === "until_cancelled" ? "GTC" : "GTD";
}

/* ------------------------------------------------------------- the price grid */

const microOf = (value: number) => Math.round(value * LIMIT_RAW_SCALE);

/**
 * The price the venue's grid takes, moved in the person's favour: a buy
 * rounds down (never pay more than was named), a sell rounds up. With no
 * tick stated the price is kept to a millionth, the finest the aggregator
 * carries.
 */
export function alignLimitPrice(price: number, tickSize: number | null | undefined, side: "buy" | "sell" = "buy"): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const micro = microOf(price);
  const tick = tickSize != null && Number.isFinite(tickSize) && tickSize > 0 ? microOf(tickSize) : 1;
  if (tick <= 1) return micro / LIMIT_RAW_SCALE;
  const steps = side === "buy" ? Math.floor(micro / tick) : Math.ceil(micro / tick);
  return (steps * tick) / LIMIT_RAW_SCALE;
}

/** Shares aligned down to the step Ryntra sends; the venue checks them again. */
export function alignLimitShares(shares: number): number {
  if (!Number.isFinite(shares) || shares <= 0) return 0;
  const step = microOf(LIMIT_SIZE_STEP);
  return (Math.floor(microOf(shares) / step) * step) / LIMIT_RAW_SCALE;
}

/** A price or a size as the aggregator takes it: an integer of a millionth. */
export function limitRaw(value: number): string {
  return String(Math.max(0, microOf(value)));
}

/** The millionths of the aggregator back into a figure a person reads; null when it says nothing. */
export function fromLimitRaw(raw: string | null | undefined): number | null {
  if (typeof raw !== "string" || !/^-?\d{1,20}$/.test(raw)) return null;
  return Number(raw) / LIMIT_RAW_SCALE;
}

/* ------------------------------------------------------------- the arithmetic */

export type LimitFigures = Readonly<{
  /** The price on the venue's grid — what one share costs at most. */
  price: number;
  shares: number;
  /** The contracts themselves: shares at the price. A limit order never fills above it. */
  contractsUsd: number;
  ryntraBips: number;
  ryntraFeeUsd: number;
  /**
   * The venue's own fee. Null before the order fills: the venue takes it out
   * of what actually filled and names it only then, so it is never printed
   * as zero here.
   */
  venueFeeUsd: number | null;
  /** The contracts and Ryntra's fee — what Ryntra knows the order takes. The venue's own fee comes out of the filled part on top of it. */
  totalUsd: number;
  /** What the filled shares pay if the outcome wins: $1 a share. */
  payoutIfRightUsd: number;
  profitIfRightUsd: number;
  /** The whole of it: a prediction that resolves the other way pays nothing. */
  maxLossUsd: number;
  returnIfRightPct: number | null;
}>;

const cents = (usd: number) => Math.round(usd * 100) / 100;
const atoms = (usd: number) => Math.round(usd * 1e6) / 1e6;

/**
 * What the amount buys at the price, with Ryntra's rate taken off the top
 * the same way the ticket's own estimate takes it (`payoutEstimate`): the
 * amount is everything the order may take, so the contracts are what is
 * left of it once Ryntra's rate is set aside.
 */
export function limitFigures(input: Readonly<{ price: number; amountUsd: number; bips?: number; venueFeeUsd?: number | null }>): LimitFigures {
  const bips = input.bips ?? RYNTRA_BUY_FEE_BIPS;
  const price = input.price;
  const budget = Number.isFinite(input.amountUsd) ? Math.max(0, input.amountUsd) : 0;
  const shares = price > 0 ? alignLimitShares(budget / (1 + bips / 10_000) / price) : 0;
  const contractsUsd = atoms(shares * price);
  const ryntraFeeUsd = atoms((contractsUsd * bips) / 10_000);
  const venueFeeUsd = input.venueFeeUsd ?? null;
  const totalUsd = atoms(contractsUsd + ryntraFeeUsd);
  const payoutIfRightUsd = cents(shares);
  const profitIfRightUsd = cents(payoutIfRightUsd - totalUsd);
  return {
    price,
    shares,
    contractsUsd,
    ryntraBips: bips,
    ryntraFeeUsd,
    venueFeeUsd,
    totalUsd,
    payoutIfRightUsd,
    profitIfRightUsd,
    maxLossUsd: cents(totalUsd),
    returnIfRightPct: totalUsd > 0 ? Math.round((profitIfRightUsd / totalUsd) * 10_000) / 100 : null,
  };
}

/* ------------------------------------------------------------- the state */

/**
 * Where a limit order stands, as a person reads it.
 *
 * `reviewed` — a Review nobody has confirmed yet, so no venue has it.
 * `sending` — confirmed and on its way; the venue has not answered.
 * `accepted` — the venue holds it and nothing has filled.
 * `partially_filled` — part of it filled; the rest may still fill or be cancelled.
 * `filled` · `cancelled` · `expired` — finished.
 * `failed` — the venue refused it, or it never reached one.
 */
export const LIMIT_ORDER_STATES = Object.freeze(["reviewed", "sending", "accepted", "partially_filled", "filled", "cancelled", "expired", "failed"] as const);
export type LimitOrderState = (typeof LIMIT_ORDER_STATES)[number];

/** Provider statuses that mean the venue still holds something of the order. */
export const LIMIT_WORKING_STATUSES: ReadonlySet<string> = new Set(["pending", "signing", "pending_bridge", "submitting", "submitted", "open", "partially_filled_open", "cancel_pending"]);

/** The state a provider status and what has filled add up to. An unknown status is never read as finished. */
export function limitStateOf(status: string | null | undefined, filledShares: number): LimitOrderState {
  const word = String(status ?? "").toLowerCase();
  if (word === "filled") return "filled";
  if (word === "cancelled" || word === "canceled") return "cancelled";
  if (word === "expired") return "expired";
  if (word === "failed" || word === "rejected") return "failed";
  if (word === "partial_fill") return "partially_filled";
  if (filledShares > 0) return "partially_filled";
  return word === "" ? "sending" : "accepted";
}

/** Whether the order is still the venue's to fill. */
export function limitWorking(state: LimitOrderState): boolean {
  return state === "sending" || state === "accepted" || state === "partially_filled";
}

/** Whether the person may cancel what is left: the venue still holds something of it. */
export function limitCancellable(record: Readonly<{ state: LimitOrderState; providerStatus?: string | null }>): boolean {
  if (!limitWorking(record.state)) return false;
  if (record.state === "sending") return false;
  const status = record.providerStatus;
  return status == null || status === "" || LIMIT_WORKING_STATUSES.has(status.toLowerCase());
}

/* ------------------------------------------------------------- the simulation */

export type LimitFill = Readonly<{ shares: number; usd: number; avgPrice: number | null }>;

/**
 * What a limit buy would fill against a book, cheapest level first, at or
 * below its price — Ryntra's own arithmetic over the venue's real book.
 *
 * With real money switched off this is the whole of the fill: the aggregator
 * has no paper limit order, so a simulated one is filled here and marked a
 * simulation wherever it is shown. It never fills more than the book shows
 * and never above the price named.
 */
export function limitFillAgainstBook(asks: readonly PredictionBookLevel[], price: number, remainingShares: number): LimitFill {
  let left = remainingShares;
  let shares = 0;
  let usd = 0;
  for (const level of [...asks].filter((l) => l.size > 0 && l.price > 0 && l.price <= price + 1e-9).sort((a, b) => a.price - b.price)) {
    if (left <= 1e-9) break;
    const take = Math.min(left, level.size);
    shares += take;
    usd += take * level.price;
    left -= take;
  }
  const filled = alignLimitShares(shares);
  if (filled <= 0) return { shares: 0, usd: 0, avgPrice: null };
  const spent = atoms(shares > 0 ? (usd * filled) / shares : 0);
  return { shares: filled, usd: spent, avgPrice: filled > 0 ? atoms(spent / filled) : null };
}

/** The best price on each side of a book, or null where it has none. */
export function bookEdges(asks: readonly PredictionBookLevel[], bids: readonly PredictionBookLevel[]): Readonly<{ bestAsk: number | null; bestBid: number | null }> {
  const ask = asks.filter((l) => l.size > 0 && l.price > 0).map((l) => l.price);
  const bid = bids.filter((l) => l.size > 0 && l.price > 0).map((l) => l.price);
  return { bestAsk: ask.length > 0 ? Math.min(...ask) : null, bestBid: bid.length > 0 ? Math.max(...bid) : null };
}

/* ------------------------------------------------------------- the ticket's fingerprint */

/** What a limit Review was built for. A ticket changed in any of these makes the Review stale. */
export type LimitAsk = Readonly<{
  eventId: string;
  venueMarketId: string;
  outcomeId: string;
  priceInput: number;
  amountUsd: number;
  life: LimitLife;
  mode: "paper" | "live";
  planId?: string | null;
}>;

/**
 * The fingerprint of the ticket a Review belongs to. The browser compares
 * it on every change and stops offering a Review of a ticket that no longer
 * stands; the server stores it so the order placed is the one reviewed.
 */
export function limitSignature(ask: LimitAsk): string {
  return [ask.eventId, ask.venueMarketId, ask.outcomeId, microOf(ask.priceInput), microOf(ask.amountUsd), ask.life, ask.mode, ask.planId ?? ""].join("|");
}

/* ------------------------------------------------------------- plan → limit order */

/**
 * The limit order a plan asks for: the amount the plan allows, at the
 * highest price the plan is willing to pay — its bound where it set one,
 * the probability it was written at otherwise. Nothing is placed by this:
 * it fills the ticket in, and the person confirms the Review.
 */
export function limitFromPlan(rules: Pick<PredictionPlanRules, "amountUsd" | "entryProbability" | "maxProbability" | "outcomeId" | "venueMarketId" | "eventId">, life: LimitLife = "7d"): Readonly<{ outcomeId: string; venueMarketId: string; eventId: string; priceInput: number; amountUsd: number; life: LimitLife; from: "bound" | "entry" }> {
  const bound = rules.maxProbability;
  const from = bound != null && bound > 0 ? "bound" : "entry";
  const price = from === "bound" ? bound! : rules.entryProbability;
  return {
    outcomeId: rules.outcomeId,
    venueMarketId: rules.venueMarketId,
    eventId: rules.eventId,
    priceInput: Math.min(LIMIT_PRICE_MAX, Math.max(LIMIT_PRICE_MIN, price)),
    amountUsd: rules.amountUsd,
    life,
    from,
  };
}
