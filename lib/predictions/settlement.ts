/**
 * «Where's the catch» — the provider's comparison of how each venue settles
 * the same market, regrouped so a person reads it in one line per
 * difference: which venues say what, and which venues the market trades on
 * say nothing about it.
 *
 * The provider writes the differences (in English); Ryntra only groups the
 * venues by what they say and names the kind of difference in the person's
 * own words. Nothing is summarised away: the provider's own summary stays
 * beside it.
 *
 * Pure: shared by the server and the pages.
 */

import type { PredictionSettlement } from "./model.ts";

/** The kinds of difference the provider names, as Ryntra words them; any other kind keeps the provider's title. */
export type SettlementKind = "source" | "threshold" | "timing" | "scope" | "edge" | "other";

export type SettlementGroup = Readonly<{ venues: readonly string[]; text: string | null; /** The venues' text read as a date, where it is one. */ date?: string | null }>;

/** A difference that can change who wins or whether the market pays at all, or one that only informs. */
export type SettlementSeverity = "critical" | "info";

export type SettlementPoint = Readonly<{
  kind: SettlementKind;
  /** The provider's own title and summary, verbatim. */
  title: string;
  summary: string | null;
  /** Venues saying the same thing, the largest group first; `text: null` is the venues that state nothing on it. */
  groups: readonly SettlementGroup[];
  /** The venues outside the largest group — the ones to read twice. */
  differs: readonly string[];
  severity: SettlementSeverity;
}>;

export function settlementKind(type: string): SettlementKind {
  const t = type.toLowerCase();
  if (/source|oracle|authority|resolver/.test(t)) return "source";
  if (/threshold|round|level|value|price|number/.test(t)) return "threshold";
  if (/tim|date|deadline|window|expir|close|schedule/.test(t)) return "timing";
  if (/edge|cancel|void|postpon|tie|dispute|fallback|invalid/.test(t)) return "edge";
  if (/scope|defin|specific|criteria|condition|rule/.test(t)) return "scope";
  return "other";
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/** A venue's text that is only a date, as an ISO instant; any other text is null. Two spellings of one instant are one answer. */
export function settlementDate(text: string): string | null {
  const t = text.trim();
  const day = DATE_ONLY.exec(t);
  if (day) {
    const date = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])));
    /* A day the calendar does not have (30 February) is the venue's text, not a date. */
    return date.toISOString().slice(0, 10) === t ? date.toISOString() : null;
  }
  if (!ISO_TZ.test(t)) return null;
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * Whether a difference can decide the payout: the timing, the line, what
 * counts and the unusual cases always can, as can any difference the provider
 * describes as a conflict, a void, a cancellation or a postponement; a
 * different source on its own only informs.
 */
export function settlementSeverity(kind: SettlementKind, type: string, title: string, summary: string | null): SettlementSeverity {
  if (kind === "timing" || kind === "threshold" || kind === "scope" || kind === "edge") return "critical";
  return /conflict|void|cancel|postpon|recount|overtime|extra.?time/i.test(`${type} ${title} ${summary ?? ""}`) ? "critical" : "info";
}

/**
 * The differences, venue by venue. A venue the market trades on that the
 * provider compared on another point but left out of this one is shown as
 * stating nothing on it; a venue the provider compared on no point is not
 * drawn at all — its silence is not the provider's word.
 */
export function settlementPoints(settlement: PredictionSettlement | null, venues: readonly string[]): readonly SettlementPoint[] {
  if (!settlement) return [];
  const compared = new Set(settlement.differences.flatMap((d) => Object.keys(d.perVenue)));
  const all = [...new Set(venues)].filter((v) => compared.has(v));
  const points = settlement.differences.map((d) => {
    const byText = new Map<string, { text: string; date: string | null; venues: string[] }>();
    for (const [venue, raw] of Object.entries(d.perVenue)) {
      const text = raw.trim();
      if (!text) continue;
      const date = settlementDate(text);
      const key = date ?? text;
      const group = byText.get(key) ?? { text, date, venues: [] };
      group.venues.push(venue);
      byText.set(key, group);
    }
    const named = new Set([...byText.values()].flatMap((g) => g.venues));
    const silent = all.filter((v) => !named.has(v));
    const groups: SettlementGroup[] = [...byText.values()].map((g) => (g.date ? { venues: g.venues, text: g.text, date: g.date } : { venues: g.venues, text: g.text })).sort((a, b) => b.venues.length - a.venues.length);
    if (silent.length > 0) groups.push({ venues: silent, text: null });
    const largest = groups[0]?.venues ?? [];
    const differs = groups.length > 1 ? groups.slice(1).flatMap((g) => g.venues) : [];
    const kind = settlementKind(d.type);
    return { kind, title: d.title, summary: d.summary, groups, differs: largest.length > 0 ? differs : [], severity: settlementSeverity(kind, d.type, d.title, d.summary) };
  });
  /* What can decide the payout first; otherwise the provider's order. */
  return points.map((p, i) => ({ p, i })).sort((a, b) => Number(b.p.severity === "critical") - Number(a.p.severity === "critical") || a.i - b.i).map(({ p }) => p);
}
