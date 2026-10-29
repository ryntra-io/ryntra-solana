import type { WorkspaceLocale } from "@/app/shell/locale";
import type { LaunchCabinetRow, LaunchStatsResponse } from "@/lib/api/v1/contract";
import { partOfFigure, type WindowFigure } from "../../../../lib/core/launch/creator-stats.ts";

import { formatCountShort, formatMoneyShort, formatRaw, fromRaw } from "../launch-format.ts";

/**
 * The cabinet's figures in words (SOL-L2): a window's figure in its currency — «$12,40», «≥ $3,10» where some of the
 * period was not read, or «not read» —, a count the same way, and a period's earnings over every launch, each currency
 * apart. Client-safe.
 */

export type Pair = LaunchCabinetRow["pair"];
export type Period = "day" | "week" | "all";
export const PERIODS: readonly Period[] = ["day", "week", "all"];
/** The sources a window of trades has: what the curve, the move to the DEX and the locked LP earned over a day or a week. */
export const SOURCES = ["curve", "graduation", "lp"] as const;
export type Source = (typeof SOURCES)[number];
/** The curve's surplus is one amount, once the curve is full: counted in all time only, never in a day's or a week's window. */
export type EarnedSource = Source | "surplus";
export const EARNED_SOURCES: readonly EarnedSource[] = [...SOURCES, "surplus"];
export type PeriodFigures = Readonly<Record<Source, WindowFigure>> & Readonly<{ surplus?: WindowFigure }>;

/** An amount in its currency, short: «$12,4 тис.», «1 234 COMM». */
export function money(raw: string | bigint, pair: Pair, locale: WorkspaceLocale): string {
  const value = Number(fromRaw(raw, pair.decimals, 6));
  if (pair.dollar && value > 0 && value < 0.01) return locale === "uk" ? "< $0,01" : "< $0.01";
  return formatMoneyShort(value, locale, pair.dollar, pair.symbol);
}

/** An amount to the cent: «$174,09» · «361,33 COMM». */
export function exact(raw: string | bigint, pair: Pair, locale: WorkspaceLocale): string {
  const value = Number(fromRaw(raw, pair.decimals, 6));
  if (value > 0 && value < 0.01) return pair.dollar ? (locale === "uk" ? "< $0,01" : "< $0.01") : `< 0${locale === "uk" ? "," : "."}01 ${pair.symbol}`;
  const text = formatRaw(raw, pair.decimals, locale, 2);
  return pair.dollar ? `$${text}` : `${text} ${pair.symbol}`;
}

/** A window's figure in words, or null when it was not read — the caller says «not read» in its own place. */
export function windowText(figure: WindowFigure, pair: Pair, locale: WorkspaceLocale): string | null {
  if (figure.raw === null) return null;
  return `${figure.atLeast ? "≥ " : ""}${money(figure.raw, pair, locale)}`;
}

export function countText(figure: Readonly<{ count: number | null; atLeast: boolean }>, locale: WorkspaceLocale): string | null {
  if (figure.count === null) return null;
  return `${figure.atLeast ? "≥ " : ""}${formatCountShort(figure.count, locale)}`;
}

/** The wallet's share of a launch's creator fees, in basis points; null while a sharing that names it is not confirmed. */
export function shareOf(row: LaunchCabinetRow): number | null {
  if (row.earnings) return row.earnings.mine.shareBps;
  return row.role === "creator" && !row.feeSharing ? 10_000 : null;
}

