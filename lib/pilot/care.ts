/**
 * CITY-204 — how the agent looks after the plan by itself, between the person's visits. Pure: one reading in, what to do
 * out; the server's pass (`./pass.server.ts`) reads the chain and the venues, this decides, the pass writes it down.
 *
 * What the agent does alone is only what the person's signed policy lets its key do — trade SOL for her coin, inside the
 * day's and the trade's caps, the coins straight to her wallet. So looking after the plan is:
 * - **a sharp fall** — SOL more than `crashBps` under its high of the last day: the trading pauses, and goes on once the
 *   fall is back under half of it, no sooner than six hours later;
 * - **a part grown past its share** — the trade's share more than `bandBps` over its target: the agent holds its buys
 *   until the share is back within half the band. That is how it rebalances by itself: new money stops going where there
 *   is too much;
 * - **the person's own exit** — «take +20 %», «stop −10 %» — is the trade's plan (`lib/mandate/plans.ts`), kept by the agent
 *   on every pass; a pause of the plan's own is never lifted here;
 * - **interest** — Jupiter Lend adds it to the position by itself (the jlToken's worth rises): nothing to claim, nothing to
 *   re-invest; the pier's fees are claimed and put back by the pier's own care (CITY-203's interface).
 *
 * A figure not read never moves anything: a hold stands until the agent can see it is over.
 */

import type { Mark } from "../mandate/plans.ts";
import { CARE, calmOf, PILOT_PARTS, sharesFrom, WORK_PARTS, type PilotPart, type PilotRules, type WorkPart } from "./plan.ts";

/** Why the agent holds the trade's buys: the market fell, or the trade's part outgrew its share. */
export type HoldWhy = "market" | "balance";
export const HOLD_REASONS: readonly HoldWhy[] = ["market", "balance"];
export const isHold = (value: unknown): value is HoldWhy => value === "market" || value === "balance";

/** The trade as the agent's book has it: working, paused (and why, since when), or no longer trading. */
export type TradeState = Readonly<{ status: "working" | "paused" | "stopped" | "ended" | "spent"; pausedBy: string | null; since: number }>;

export type CareInput = Readonly<{
  rules: PilotRules;
  /** The plan's shares, basis points. */
  targets: Readonly<Record<PilotPart, number>>;
  now: number;
  /** SOL's price in dollars, oldest first. */
  marks: readonly Mark[];
  /** Null — the plan has no trade part. */
  trade: TradeState | null;
  /** Each part's value now, USD; null — not read this time. */
  values: Readonly<Record<PilotPart, number | null>>;
}>;

export type Care = Readonly<{
  /** `hold` — pause the trade's buys; `go` — lift the agent's own pause; `leave` — nothing to change. */
  trade: Readonly<{ do: "hold"; why: HoldWhy }> | Readonly<{ do: "go" }> | Readonly<{ do: "leave" }>;
  /** SOL's fall under its high of the last day, basis points; null — not read. */
  fallBps: number | null;
  /** The shares now; null when a value was not read. */
  shares: Readonly<Record<PilotPart, number>> | null;
  /** The parts further than the band from their share. */
  drift: readonly WorkPart[];
}>;

const DAY = 86_400_000;

/** SOL's fall under its high of the last day, from fresh marks; null when the newest is not fresh or none is kept. */
export function fallOf(marks: readonly Mark[], now: number): number | null {
  const last = marks.at(-1);
  if (!last || now - last.at > CARE.markFreshMs || !(last.price > 0)) return null;
  let high = 0;
  for (const mark of marks) if (now - mark.at <= DAY && mark.price > high) high = mark.price;
  if (!(high > 0)) return null;
  return Math.max(0, Math.round(((high - last.price) / high) * 10_000));
}

/** SOL's price added at most every `CARE.markEveryMs`, the last two days kept. */
export function withMark(marks: readonly Mark[], at: number, price: number | null): readonly Mark[] {
  if (price === null || !Number.isFinite(price) || !(price > 0)) return marks;
  const last = marks.at(-1);
  if (last && at - last.at < CARE.markEveryMs) return marks;
  return [...marks, { at, price }].filter((mark) => at - mark.at <= CARE.marksKeptMs);
}

