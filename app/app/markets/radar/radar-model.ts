/**
 * Market Radar's card, the part that is no picture (SOL-R1): which facts
 * about a token it lists and in what words' order, which candles its chart
 * reads, and which sum its fees are counted for first. Pure.
 */

import type { SpotTimeframe } from "../../../../lib/spot/candles.ts";
import { ageHoursOf, borrowedNameOf, pulseFlagsOf, type PulseRow } from "../../../../lib/spot/pulse.ts";

/** One line of the card's «Ризики»: a fact against the token (`notice`), a plain one, or one nobody stated (`unread`). */
export type CardFact = Readonly<{
  code: "MINT" | "FREEZE" | "RIGHTS_UNREAD" | "FLAGGED" | "BORROWED" | "TOP10" | "CREATOR_HOLDS" | "CREATOR_HISTORY" | "LIQUIDITY" | "HOLDERS" | "AGE" | "CURVE";
  tone: "notice" | "plain" | "unread";
  /** The figure the line carries — a share, a sum, a count, hours, a curve's way — or null where the line is a statement. */
  value: number | null;
  /** CREATOR_HISTORY: how many of the creator's tokens reached a DEX. */
  second?: number | null;
  /** HOLDERS: the count is a floor. */
  atLeast?: boolean;
  /** BORROWED: the known brand or person whose name the token carries. */
  label?: string;
}>;

/**
 * The card's facts, in the order a person reads them: the rights over the
 * holders and Jupiter's flag first, then who holds, then the creator's
 * history, then the market. Never a verdict — a fact is said, not scored:
 * the facts against a token are its row's risk flags (`pulseFlagsOf`: the token
 * page's own — a right still on, Jupiter's flag — and the thresholds one rule
 * for every token), so a card and its row never disagree; every other figure
 * is plain, and one nobody stated says so.
 */
export function cardFactsOf(row: PulseRow, now: number): CardFact[] {
  const flags = new Set(pulseFlagsOf(row, now));
  const facts: CardFact[] = [];
  if (!row.auditRead) facts.push({ code: "RIGHTS_UNREAD", tone: "unread", value: null });
  else {
    facts.push({ code: "MINT", tone: row.notices.includes("MINT_AUTHORITY") ? "notice" : "plain", value: null });
    facts.push({ code: "FREEZE", tone: row.notices.includes("FREEZE_AUTHORITY") ? "notice" : "plain", value: null });
  }
  if (row.notices.includes("FLAGGED")) facts.push({ code: "FLAGGED", tone: "notice", value: null });
  const borrowed = borrowedNameOf(row);
  if (borrowed !== null) facts.push({ code: "BORROWED", tone: "notice", value: null, label: borrowed });
  facts.push({ code: "TOP10", tone: row.top10Pct === null ? "unread" : "plain", value: row.top10Pct });
  facts.push({ code: "CREATOR_HOLDS", tone: row.devPct === null ? "unread" : "plain", value: row.devPct });
  facts.push({ code: "CREATOR_HISTORY", tone: flags.has("CREATOR_MANY") ? "notice" : row.creatorLaunches === null ? "unread" : "plain", value: row.creatorLaunches, second: row.creatorGraduated });
  facts.push({ code: "LIQUIDITY", tone: flags.has("LIQUIDITY_THIN") ? "notice" : row.liquidityUsd === null ? "unread" : "plain", value: row.liquidityUsd });
  facts.push({ code: "HOLDERS", tone: flags.has("HOLDERS_FEW") ? "notice" : row.holders === null ? "unread" : "plain", value: row.holders, atLeast: row.holdersAtLeast });
  facts.push({ code: "AGE", tone: flags.has("BRAND_NEW") ? "notice" : "plain", value: ageHoursOf(row, now) });
  if (row.curve) facts.push({ code: "CURVE", tone: "plain", value: row.curve.complete ? 100 : row.curve.progressPct });
  return facts;
}

/** The candles a token's card draws: a token minutes old by the minute, a day's by a quarter of an hour, older by the hour. */
export function chartTimeframeOf(ageHours: number | null): SpotTimeframe {
  if (ageHours !== null && ageHours < 6) return "1m";
  if (ageHours !== null && ageHours < 72) return "15m";
  return "1h";
}

/** The sum the fees are counted for first: $100 where it is one of the person's quick sums (SOL-X1 measures at $100), else the first. */
export function firstCostSum(sums: readonly number[]): number {
  return sums.includes(100) ? 100 : (sums[0] ?? 100);
}
