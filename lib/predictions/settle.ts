/**
 * Settlement, read from the provider's own words: where each market of the
 * person stands on the way to being decided, when it is decided, and whether
 * a win is waiting to be paid.
 *
 * Nothing here decides anything and nothing here moves money: it reads a
 * position's `marketStatus`, `redeemStatus`, `resolutionDate` and winners and
 * says, in one word, what the person is waiting for. The provider states no
 * list of redeem statuses, so a status whose meaning is known is said in
 * words and any other is `unknown` with the provider's own word kept beside
 * it — never as paid.
 *
 * Pure: the server (`settle-run.ts`) and the pages read it the same way.
 */

import type { PaperPosition } from "./model.ts";

/** How long before the stated settlement moment a market is called due soon. */
export const SETTLE_WARN_MS = 24 * 3_600_000;
/**
 * How long past the stated settlement moment (or, with none stated, past the
 * market closing) a decision is overdue. Venues take hours over a close
 * result; two days is longer than any of them says it needs.
 */
export const SETTLE_LATE_MS = 48 * 3_600_000;

/** What the provider says about paying this position out. */
export type RedeemPhase = "eligible" | "paid" | "pending" | "not_needed" | "disputed" | "unknown";

/**
 * The provider's redeem status in Ryntra's terms. `not_needed` — the venue
 * pays a winning position itself, so there is nothing to ask for; `pending` —
 * it has been asked and the venue has not finished; `disputed` — the result
 * is contested, voided or cancelled, and no payout is due yet.
 */
export function redeemPhase(status: unknown): RedeemPhase {
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (/^(eligible|redeemable|claimable|payable)$/.test(s)) return "eligible";
  if (/^(redeemed|claimed|paid|settled|complete|completed)$/.test(s)) return "paid";
  if (/^(pending|redeeming|claiming|submitted|processing|in_progress)$/.test(s)) return "pending";
  if (/^(not_eligible|ineligible|not_required|none|auto|automatic|not_applicable|n\/a)$/.test(s)) return "not_needed";
  if (/^(disputed|contested|void|voided|cancelled|canceled|invalid|under_review)$/.test(s)) return "disputed";
  return "unknown";
}

/** The venue's own market status in the product's four words (the hub reads markets the same way). */
export function marketPhase(status: unknown): "open" | "closed" | "resolved" | "unknown" {
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (s === "open" || s === "active" || s === "trading") return "open";
  if (s === "closed" || s === "ended" || s === "pending_resolution") return "closed";
  if (s === "resolved" || s === "settled" || s === "finalized") return "resolved";
  return "unknown";
}

/**
 * Where one market of the person stands.
 *
 * - `trading`   — open, the settlement moment is further off than the warning;
 * - `due_soon`  — open, decided within the next day;
 * - `awaiting`  — stopped trading, not decided yet, still inside the window;
 * - `late`      — not decided well past when it should have been;
 * - `disputed`  — the provider says the result is contested, void or cancelled;
 * - `payable`   — decided in the person's favour and the provider will pay it
 *                 when asked: this is what collects itself;
 * - `collecting`— asked, the venue has not confirmed;
 * - `paid`      — the provider says it is paid;
 * - `venue_pays`— decided in the person's favour, nothing to ask: the venue
 *                 credits it itself;
 * - `lost`      — decided, and not the person's side;
 * - `unknown`   — the provider's words do not say.
 */
export type SettlePhase = "trading" | "due_soon" | "awaiting" | "late" | "disputed" | "payable" | "collecting" | "paid" | "venue_pays" | "lost" | "unknown";

export type SettleRow = Readonly<{
  /** The Ryntra event where there is one, so a row links to the market page. */
  eventId: string | null;
  venueEventId: string;
  question: string;
  phase: SettlePhase;
  /** When the provider says the market is decided; null when it states no moment. */
  resolutionDate: string | null;
  /** The provider's own two words, kept for Details — never shown as the product's. */
  providerMarketStatus: string;
  providerRedeemStatus: string;
  /** What the position is worth as the provider marks it, and the winning side where there is one. */
  valueUsd: number;
  winningLabel: string | null;
  /** The outcome ids a collect would name, one per venue the position is held on. */
  outcomeIds: readonly string[];
}>;

function valueOf(position: PaperPosition): number {
  return position.outcomes.reduce((sum, o) => sum + (Number.isFinite(o.totalValue) ? o.totalValue : 0), 0);
}

/** The winning outcomes the person holds, and the venue outcome ids under them. */
function won(position: PaperPosition): Readonly<{ label: string | null; outcomeIds: readonly string[] }> {
  const winners = position.outcomes.filter((o) => o.winner === true && o.totalSize > 0);
  return { label: winners[0]?.label ?? null, outcomeIds: winners.flatMap((o) => o.venues.map((v) => v.outcomeId)) };
}

