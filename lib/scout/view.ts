/**
 * What the Scout shows: the answer of its route (`GET /api/v1/scout`) — the paper positions open and closed, the latest
 * decisions worth reading, what the bars cut most today — and the one-line check of each coin the market's «New» column
 * asks about (`?part=checks&mints=…`). Public data only: no person, no wallet, no key.
 *
 * Pure and client-safe: the screen reads the same types.
 */

import type { ScoutDesk } from "./desk.ts";
import { refusalsOf, type JournalEntry, type JournalHour, type ScoutCheck } from "./journal.ts";
import type { PaperPosition } from "./paper.ts";

export type ScoutView = Readonly<{
  /** The Scout runs on this deployment. */
  on: boolean;
  observedAt: string;
  pass: Readonly<{ at: number; seen: number; screened: number; took: number }> | null;
  open: readonly PaperPosition[];
  closed: readonly PaperPosition[];
  /** The latest decisions worth reading, the newest first: buys and exits, theses, refusals past the free screen. */
  decisions: readonly JournalEntry[];
  /** What the bars cut most today, the most first; a read that did not happen is no bar. */
  refusals: readonly (readonly [string, number])[];
}>;

export type ScoutChecks = Readonly<{ on: boolean; checks: Readonly<Record<string, ScoutCheck>> }>;

export const VIEW_CLOSED = 50;
export const VIEW_DECISIONS = 30;
export const CHECK_MINTS_MAX = 60;

/**
 * The codes that say a read did not happen rather than what the coin is. They never stand as a bar that «cut most», and
 * a line says one of them only where the coin has no other reason.
 */
export const UNREAD_CODES: ReadonlySet<string> = new Set(["rights_unread", "holders_unread", "facts_unread", "liquidity_unread", "price_unread"]);

export const isUnread = (code: string): boolean => UNREAD_CODES.has(code);

/** Whether an entry is worth a person's reading: anything past the free screen. */
export const notable = (entry: JournalEntry): boolean => entry.stage !== "screen";

export function viewOf(input: Readonly<{ on: boolean; desk: ScoutDesk | null; hours: readonly JournalHour[]; now: number }>): ScoutView {
  const { desk } = input;
  const entries = input.hours.flatMap((hour) => hour.entries).filter(notable).sort((a, b) => b.at - a.at);
  const today = new Date(input.now).toISOString().slice(0, 10);
  return {
    on: input.on,
    observedAt: new Date(input.now).toISOString(),
    pass: desk?.pass ? { at: desk.pass.at, seen: desk.pass.seen, screened: desk.pass.screened, took: desk.pass.took } : null,
    open: desk?.open ?? [],
    closed: (desk?.closed ?? []).slice(0, VIEW_CLOSED),
    decisions: entries.slice(0, VIEW_DECISIONS).map(({ figures: _figures, ...rest }) => rest),
    refusals: refusalsOf(input.hours.filter((hour) => hour.hour.startsWith(today)))
      .filter(([code]) => !isUnread(code))
      .slice(0, 6),
  };
}

/** Valid mints from a query, each once, at most `CHECK_MINTS_MAX`. */
export function mintsOf(query: string | null): string[] {
  if (!query) return [];
  const out: string[] = [];
  for (const part of query.split(",")) {
    const mint = part.trim();
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) && !out.includes(mint)) out.push(mint);
    if (out.length >= CHECK_MINTS_MAX) break;
  }
  return out;
}

/** The checks of the mints asked about; a coin the Scout has not decided on is absent. */
export function checksFor(desk: ScoutDesk | null, mints: readonly string[]): Record<string, ScoutCheck> {
  const out: Record<string, ScoutCheck> = {};
  if (!desk) return out;
  for (const mint of mints) {
    const check = desk.checks[mint];
    if (check) out[mint] = check;
  }
  return out;
}
