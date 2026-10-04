import type { DomainLabel } from "@/app/shell/domains";
import type { SpotView } from "@/lib/spot/markets";

/**
 * The modes of Trends.
 *
 * Trends owns discovery: `Trending · New · Memes · Stocks/RWA · My Screeners`,
 * and the flow is *Discover → Watch → Open Spot → Create strategy*. A mode
 * with a `source` reads the same ranked Jupiter universe Spot reads — real
 * prices, the day's change, volume, liquidity and verification — and every
 * row opens Spot.
 *
 * **A mode with no source is not drawn**: since 2026-09-23 only what is built
 * reaches a customer screen. New and My Screeners stay registered here as
 * modes and stay off the mode bar until a list stands behind them — no *Soon*
 * tag, no card describing a list that does not exist. A saved link to one
 * opens Trending.
 *
 * Screeners belong here and nowhere else in the rail; Memes are a mode here
 * and a category in Spot. **Stocks/RWA moved out** on 2026-09-14: tokenized
 * stocks have their own page, and a saved link to this mode leads there rather
 * than into a second screener of the same class.
 */

export const TREND_MODES = ["trending", "new", "memes", "stocks", "screeners"] as const;
export type TrendMode = (typeof TREND_MODES)[number];

export type TrendModeSpec = Readonly<{
  id: TrendMode;
  label: DomainLabel;
  /** What the list is, in one line under the mode bar. */
  lead: DomainLabel;
  /** The Spot view that backs the mode, or null while it has no list — and is not drawn. */
  source: Exclude<SpotView, "watchlist"> | null;
  /** Where the mode lives now, when it became a page of its own. */
  movedTo?: string;
}>;

export const TREND_MODE_SPECS: readonly TrendModeSpec[] = [
  {
    id: "trending",
    label: { en: "Trending", uk: "У тренді" },
    lead: {
      en: "What is moving on Solana today — the most traded assets, by Jupiter's own figures.",
      uk: "Що рухається на Solana сьогодні — активи з найбільшим обсягом торгів, за даними самого Jupiter.",
    },
    source: "all",
  },
  {
    id: "new",
    label: { en: "New", uk: "Нові" },
    lead: {
      en: "Assets that only just started trading, with their age and audit beside the price.",
      uk: "Активи, які щойно почали торгуватися, з віком і аудитом поруч із ціною.",
    },
    source: null,
  },
  {
    id: "memes",
    label: { en: "Memes", uk: "Меми" },
    lead: {
      en: "Memes by the day's volume, the verification of each one marked on its row.",
      uk: "Меми за добовим обсягом, верифікація кожного позначена на його рядку.",
    },
    source: "meme",
  },
  {
    id: "stocks",
    label: { en: "Stocks/RWA", uk: "Акції/RWA" },
    lead: {
      en: "Tokenized stocks and real-world assets by the day's volume. Shown here and in Spot; traded only where eligibility can be confirmed.",
      uk: "Токенізовані акції та реальні активи за добовим обсягом. Показані тут і в Споті; торгуються лише там, де можна підтвердити право.",
    },
    source: "stock",
    /* The Stocks page — the screener: Trends is a tool of the experienced, and
       so is the one it hands stocks to. */
    movedTo: "/app/stocks/screener",
  },
  {
    id: "screeners",
    label: { en: "My Screeners", uk: "Мої скринери" },
    lead: {
      en: "Your own filters over the same universe, saved and rerun.",
      uk: "Твої власні фільтри над тим самим всесвітом активів, збережені й повторювані.",
    },
    source: null,
  },
];

/**
 * The modes the bar draws: every mode with a list behind it, the one that
 * became a page of its own included. A mode with no source is registered
 * above and drawn nowhere.
 */
export const DRAWN_TREND_MODES: readonly TrendModeSpec[] = TREND_MODE_SPECS.filter((spec) => spec.source !== null);

export function isTrendMode(value: unknown): value is TrendMode {
  return typeof value === "string" && (TREND_MODES as readonly string[]).includes(value);
}

/**
 * The mode a `?mode=` names; anything unknown opens Trending rather than an
 * error. A mode with no list resolves to itself, and the page sends it on to
 * Trending — the address says what the screen shows.
 */
export function resolveTrendMode(value: unknown): TrendModeSpec {
  const id: TrendMode = isTrendMode(value) ? value : "trending";
  const spec = TREND_MODE_SPECS.find((candidate) => candidate.id === id);
  if (!spec) throw new Error(`Trends mode "${id}" has no spec.`);
  return spec;
}
