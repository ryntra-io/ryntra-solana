/**
 * Watching a pool position (SOL-2b): against what went in, what the price's
 * divergence took (impermanent loss: the position now against the same tokens
 * kept in the wallet), the net result once fees are counted, and — when the
 * price has left the range or nears its edge — what a rebalance would be.
 *
 * The entry is what the person put in: recorded by Ryntra when the deposit
 * went through its own Review, or typed by the person for a position opened
 * elsewhere. The chain keeps no such record, so without an entry there is no
 * loss to show and the page says so rather than guess one.
 *
 * Nothing here acts: a rebalance is a withdrawal and a new deposit, each
 * through its own Review and the person's signature. Automation is SOL-6.
 *
 * Pure and client-safe. Floats: a picture for reading, never a sum a
 * transaction is sized from.
 */

import type { PositionView } from "./positions.ts";

export type PositionEntry = Readonly<{
  /** What is in the position by the person's own deposits, each token's own unit, less what was withdrawn since. */
  x: number;
  y: number;
  /** That deposit's USD value when it went in; null when typed or unpriced. */
  usd: number | null;
  /** Fees claimed through Ryntra since, USD at the claim's prices. */
  claimedUsd: number;
  /** ms. */
  at: number;
  /** `ryntra` — read from the Review the person signed; `typed` — what the person told the page. */
  source: "ryntra" | "typed";
  /**
   * Set when a deposit landed and the chain has not been read since: the Review states what goes in *at most* (on
   * DAMM v2 the cap is the sized amount plus slippage), so the first read of the position soon after settles the amounts
   * the program actually took, valued at these prices — `settleEntry`.
   */
  pending?: Readonly<{ xPriceUsd: number | null; yPriceUsd: number | null }>;
}>;

/** How long after a deposit the first read still tells what went in: later, the price has moved the amounts. */
export const SETTLE_WINDOW_MS = 15 * 60_000;

/**
 * A pending entry and the first read of its position after the deposit: the position's own amounts are what went in
 * (a position cannot appear in a read from before its deposit, so any read that holds it will do). Too late a read
 * leaves no entry: the Review's figures are caps, up to the slippage high, and the person types the entry instead.
 * `view.at` is the server's clock and `entry.at` the browser's; the window is wide enough for the two to differ.
 */
export function settleEntry(entry: PositionEntry, view: Pick<PositionView, "x" | "y" | "at">): PositionEntry | null {
  if (!entry.pending) return entry;
  const { pending: prices, ...rest } = entry;
  if (view.at - entry.at > SETTLE_WINDOW_MS || view.x.amount + view.y.amount <= 0) return null;
  const usd = prices.xPriceUsd !== null && prices.yPriceUsd !== null ? view.x.amount * prices.xPriceUsd + view.y.amount * prices.yPriceUsd : null;
  return { ...rest, x: view.x.amount, y: view.y.amount, usd };
}

/** The share a token may fall short of its entry before the two can no longer be the same deposit. */
export const ENTRY_TOLERANCE = 0.02;

/**
 * A price move trades one token for the other, so at least one side holds no less than went in. Both short — the
 * position changed where Ryntra did not see it (a withdrawal on Meteora, another browser): the entry no longer holds,
 * and no loss is drawn from it.
 */
export function entryMatches(view: Pick<PositionView, "x" | "y">, entry: PositionEntry): boolean {
  const short = (held: number, put: number) => put > 0 && held < put * (1 - ENTRY_TOLERANCE);
  return !(short(view.x.amount, entry.x) && short(view.y.amount, entry.y));
}

export type PositionResult = Readonly<{
  /** The entry's tokens kept in the wallet, at today's prices, USD. */
  hold: number;
  /** Position value − hold: the divergence loss (negative) or gain, before fees. */
  divergence: number;
  divergencePct: number;
  /** Unclaimed + claimed-through-Ryntra fees, USD. */
  fees: number;
  /** divergence + fees: the position against holding the same tokens. */
  net: number;
  netPct: number;
  /** Value + fees − what went in at its own prices; null when the entry carries no USD value. */
  sinceDeposit: number | null;
}>;

const finite = (value: number): boolean => Number.isFinite(value);
const nonNegative = (value: number): boolean => finite(value) && value >= 0;