/** What the agent does now. */
export function careOf(input: CareInput): Care {
  const fallBps = fallOf(input.marks, input.now);
  const read = PILOT_PARTS.every((part) => input.values[part] !== null && Number.isFinite(input.values[part]!));
  const shares = read ? sharesFrom(input.values as Record<PilotPart, number>) : null;
  const band = input.rules.bandBps;
  const drift = shares ? WORK_PARTS.filter((part) => Math.abs(shares[part] - input.targets[part]) > band) : [];
  return { trade: tradeCare(input, fallBps, shares), fallBps, shares, drift };
}

function tradeCare(input: CareInput, fallBps: number | null, shares: Readonly<Record<PilotPart, number>> | null): Care["trade"] {
  const trade = input.trade;
  if (!trade || (trade.status !== "working" && trade.status !== "paused")) return { do: "leave" };
  /* A pause of the agent's own book — the person's exit, a loss, a failure — is never lifted here. */
  if (trade.status === "paused" && !isHold(trade.pausedBy)) return { do: "leave" };
  const held = trade.status === "paused" ? (trade.pausedBy as HoldWhy) : null;
  const { crashBps } = input.rules;
  const band = input.rules.bandBps;
  const target = input.targets.trade;

  /* The market first: a fall pauses whatever else holds. */
  if (fallBps !== null && fallBps >= crashBps) return held === "market" ? { do: "leave" } : { do: "hold", why: "market" };
  if (held === "market") {
    const calm = fallBps !== null && fallBps < calmOf(input.rules) && input.now - trade.since >= CARE.pauseMinMs;
    if (!calm) return { do: "leave" };
    /* Calm again — unless the trade's part is still over its share. */
    if (shares && shares.trade > target + band) return { do: "hold", why: "balance" };
    return shares || fallBps !== null ? { do: "go" } : { do: "leave" };
  }
  if (!shares) return { do: "leave" };
  if (held === "balance") return shares.trade <= target + Math.floor(band / 2) ? { do: "go" } : { do: "leave" };
  return shares.trade > target + band ? { do: "hold", why: "balance" } : { do: "leave" };
}

/* ---------------------------------------------------------------- what the plan earned */

/** The plan's result since it started, USD — kept a few times a day, eight days of it. */
export type Snap = Readonly<{ at: number; earnedUsd: number }>;

export const SNAP_EVERY_MS = 6 * 3_600_000;
export const SNAPS_KEPT_MS = 8 * DAY;
export const WEEK_MS = 7 * DAY;

export function withSnap(snaps: readonly Snap[], at: number, earnedUsd: number | null): readonly Snap[] {
  if (earnedUsd === null || !Number.isFinite(earnedUsd)) return snaps;
  const last = snaps.at(-1);
  if (last && at - last.at < SNAP_EVERY_MS) return snaps;
  return [...snaps, { at, earnedUsd }].filter((snap) => at - snap.at <= SNAPS_KEPT_MS);
}

/**
 * What the plan earned over the last week, USD — the result now less the result a week ago (zero before the plan's
 * start: a plan younger than a week counts from its start). A minus is a minus.
 */
export function weekOf(snaps: readonly Snap[], now: number, earnedUsdNow: number | null): number | null {
  if (earnedUsdNow === null || !Number.isFinite(earnedUsdNow)) return null;
  let base = 0;
  for (const snap of snaps) if (snap.at <= now - WEEK_MS) base = snap.earnedUsd;
  return earnedUsdNow - base;
}

/**
 * The plan's result since it started, USD: what the agent's trading made after every fee (CITY-197 `net`), the interest
 * the savings earned, and the pier's worth less what went in. A part not read leaves the whole unread — never a partial
 * figure shown as the whole.
 */
export function earnedOf(parts: Readonly<{ tradeUsd: number | null; saveUsd: number | null; poolUsd: number | null }>, has: Readonly<{ trade: boolean; save: boolean; pool: boolean }>): number | null {
  let sum = 0;
  for (const part of ["trade", "save", "pool"] as const) {
    if (!has[part]) continue;
    const value = parts[`${part}Usd`];
    if (value === null || !Number.isFinite(value)) return null;
    sum += value;
  }
  return Math.round(sum * 100) / 100;
}
