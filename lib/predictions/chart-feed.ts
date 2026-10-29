/**
 * The outcome's chart in the core's contract (`ryntra.chart`): pages of bars on the probability scale, 0–100, for the
 * big chart and the compact ones. One place turns the two sources the market page has into the same page:
 *
 * - Ryntra's market-data gateway, where it records the market (`agg:<outcome id>`): its pages are the contract's
 *   already, passed as they are;
 * - the aggregator's own bars, read through Ryntra's server, for a market the gateway does not record (it knows the
 *   hub's leading markets only) or while the gateway is not reachable: a price of 0 … 1 becomes a percent of the
 *   payout, its source named «AGG · <venue>».
 *
 * The «no» side is never read: it is 100 − «yes» (the contract's rule), its high the «yes» low and its low the «yes»
 * high, its numbers marked as derived. A page with no bars is a gap with its reason — never bars made up to fill it.
 */
import type { Bar, DataGap, DataStatus, HistoryLoad, HistoryPage, PriceBasis, TimeResolution } from "@ryntra/core/adapters";

import type { PredictionBar, PredictionChart } from "./model.ts";

/** The resolutions the aggregator serves, as the chart and the gateway write them. */
export const AGG_RESOLUTIONS = ["1m", "5m", "1h", "1d"] as const;
export type AggResolution = (typeof AGG_RESOLUTIONS)[number];

/** The chart opens on the minute (the gateway's default too); a resolution the market lacks gives way to its first. */
export const DEFAULT_RESOLUTION = "1m";

/** Bars at most in one page of the aggregator: its own limit. */
export const AGG_PAGE_LIMIT = 500;

/** Percent of the payout to a tenth: the venues price in cents and tenths of a cent. */
export const PROBABILITY_STEP = "0.1";

const UNIT_OF = { s: "second", m: "minute", h: "hour", d: "day", w: "week", M: "month" } as const;
const KEY_OF = { second: "s", minute: "m", hour: "h", day: "d", week: "w", month: "M" } as const;

/** "5m" as the contract's resolution; null for a word that is no time resolution. */
export function resolutionOfKey(key: string): TimeResolution | null {
  const m = /^(\d+)([smhdwM])$/.exec(key);
  if (!m) return null;
  return { kind: "time", unit: UNIT_OF[m[2] as keyof typeof UNIT_OF], span: Number(m[1]) };
}

export function keyOfResolution(resolution: Readonly<{ kind: string; unit?: string; span?: number }>): string | null {
  if (resolution.kind !== "time" || !resolution.unit || !resolution.span) return null;
  const unit = KEY_OF[resolution.unit as keyof typeof KEY_OF];
  return unit ? `${resolution.span}${unit}` : null;
}

/** The basis of each outcome: the price of «yes» (or «no») as a percent of its USDC payout. */
export const YES_BASIS: PriceBasis = { kind: "last", measure: "price", in: "USDC", adjustment: "raw", outcome: "yes" };
export const NO_BASIS: PriceBasis = { kind: "last", measure: "price", in: "USDC", adjustment: "raw", outcome: "no" };

/** A probability of 0 … 1 as the contract's decimal percent, to a hundredth (never an exponent, never past 100). */
export function percentOf(probability: number): string {
  const value = Math.min(100, Math.max(0, probability * 100));
  return (Math.round(value * 100) / 100).toFixed(2);
}

/** 100 − a decimal percent, exactly to its hundredths. */
export function complementOf(percent: string): string {
  const hundredths = Math.round(Number(percent) * 100);
  return ((10_000 - hundredths) / 100).toFixed(2);
}

/** The aggregator's bars as the contract's, oldest first, one bar per open (a repeated open keeps the later bar). */
export function barsFromAgg(bars: readonly PredictionBar[]): Bar[] {
  const byOpen = new Map<number, PredictionBar>();
  for (const bar of bars) if (Number.isFinite(bar.t) && [bar.o, bar.h, bar.l, bar.c].every(Number.isFinite)) byOpen.set(bar.t, bar);
  return [...byOpen.values()]
    .sort((a, b) => a.t - b.t)
    .map((b) => ({
      t: b.t,
      o: percentOf(b.o),
      h: percentOf(Math.max(b.o, b.h, b.l, b.c)),
      l: percentOf(Math.min(b.o, b.h, b.l, b.c)),
      c: percentOf(b.c),
      // The aggregator counts shares traded; the contract counts the base asset, and an outcome's share is its base.
      v: b.v == null || !Number.isFinite(b.v) ? null : String(Math.max(0, b.v)),
      turnover: null,
      trades: null,
    }));
}

/** A venue's name as the person reads it under the chart. */
const VENUE_NAMES: Readonly<Record<string, string>> = { polymarket: "Polymarket", kalshi: "Kalshi", limitless: "Limitless", opinion: "Opinion", myriad: "Myriad", predict: "Predict.fun", probable: "Probable" };
export const venueLabel = (venue: string): string => VENUE_NAMES[venue.toLowerCase()] ?? (venue ? venue.charAt(0).toUpperCase() + venue.slice(1) : "");

/** How long Ryntra's server keeps the aggregator's read of a chart, and so how far behind its newest bar may be. */
export const AGG_DELAY_MS = 20_000;