/** A position's result against its entry; null without prices, without an entry, or with one the position no longer matches. */
export function positionResult(view: PositionView, entry: PositionEntry | null): PositionResult | null {
  if (!entry || !entryMatches(view, entry) || view.valueUsd === null || view.x.priceUsd === null || view.y.priceUsd === null) return null;
  if (!nonNegative(entry.x) || !nonNegative(entry.y) || entry.x + entry.y <= 0) return null;
  const hold = entry.x * view.x.priceUsd + entry.y * view.y.priceUsd;
  if (!(hold > 0)) return null;
  const divergence = view.valueUsd - hold;
  const fees = (view.unclaimedUsd ?? 0) + (nonNegative(entry.claimedUsd) ? entry.claimedUsd : 0);
  const net = divergence + fees;
  return {
    hold,
    divergence,
    divergencePct: (divergence / hold) * 100,
    fees,
    net,
    netPct: (net / hold) * 100,
    sinceDeposit: entry.usd !== null && entry.usd > 0 ? view.valueUsd + fees - entry.usd : null,
  };
}

/* ------------------------------------------------------------------ the entry as actions change it */

export type AddedAmounts = Readonly<{ x: number; y: number; xPriceUsd: number | null; yPriceUsd: number | null; at: number }>;

/**
 * After a deposit that landed: a new position starts a pending entry from the Review's figures, which the first read
 * settles. A deposit into an existing position leaves no entry — what it took cannot be told apart from what the price
 * moved, and half an entry would draw a false loss; the person can type it again.
 */
export function entryAfterAdd(entry: PositionEntry | null, added: AddedAmounts, opensPosition: boolean): PositionEntry | null {
  if (!nonNegative(added.x) || !nonNegative(added.y) || added.x + added.y <= 0) return entry;
  if (!opensPosition) return null;
  const priced = added.xPriceUsd !== null && added.yPriceUsd !== null;
  const usd = priced ? added.x * added.xPriceUsd! + added.y * added.yPriceUsd! : null;
  return { x: added.x, y: added.y, usd, claimedUsd: 0, at: added.at, source: "ryntra", pending: { xPriceUsd: added.xPriceUsd, yPriceUsd: added.yPriceUsd } };
}

/**
 * After a withdrawal that landed: the entry keeps the part still in. The share is of what may be withdrawn — a locked
 * part stays — so only a closed position loses its entry.
 */
export function entryAfterRemove(entry: PositionEntry | null, shareBps: number, closes: boolean, lockedBps = 0): PositionEntry | null {
  if (!entry) return null;
  if (closes) return null;
  const free = 1 - Math.min(Math.max(lockedBps, 0), 10_000) / 10_000;
  const keep = 1 - (Math.min(Math.max(shareBps, 0), 10_000) / 10_000) * free;
  if (keep <= 0) return null;
  return { ...entry, x: entry.x * keep, y: entry.y * keep, usd: entry.usd === null ? null : entry.usd * keep, claimedUsd: entry.claimedUsd * keep };
}

/** After a claim that landed: the fees leave the position and are counted with what it earned. */
export function entryAfterClaim(entry: PositionEntry | null, claimedUsd: number | null): PositionEntry | null {
  if (!entry || claimedUsd === null || !nonNegative(claimedUsd)) return entry;
  return { ...entry, claimedUsd: entry.claimedUsd + claimedUsd };
}

/** What the person typed: two amounts, one may be zero; null when it is not an entry. */
export function typedEntry(x: number, y: number, at: number): PositionEntry | null {
  if (!nonNegative(x) || !nonNegative(y) || x + y <= 0) return null;
  return { x, y, usd: null, claimedUsd: 0, at, source: "typed" };
}