/**
 * One market's row. `collecting` is passed in rather than read: only Ryntra's
 * own record knows a collect was asked for, and the provider may still mark
 * the position payable while the venue works.
 */
export function settleRow(position: PaperPosition, nowMs: number, asked = false): SettleRow {
  const market = marketPhase(position.marketStatus);
  const redeem = redeemPhase(position.redeemStatus);
  const win = won(position);
  const decidedAt = position.resolutionDate ? Date.parse(position.resolutionDate) : NaN;
  const base = {
    eventId: position.eventId,
    venueEventId: position.venueEventId,
    question: position.question,
    resolutionDate: position.resolutionDate,
    providerMarketStatus: String(position.marketStatus ?? "").slice(0, 40),
    providerRedeemStatus: String(position.redeemStatus ?? "").slice(0, 40),
    valueUsd: valueOf(position),
    winningLabel: win.label,
    outcomeIds: win.outcomeIds,
  };
  const phase = ((): SettlePhase => {
    if (redeem === "disputed") return "disputed";
    if (redeem === "eligible" && win.outcomeIds.length > 0) return asked ? "collecting" : "payable";
    if (redeem === "pending") return "collecting";
    if (redeem === "paid") return "paid";
    if (market === "open") return Number.isFinite(decidedAt) && decidedAt - nowMs <= SETTLE_WARN_MS ? "due_soon" : "trading";
    /* Decided: the person's side won and the venue pays it itself, or it did not win. */
    if (market === "resolved" || position.outcomes.some((o) => o.winner !== null)) {
      if (win.outcomeIds.length === 0) return "lost";
      return redeem === "not_needed" ? "venue_pays" : "unknown";
    }
    /* Stopped trading and nothing decided yet: late only once it is past the moment it was promised for. */
    const from = Number.isFinite(decidedAt) ? decidedAt : NaN;
    if (Number.isFinite(from)) return nowMs - from >= SETTLE_LATE_MS ? "late" : "awaiting";
    return market === "unknown" ? "unknown" : "awaiting";
  })();
  return { ...base, phase };
}

/** Phases that are still waiting on something: the calendar's own rows. */
const WAITING: ReadonlySet<SettlePhase> = new Set(["trading", "due_soon", "awaiting", "late", "disputed", "payable", "collecting", "unknown"]);

export type SettleCalendar = Readonly<{
  /** Markets still waiting on a decision or a payout, soonest first; a market with no stated moment last. */
  rows: readonly SettleRow[];
  /** Decided within the next day — what the person is warned about. */
  dueSoon: readonly SettleRow[];
  /** Past when they should have been decided. */
  late: readonly SettleRow[];
  /** The provider says the result is contested, void or cancelled. */
  disputed: readonly SettleRow[];
  /** Decided in the person's favour and waiting to be paid, or being paid now. */
  collecting: readonly SettleRow[];
  readAt: string;
}>;

/**
 * The person's settlement calendar: when each open market of theirs is
 * decided, which are due within the day, which are overdue, which are
 * contested, and which wins are on their way in. Positions already paid, or
 * decided against the person, are not in it: nothing is waited for there.
 */
export function settleCalendar(positions: readonly PaperPosition[], nowMs: number, asked: ReadonlySet<string> = new Set()): SettleCalendar {
  const rows = positions
    .map((p) => settleRow(p, nowMs, asked.has(p.venueEventId)))
    .filter((r) => WAITING.has(r.phase))
    .sort((a, b) => {
      const at = a.resolutionDate ? Date.parse(a.resolutionDate) : Number.POSITIVE_INFINITY;
      const bt = b.resolutionDate ? Date.parse(b.resolutionDate) : Number.POSITIVE_INFINITY;
      return (Number.isNaN(at) ? Number.POSITIVE_INFINITY : at) - (Number.isNaN(bt) ? Number.POSITIVE_INFINITY : bt) || a.question.localeCompare(b.question);
    });
  return {
    rows,
    dueSoon: rows.filter((r) => r.phase === "due_soon"),
    late: rows.filter((r) => r.phase === "late"),
    disputed: rows.filter((r) => r.phase === "disputed"),
    collecting: rows.filter((r) => r.phase === "payable" || r.phase === "collecting"),
    readAt: new Date(nowMs).toISOString(),
  };
}

/**
 * The one request id a market's payout is always asked under: the wallet and
 * the market, so the same market never opens a second collect — not on a
 * second sweep, not on two instances at once, not after a restart that lost
 * the answer. The outcome ids are not in it: the provider may mark one venue
 * payable before another, and both belong to the one payout of that market.
 */
export function collectRequestId(wallet: string, venueEventId: string): string {
  return `${wallet}:${venueEventId}`;
}
