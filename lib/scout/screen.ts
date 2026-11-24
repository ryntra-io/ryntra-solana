/**
 * The free screen: the numbers the market list already states, judged without a read of our own. A coin that fails any
 * bar is refused with every reason it fails, so the journal shows whether the bars cut losing coins or winning ones. A
 * number nobody stated never passes its bar — unknown is not good — and the journal keeps the number as it was read
 * (null), so the screen can say «not stated» rather than «too low».
 *
 * Pure. Relative imports only.
 */

import { ageMinOf, type ScoutCandidate } from "./feed.ts";
import { SCOUT_SCREEN } from "./rules.ts";

export const SCREEN_CODES = [
  "stock",
  "borrowed",
  "flagged",
  "mint_on",
  "freeze_on",
  "age_young",
  "age_old",
  "liquidity",
  "volume",
  "cap_low",
  "cap_high",
  "trades",
  "one_sided",
  "organic",
  "dev_share",
  "serial",
] as const;
export type ScreenCode = (typeof SCREEN_CODES)[number];

export type ScreenRules = typeof SCOUT_SCREEN;

/** The numbers the screen judged, as read — the journal's snapshot of the coin at that moment. */
export type ScreenFigures = Readonly<{
  ageMin: number | null;
  liquidityUsd: number | null;
  volumeH1Usd: number | null;
  capUsd: number | null;
  tradesH1: number | null;
  sellShare: number | null;
  organicScore: number | null;
  devPct: number | null;
  creatorLaunches: number | null;
  creatorGraduated: number | null;
}>;

export function screenFiguresOf(candidate: ScoutCandidate, now: number): ScreenFigures {
  const h1 = candidate.windows.h1;
  const trades = h1.buys === null && h1.sells === null ? null : (h1.buys ?? 0) + (h1.sells ?? 0);
  const sellShare = h1.buys === null || h1.sells === null ? null : h1.buys > 0 ? h1.sells / h1.buys : h1.sells > 0 ? Number.POSITIVE_INFINITY : null;
  return {
    ageMin: ageMinOf(candidate, now),
    liquidityUsd: candidate.liquidityUsd,
    volumeH1Usd: h1.volumeUsd,
    capUsd: candidate.marketCapUsd,
    tradesH1: trades,
    sellShare,
    organicScore: candidate.organicScore,
    devPct: candidate.audit.devPct,
    creatorLaunches: candidate.creator.launches,
    creatorGraduated: candidate.creator.graduated,
  };
}

/** Whether the creator is a serial one: many coins made, few of them reached a DEX. Unknown history is not serial. */
export function serialCreator(launches: number | null, graduated: number | null, rules: Pick<ScreenRules, "serialLaunches" | "serialGraduatedShare"> = SCOUT_SCREEN): boolean {
  if (launches === null || launches < rules.serialLaunches) return false;
  return (graduated ?? 0) / launches < rules.serialGraduatedShare;
}

/** Every bar the coin fails, in the order above; empty — it passes the screen. */
export function screenOf(candidate: ScoutCandidate, now: number, rules: ScreenRules = SCOUT_SCREEN): ScreenCode[] {
  const out: ScreenCode[] = [];
  const f = screenFiguresOf(candidate, now);
  const atLeast = (value: number | null, bar: number) => value !== null && value >= bar;
  const atMost = (value: number | null, bar: number) => value !== null && value <= bar;
  if (candidate.stock) out.push("stock");
  if (candidate.borrows !== null) out.push("borrowed");
  if (candidate.audit.suspicious) out.push("flagged");
  /* A right nobody stated is not a right switched off. */
  if (candidate.audit.mintOff !== true) out.push("mint_on");
  if (candidate.audit.freezeOff !== true) out.push("freeze_on");
  if (f.ageMin === null || f.ageMin < rules.minAgeMin) out.push("age_young");
  else if (f.ageMin > rules.maxAgeMin) out.push("age_old");
  if (!atLeast(f.liquidityUsd, rules.minLiquidityUsd)) out.push("liquidity");
  if (!atLeast(f.volumeH1Usd, rules.minVolumeH1Usd)) out.push("volume");
  if (!atLeast(f.capUsd, rules.minCapUsd)) out.push("cap_low");
  else if (!atMost(f.capUsd, rules.maxCapUsd)) out.push("cap_high");
  if (!atLeast(f.tradesH1, rules.minTradesH1)) out.push("trades");
  if (!atLeast(f.sellShare, rules.minSellShare)) out.push("one_sided");
  if (!atLeast(f.organicScore, rules.minOrganicScore)) out.push("organic");
  if (!atMost(f.devPct, rules.maxDevPct)) out.push("dev_share");
  if (serialCreator(f.creatorLaunches, f.creatorGraduated, rules)) out.push("serial");
  return out;
}
