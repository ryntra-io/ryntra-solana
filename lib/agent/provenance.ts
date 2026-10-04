/**
 * Provenance — what every figure Ryn states stands on.
 *
 * The rule: any market, risk or portfolio number the agent shows carries its
 * source, its observed time, its freshness and the reference id where one
 * applies; `current`, `stale`, `unavailable` and `unknown` are distinguished;
 * an unavailable figure is never turned into a zero and no reference price is
 * ever invented. This module is the one place those words are decided and the
 * one place a figure is turned into text — the composer and the cards print
 * what it returns and nothing else.
 *
 * Pure: no clock of its own (every judgement takes `nowMs`), no store.
 */

import type { AgentCitation, AgentFigure, AgentState } from "../api/v1/contract.ts";

export type Locale = "en" | "uk";

/** How old a read may be before it is `stale`, by the source's own rule. */
export const FRESHNESS_MS = {
  /** The Spot catalogue's figures (Jupiter): a market price older than five minutes is stale context. */
  market: 5 * 60_000,
  /** A stock row (the shared universe revalidates every minute; an issuer feed lags): fifteen minutes. */
  stock: 15 * 60_000,
  /** The wallet's own holdings, read at `confirmed`: two minutes. */
  holdings: 2 * 60_000,
  /** A plan, a note, the history: the store's own record, current when read. */
  record: Number.POSITIVE_INFINITY,
} as const;

/** The state of a figure observed at `observedAt`, judged at `nowMs` against the source's rule. */
export function stateOf(observedAt: string | null, maxAgeMs: number, nowMs: number): AgentState {
  if (observedAt === null) return "unknown";
  const at = Date.parse(observedAt);
  if (!Number.isFinite(at)) return "unknown";
  return nowMs - at <= maxAgeMs ? "current" : "stale";
}

const intl = (locale: Locale) => (locale === "uk" ? "uk-UA" : "en-US");

/** A USD figure for a person: below a cent with its significant digits (a meme's price), never `$0.00` in its place. */
export function usdText(value: number | null, locale: Locale, digits?: number): string {
  if (value === null || !Number.isFinite(value)) return locale === "uk" ? "недоступно" : "unavailable";
  const magnitude = Math.abs(value);
  const text =
    digits === undefined && magnitude > 0 && magnitude < 0.01
      ? magnitude.toLocaleString(intl(locale), { maximumSignificantDigits: 4 })
      : magnitude.toLocaleString(intl(locale), { minimumFractionDigits: digits ?? 2, maximumFractionDigits: digits ?? 2 });
  return `${value < 0 ? "−" : ""}$${text}`;
}

/** A large USD sum (liquidity, volume, market cap) rounded to what a person reads at a glance. */
export function usdCompactText(value: number | null, locale: Locale): string {
  if (value === null || !Number.isFinite(value)) return locale === "uk" ? "недоступно" : "unavailable";
  const abs = Math.abs(value);
  const unit = abs >= 1e9 ? ["B", "млрд"] : abs >= 1e6 ? ["M", "млн"] : abs >= 1e3 ? ["K", "тис."] : null;
  const scaled = unit ? abs / (abs >= 1e9 ? 1e9 : abs >= 1e6 ? 1e6 : 1e3) : abs;
  const text = scaled.toLocaleString(intl(locale), { minimumFractionDigits: 0, maximumFractionDigits: scaled < 10 ? 2 : scaled < 100 ? 1 : 0 });
  const suffix = unit ? (locale === "uk" ? ` ${unit[1]}` : unit[0]) : "";
  return `${value < 0 ? "−" : ""}$${text}${suffix}`;
}

export function pctText(value: number | null, locale: Locale, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return locale === "uk" ? "недоступно" : "unavailable";
  const text = Math.abs(value).toLocaleString(intl(locale), { minimumFractionDigits: 0, maximumFractionDigits: digits });
  return `${value < 0 ? "−" : value > 0 ? "+" : ""}${text} %`;
}

export function countText(value: number | null, locale: Locale): string {
  if (value === null || !Number.isFinite(value)) return locale === "uk" ? "недоступно" : "unavailable";
  return value.toLocaleString(intl(locale), { maximumFractionDigits: 0 });
}

/** Units of a token as the wallet shows them: up to six places, trailing zeros dropped. */
export function unitsText(value: number | null, locale: Locale): string {
  if (value === null || !Number.isFinite(value)) return locale === "uk" ? "недоступно" : "unavailable";
  return value.toLocaleString(intl(locale), { minimumFractionDigits: 0, maximumFractionDigits: 6 });
}

export function whenText(iso: string | null, locale: Locale): string {
  if (!iso) return locale === "uk" ? "час невідомий" : "time unknown";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return locale === "uk" ? "час невідомий" : "time unknown";
  return `${new Date(at).toLocaleString(intl(locale), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;
}

/** The state as a person reads it, beside a figure. */
export function stateWord(state: AgentState, locale: Locale): string {
  const words: Record<AgentState, readonly [string, string]> = {
    current: ["current", "актуально"],
    stale: ["stale", "застаріло"],
    unavailable: ["unavailable", "недоступно"],
    unknown: ["unknown", "невідомо"],
  };
  return words[state][locale === "uk" ? 1 : 0];
}

/** A figure with its provenance; the text is decided here so a card and a sentence never disagree about the same number. */
export function figure(
  input: Readonly<{ label: string; number: number | null; kind: "usd" | "usdCompact" | "pct" | "count" | "units" | "text"; text?: string; unit?: string | null; state?: AgentState; cite: string }>,
  locale: Locale,
): AgentFigure {
  const state = input.state ?? (input.number === null && input.kind !== "text" ? "unavailable" : "current");
  const value =
    input.kind === "text"
      ? (input.text ?? stateWord(state, locale))
      : input.number === null
        ? stateWord(state === "current" ? "unavailable" : state, locale)
        : input.kind === "usd"
          ? usdText(input.number, locale)
          : input.kind === "usdCompact"
            ? usdCompactText(input.number, locale)
            : input.kind === "pct"
              ? pctText(input.number, locale)
              : input.kind === "count"
                ? countText(input.number, locale)
                : unitsText(input.number, locale);
  return { label: input.label, value: value.slice(0, 80), number: input.number !== null && Number.isFinite(input.number) ? input.number : null, unit: input.unit ?? null, state: input.number === null && input.kind !== "text" ? (state === "current" ? "unavailable" : state) : state, cite: input.cite };
}

/** Citations are numbered in the order they are made, `c1`, `c2`, …; a turn keeps at most the contract's limit. */
export class CitationBook {
  private readonly rows: AgentCitation[] = [];

  add(input: Readonly<{ tool: string; source: string; observedAt: string | null; state: AgentState; ref?: string | null; href?: string | null }>): AgentCitation {
    const citation: AgentCitation = {
      id: `c${this.rows.length + 1}`,
      tool: input.tool,
      source: input.source.slice(0, 160),
      observedAt: input.observedAt,
      state: input.state,
      ref: input.ref ?? null,
      href: input.href ?? null,
    };
    this.rows.push(citation);
    return citation;
  }

  list(): readonly AgentCitation[] {
    return [...this.rows];
  }

  has(id: string): boolean {
    return this.rows.some((row) => row.id === id);
  }
}