/** A launch's earnings over a period by source, the wallet's part — from its stats; all time from the cabinet's counters. */
export function launchPeriod(row: LaunchCabinetRow, stats: LaunchStatsResponse | null | undefined, period: Period): PeriodFigures | null {
  const share = shareOf(row);
  if (share === null) return null;
  if (period === "all") {
    if (!row.earnings) return null;
    const shared = row.feeSharing && row.feeSharing.state !== "FAILED";
    const part = (source: EarnedSource): WindowFigure => {
      /* A row read before 1.70.0 has no surplus: none is counted, never a guess. */
      const earned = BigInt(row.earnings!.role[source]?.earnedRaw ?? "0");
      return { raw: (shared ? (earned * BigInt(share)) / 10_000n : earned).toString(), atLeast: false };
    };
    return { curve: part("curve"), graduation: part("graduation"), lp: part("lp"), surplus: part("surplus") };
  }
  if (!stats) return null;
  const windows = stats.revenue[period];
  return { curve: partOfFigure(windows.curve, share), graduation: partOfFigure(windows.graduation, share), lp: partOfFigure(windows.lp, share) };
}

/** Figures added up: exact when every one is; a floor when one is; null when one was not read. */
export function addFigures(figures: readonly WindowFigure[]): WindowFigure {
  if (figures.some((figure) => figure.raw === null)) return { raw: null, atLeast: false };
  return { raw: figures.reduce((total, figure) => total + BigInt(figure.raw ?? "0"), 0n).toString(), atLeast: figures.some((figure) => figure.atLeast) };
}

export type PeriodTotal = Readonly<{ pair: Pair; total: WindowFigure; sources: PeriodFigures; unread: number }>;

/**
 * A period's earnings over every launch the wallet takes part in, each currency apart. A launch whose figures were not
 * read is left out and counted in `unread`; what the others found is then a floor.
 */
export function periodTotals(rows: readonly LaunchCabinetRow[], stats: Readonly<Record<string, LaunchStatsResponse | "unread" | undefined>>, period: Period): readonly PeriodTotal[] {
  const byPair = new Map<string, { pair: Pair; sources: Record<EarnedSource, WindowFigure[]>; unread: number }>();
  for (const row of rows) {
    /* Skipped only where nothing is the wallet's: a sharing not confirmed yet, or a part of nothing. A row not read counts as unread. */
    const waiting = row.role === "recipient" && row.feeSharing?.state !== "SHARED";
    if (waiting || (row.earnings && row.earnings.mine.shareBps === 0)) continue;
    const entry = byPair.get(row.pair.mint) ?? { pair: row.pair, sources: { curve: [], graduation: [], lp: [], surplus: [] }, unread: 0 };
    byPair.set(row.pair.mint, entry);
    const read = stats[row.token];
    const figures = launchPeriod(row, read && read !== "unread" ? read : null, period);
    if (!figures) {
      entry.unread += 1;
      continue;
    }
    for (const source of SOURCES) entry.sources[source].push(figures[source]);
    if (figures.surplus) entry.sources.surplus.push(figures.surplus);
  }
  return [...byPair.values()]
    .sort((a, b) => Number(b.pair.dollar) - Number(a.pair.dollar))
    .map((entry) => {
      /* A source not read on some launch: what the others found stands as a floor, or nothing when they found nothing. */
      const sum = (figures: readonly WindowFigure[]): WindowFigure => {
        const read = figures.filter((figure) => figure.raw !== null);
        const total = addFigures(read);
        const partial = read.length < figures.length || entry.unread > 0;
        if (!partial) return total;
        return BigInt(total.raw ?? "0") > 0n ? { raw: total.raw, atLeast: true } : { raw: null, atLeast: false };
      };
      const windowed = { curve: sum(entry.sources.curve), graduation: sum(entry.sources.graduation), lp: sum(entry.sources.lp) };
      /* All time only: a day's or a week's window has no surplus. */
      const sources: PeriodFigures = period === "all" ? { ...windowed, surplus: sum(entry.sources.surplus) } : windowed;
      const all = [...entry.sources.curve, ...entry.sources.graduation, ...entry.sources.lp, ...(period === "all" ? entry.sources.surplus : [])];
      return { pair: entry.pair, sources, total: sum(all), unread: entry.unread };
    });
}
