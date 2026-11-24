/**
 * The Scout's journal: every decision it makes, the refusals with their reasons included — so it shows whether the bars
 * cut the coins that went on to lose or the ones that went on to win. A coin is written when it is first seen and again
 * whenever its decision changes (refused for another reason, passed a stage, taken, half sold, closed) — not every pass
 * it is still refused for the same reason. The journal lives by the hour, a week of hours; an hour past its ceiling keeps
 * counting its refusals by reason without keeping each entry.
 *
 * The latest decision on each coin is also its check: the one line the market's «New» column shows beside the coin.
 *
 * Pure and client-safe.
 */

import type { ScreenFigures } from "./screen.ts";
import { SCOUT_JOURNAL } from "./rules.ts";
import type { ScoutThesis } from "./thesis.ts";

export const JOURNAL_STAGES = ["screen", "chain", "thesis", "risk", "paper"] as const;
export type JournalStage = (typeof JOURNAL_STAGES)[number];

/** refused — a bar or a rule said no; skip / watch — the thesis; took — a paper buy; half / closed — an exit. */
export const JOURNAL_OUTCOMES = ["refused", "skip", "watch", "took", "half", "closed"] as const;
export type JournalOutcome = (typeof JOURNAL_OUTCOMES)[number];

export type JournalEntry = Readonly<{
  at: number;
  mint: string;
  symbol: string;
  stage: JournalStage;
  outcome: JournalOutcome;
  /** The reasons: the bars failed, the thesis's codes, the exit. */
  codes: readonly string[];
  /** The numbers the screen judged, as read. */
  figures?: ScreenFigures;
  thesis?: ScoutThesis;
  /** A paper buy's or sale's lamports, and its per cent on a close. */
  lamports?: string;
  resultPct?: number;
}>;

/** A coin's latest decision: what the «New» column shows in one line. */
export type ScoutCheck = Readonly<{ at: number; stage: JournalStage; outcome: JournalOutcome; codes: readonly string[] }>;

export type JournalHour = Readonly<{
  version: number;
  key: string;
  /** `YYYY-MM-DDTHH`, UTC. */
  hour: string;
  entries: readonly JournalEntry[];
  /** Every refusal of the hour by reason, those past the ceiling included. */
  counts: Readonly<Record<string, number>>;
  /** Entries past the ceiling, counted and not kept. */
  dropped: number;
}>;

export const hourOf = (ms: number): string => new Date(ms).toISOString().slice(0, 13);

/** A check is kept this long after the coin was last decided on. */
export const CHECK_KEEP_MS = 6 * 60 * 60_000;
/** The most checks kept: the newest win. */
export const CHECKS_MAX = 600;

const signatureOf = (check: Pick<ScoutCheck, "stage" | "outcome" | "codes">) => `${check.stage}|${check.outcome}|${check.codes.join(",")}`;

export function checkOf(entry: JournalEntry): ScoutCheck {
  return { at: entry.at, stage: entry.stage, outcome: entry.outcome, codes: entry.codes.slice(0, 3) };
}

/** Whether an entry says something new about its coin. An exit or a buy is always new. */
export function isNews(previous: ScoutCheck | undefined, entry: JournalEntry): boolean {
  if (!previous) return true;
  if (entry.outcome === "took" || entry.outcome === "half" || entry.outcome === "closed") return true;
  return signatureOf(previous) !== signatureOf(checkOf(entry));
}

/** The checks with a pass's entries in, the old ones out; and the entries that are news, for the journal. */
export function recordPass(checks: Readonly<Record<string, ScoutCheck>>, entries: readonly JournalEntry[], now: number): { checks: Record<string, ScoutCheck>; news: JournalEntry[] } {
  const next: Record<string, ScoutCheck> = {};
  for (const [mint, check] of Object.entries(checks)) if (now - check.at < CHECK_KEEP_MS) next[mint] = check;
  const news: JournalEntry[] = [];
  for (const entry of entries) {
    const previous = next[entry.mint];
    if (isNews(previous, entry)) news.push(entry);
    /* A coin still refused for the same reason keeps the time it was first refused for it; a new decision takes its own. */
    next[entry.mint] = previous && !isNews(previous, entry) ? previous : checkOf(entry);
  }
  /* The newest checks win when there are too many. */
  const kept = Object.entries(next).sort((a, b) => b[1].at - a[1].at).slice(0, CHECKS_MAX);
  return { checks: Object.fromEntries(kept), news };
}

/** An hour with new entries in: each refusal counted by reason, the entries kept up to the ceiling. */
export function appendHour(hour: JournalHour, entries: readonly JournalEntry[], ceiling: number = SCOUT_JOURNAL.perHour): JournalHour {
  const counts: Record<string, number> = { ...hour.counts };
  for (const entry of entries) if (entry.outcome === "refused") for (const code of entry.codes) counts[code] = (counts[code] ?? 0) + 1;
  const room = Math.max(0, ceiling - hour.entries.length);
  return { ...hour, version: hour.version + 1, entries: [...hour.entries, ...entries.slice(0, room)], counts, dropped: hour.dropped + Math.max(0, entries.length - room) };
}

export function emptyHour(key: string, hour: string): JournalHour {
  return { version: 0, key, hour, entries: [], counts: {}, dropped: 0 };
}

/** What the bars cut most over the hours given, the most first: the weekly review's first question. */
export function refusalsOf(hours: readonly JournalHour[]): [string, number][] {
  const total = new Map<string, number>();
  for (const hour of hours) for (const [code, count] of Object.entries(hour.counts)) total.set(code, (total.get(code) ?? 0) + count);
  return [...total.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