/** An entry as stored, checked field by field: anything else is no entry. */
export function readEntry(raw: unknown): PositionEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const number = (key: string): number | null => (typeof value[key] === "number" && finite(value[key] as number) ? (value[key] as number) : null);
  const x = number("x");
  const y = number("y");
  const at = number("at");
  const claimedUsd = number("claimedUsd") ?? 0;
  const usd = value.usd === null ? null : number("usd");
  const source = value.source === "ryntra" || value.source === "typed" ? value.source : null;
  if (x === null || y === null || at === null || source === null || !nonNegative(x) || !nonNegative(y) || x + y <= 0) return null;
  const read: PositionEntry = { x, y, usd: usd !== null && usd >= 0 ? usd : null, claimedUsd: claimedUsd >= 0 ? claimedUsd : 0, at, source };
  const pending = value.pending && typeof value.pending === "object" ? (value.pending as Record<string, unknown>) : null;
  if (!pending) return read;
  const price = (key: string): number | null => (typeof pending[key] === "number" && finite(pending[key] as number) && (pending[key] as number) >= 0 ? (pending[key] as number) : null);
  return { ...read, pending: { xPriceUsd: price("xPriceUsd"), yPriceUsd: price("yPriceUsd") } };
}

/* ------------------------------------------------------------------ rebalance */

/** A price within this share of the range's width (counted in ratio, as bins are) from an edge is near it. */
export const NEAR_EDGE_SHARE = 0.1;

export type RebalanceAdvice =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "near_edge"; edge: "upper" | "lower"; /** Percent the price may still move before it leaves. */ leftPct: number }>
  | Readonly<{
      kind: "out";
      /** Where the price is against the range (the opposite of `rangeState`, which says where the range is). */
      price: "above" | "below";
      /** How far past the edge the price is, percent; null without a price. */
      pastPct: number | null;
      /** The same width around the price now; null when the position has no bounds or no price. */
      reopen: Readonly<{ lower: number; upper: number; span: number }> | null;
      /** All of the position is now one token. */
      holds: "x" | "y";
    }>;

/**
 * What the position asks of the person. Out of range it earns nothing: the suggestion is to withdraw and open the same
 * width around the price — or wait, if the person expects the price back, since a rebalance makes the loss final.
 */
export function rebalanceAdvice(view: Pick<PositionView, "rangeState" | "lower" | "upper"> & { price?: number | null }): RebalanceAdvice {
  const price = view.price ?? null;
  const lower = view.lower;
  const upper = view.upper;
  const bounded = lower !== null && upper !== null && lower > 0 && upper > lower && finite(upper);
  if (view.rangeState !== "in_range") {
    /* `rangeState: "above"` — the range sits above the price, so the price is below it; and the other way. */
    const at = view.rangeState === "above" ? "below" : "above";
    /* The venue's price beside the chain's state: one on the wrong side of the edge is behind it, and gives no distance. */
    const pricedOk = price !== null && price > 0 && finite(price) && !(at === "above" && upper !== null && price <= upper) && !(at === "below" && lower !== null && price >= lower);
    const edge = at === "above" ? upper : lower;
    const pastPct = pricedOk && edge !== null && edge > 0 ? Math.abs(price! / edge - 1) * 100 : null;
    const span = bounded ? upper! / lower! : null;
    const reopen = span !== null && pricedOk ? { lower: price! / Math.sqrt(span), upper: price! * Math.sqrt(span), span } : null;
    /* With the price above the range every step has sold X for Y; below it every step has bought X. */
    return { kind: "out", price: at, pastPct, reopen, holds: at === "above" ? "y" : "x" };
  }
  if (!bounded || price === null || !(price > 0) || price < lower! || price > upper!) return { kind: "none" };
  const width = Math.log(upper! / lower!);
  const toUpper = Math.log(upper! / price);
  const toLower = Math.log(price / lower!);
  if (toUpper <= width * NEAR_EDGE_SHARE) return { kind: "near_edge", edge: "upper", leftPct: (upper! / price - 1) * 100 };
  if (toLower <= width * NEAR_EDGE_SHARE) return { kind: "near_edge", edge: "lower", leftPct: (1 - lower! / price) * 100 };
  return { kind: "none" };
}

/** The half-width in bins nearest to a span (upper / lower) at a bin step: what the add form's widths are measured in. */
export function halfBinsOfSpan(span: number, binStepBps: number): number | null {
  if (!(span > 1) || !finite(span) || !(binStepBps > 0)) return null;
  const bins = Math.log(span) / Math.log(1 + binStepBps / 10_000);
  return Math.max(0, Math.round(bins / 2));
}