const AGG_BAR_MS: Readonly<Record<AggResolution, number>> = { "1m": 60_000, "5m": 300_000, "1h": 3_600_000, "1d": 86_400_000 };
/** A newest bar may open this much more than one bar ago and still be the market's current one: the aggregator's own lag. */
const CURRENT_MARGIN_MS = 5 * 60_000;

/**
 * The state of the aggregator's bars. The aggregator dates its answer (`staleSeconds` = its clock − the newest bar's
 * open), so its read time is that open plus `staleSeconds`. While the newest bar is the current one (opened within one
 * bar and a margin of that read) the numbers are as fresh as the read: `delayed` by as long as Ryntra keeps it. A
 * newest bar older than that is `stale` — a market that stopped printing, or a feed that stopped — aged from the end
 * of that bar.
 */
export function aggStatus(chart: Pick<PredictionChart, "venue" | "staleSeconds" | "lastBarAt" | "resolution">, newest: number | null, now: number): DataStatus {
  const open = chart.lastBarAt ?? newest;
  const bar = AGG_BAR_MS[chart.resolution] ?? 60_000;
  const read = open != null && chart.staleSeconds != null ? open + chart.staleSeconds * 1000 : now;
  const stale = open != null && read - open > bar + CURRENT_MARGIN_MS;
  const at = Math.min(now, open == null ? now : stale ? open + bar : read);
  return {
    state: stale ? "stale" : "delayed",
    market: "open",
    source: { id: "agg", label: `AGG${chart.venue ? ` · ${venueLabel(chart.venue)}` : ""}`, rights: "display", attribution: null },
    at,
    gateway_at: now,
    age_ms: Math.max(0, now - at),
    delay_ms: stale ? null : AGG_DELAY_MS,
    derived: false,
  };
}

/** The aggregator's answer for a page: its bars on the probability scale, a gap where there are none. */
export function aggPage(chart: PredictionChart, request: Readonly<{ load: HistoryLoad; from: number; to: number; limit: number }>, now: number): HistoryPage {
  const bars = barsFromAgg(chart.bars).filter((b) => b.t < request.to);
  const gaps: DataGap[] = bars.length === 0 ? [{ from: request.from, to: request.to, reason: "no_data" }] : [];
  return {
    bars,
    // Older pages exist while the aggregator gave a full page; newer ones are the live bars, never a page.
    more: { forward: bars.length > 0 && chart.bars.length >= Math.min(request.limit, AGG_PAGE_LIMIT) - 1 && request.load !== "backward", backward: false },
    gaps,
    display_step: PROBABILITY_STEP,
    multiplier_version: null,
    status: aggStatus(chart, bars.at(-1)?.t ?? null, now),
  };
}

/** The «no» page from the «yes» one: 100 − every price, high and low swapped, the numbers marked as ours. */
export function complementPage(page: HistoryPage): HistoryPage {
  return {
    ...page,
    bars: page.bars.map(complementBar),
    status: { ...page.status, derived: true },
  };
}

/** A bar of a live update on the «no» side. */
export const complementBar = (b: Bar): Bar => ({ ...b, o: complementOf(b.o), h: complementOf(b.l), l: complementOf(b.h), c: complementOf(b.c), turnover: null });

/** Whether an answer is a page of the contract: what the gateway sends is read, not trusted. */
export function isHistoryPage(value: unknown): value is HistoryPage {
  if (!value || typeof value !== "object") return false;
  const page = value as Partial<HistoryPage>;
  const decimal = (s: unknown) => typeof s === "string" && /^-?\d+(\.\d+)?$/.test(s);
  return (
    Array.isArray(page.bars) &&
    page.bars.every((b) => b && typeof b.t === "number" && decimal(b.o) && decimal(b.h) && decimal(b.l) && decimal(b.c)) &&
    !!page.more &&
    typeof page.more.forward === "boolean" &&
    typeof page.more.backward === "boolean" &&
    Array.isArray(page.gaps) &&
    typeof page.display_step === "string" &&
    !!page.status &&
    typeof page.status.state === "string" &&
    Number.isFinite(page.status.at) &&
    Number.isFinite(page.status.age_ms) &&
    !!page.status.source &&
    typeof page.status.source.label === "string"
  );
}

/**
 * How long a span a page of the aggregator's covers, in ms: `limit` bars of the resolution, so the gap a page with no
 * bars reports runs over the time it was asked for.
 */
export function pageSpan(resolution: AggResolution, limit: number): number {
  const ms = { "1m": 60_000, "5m": 300_000, "1h": 3_600_000, "1d": 86_400_000 }[resolution];
  return ms * Math.min(Math.max(limit, 1), AGG_PAGE_LIMIT);
}

/** The market's «yes» and «no»: the outcome named «yes» and the other of two; a market of more outcomes charts the one chosen alone. */
export function outcomePair<T extends Readonly<{ id: string; label: string }>>(outcomes: readonly T[], chosen: string): Readonly<{ yes: T; no: T | null }> | null {
  if (outcomes.length === 0) return null;
  if (outcomes.length === 2) {
    const yes = outcomes.find((o) => /^yes$/i.test(o.label.trim())) ?? outcomes[0];
    const no = outcomes.find((o) => o.id !== yes.id) ?? null;
    return { yes, no };
  }
  return { yes: outcomes.find((o) => o.id === chosen) ?? outcomes[0], no: null };
}
