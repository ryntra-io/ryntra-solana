/**
 * «Простий»'s company page and its purchase in dollars — the pure half
 * (canon v5.1 §2, §4, §7, §8; `RYN-INVEST-SIMPLE-001`, session 2).
 *
 * What a beginner reads about a company is decided here once and tested:
 * the one line of truth about what the token is (from the issuer's own
 * documents, §7 — never «акція Apple»), whether the exchange is open (§8),
 * the chart's four ranges and the change over each, how many shares an
 * amount buys, and what a purchase costs in dollars, all of it. No fetch,
 * no clock, no React: the page and the sheet hand the facts in.
 */

import type { SpotTimeframe } from "../../../lib/spot/candles.ts";
import type { SessionPeriod } from "../../../lib/stocks/session.ts";

type Lang = "en" | "uk";

/* ------------------------------------------------------------- the truth */

/* The one line of truth is the server's too since «Перевірка» is counted there (contract 1.20.0): one function for the page and the server. */
export { truthLine } from "../../../lib/stocks/truth.ts";

/**
 * A private company's token against the issuer's own valuation of it, the one
 * number its card and its page carry (canon v5.2 В27): «на 31% дорожче за
 * оцінку PreStocks» · «на 21% дешевше…» — a whole per cent from ten up, one
 * decimal below it, «≈ як оцінка» within a twentieth of a per cent. No tone
 * of good or bad: the figure is context, never a reason to buy. Null when
 * the server stated no premium.
 */
export function premiumLine(premiumPct: number | null | undefined, issuerLabel: string, lang: Lang): string | null {
  if (typeof premiumPct !== "number" || !Number.isFinite(premiumPct)) return null;
  const uk = lang === "uk";
  const size = Math.abs(premiumPct);
  const whose = `${issuerLabel}${/s$/i.test(issuerLabel) ? "'" : "'s"}`;
  if (size < 0.05) return uk ? `≈ як оцінка ${issuerLabel}` : `≈ ${whose} valuation`;
  /* A figure that rounds to ten is said whole, like every figure above it. */
  const whole = size >= 9.95;
  const figure = new Intl.NumberFormat(uk ? "uk-UA" : "en-US", { minimumFractionDigits: whole ? 0 : 1, maximumFractionDigits: whole ? 0 : 1 }).format(size);
  if (uk) return `на ${figure}% ${premiumPct > 0 ? "дорожче" : "дешевше"} за оцінку ${issuerLabel}`;
  return `${figure}% ${premiumPct > 0 ? "above" : "below"} ${whose} valuation`;
}

/* ------------------------------------------------------------ the exchange */

export type ExchangeState = "open" | "closed";

/**
 * Whether the exchange the share lists on is open now (canon §8). The
 * issuer's own period decides — its «market» is the exchange's regular
 * session; extended and overnight hours are the token trading while the
 * exchange is shut. Without a period the exchange's own flag decides, and
 * with neither the page says nothing rather than guess.
 */
export function exchangeState(session: Readonly<{ period: SessionPeriod; exchangeOpen: boolean | null }>): ExchangeState | null {
  switch (session.period) {
    case "market":
      return "open";
    case "extended":
    case "overnight":
    case "closed":
      return "closed";
    case "unknown":
      return session.exchangeOpen === true ? "open" : session.exchangeOpen === false ? "closed" : null;
  }
}

/* --------------------------------------------------------------- the chart */

export const CHART_RANGES = ["1d", "1w", "1m", "1y"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

const DAY_MS = 86_400_000;

/**
 * Each range is drawn from the candles that fit it: a day of quarter-hour
 * bars, a week of hourly ones, a month of four-hour ones, a year of daily
 * ones — about a hundred to a few hundred points each, enough for a smooth
 * line on a phone. A day of five-minute bars was tried first: a pool's
 * single trades read as spikes, and the line said less, not more.
 */
export const RANGE_SOURCE: Readonly<Record<ChartRange, Readonly<{ timeframe: SpotTimeframe; spanMs: number }>>> = {
  "1d": { timeframe: "15m", spanMs: DAY_MS },
  "1w": { timeframe: "1h", spanMs: 7 * DAY_MS },
  "1m": { timeframe: "4h", spanMs: 30 * DAY_MS },
  "1y": { timeframe: "1d", spanMs: 365 * DAY_MS },
};

export function isChartRange(value: unknown): value is ChartRange {
  return typeof value === "string" && (CHART_RANGES as readonly string[]).includes(value);
}

export type LinePoint = Readonly<{ at: number; price: number }>;

/** The closes inside a range ending now, oldest first; a candle's `time` is in seconds. */
export function rangePoints(candles: ReadonlyArray<Readonly<{ time: number; close: number }>>, range: ChartRange, nowMs: number): LinePoint[] {
  const from = nowMs - RANGE_SOURCE[range].spanMs;
  return candles
    .map((candle) => ({ at: candle.time * 1000, price: candle.close }))
    .filter((point) => Number.isFinite(point.at) && Number.isFinite(point.price) && point.price > 0 && point.at >= from && point.at <= nowMs + 60_000)
    .sort((a, b) => a.at - b.at);
}

/**
 * The line anchored to the price on the page. The chart is one pool's
 * history, and one pool's last trade can sit a per cent or more away from
 * the venue's price the page shows (seen on 2026-09-23: AAPLx's deepest pool
 * at $340.88 while the venue's price read $335.95). The line keeps the
 * pool's moves — every point keeps its ratio to the last — and ends where
 * the page's price stands, so the price above the line and the line's end
 * are one figure.
 */
export function anchorPoints(points: readonly LinePoint[], price: number | null): LinePoint[] {
  const last = points[points.length - 1]?.price ?? null;
  if (price === null || last === null || !Number.isFinite(price) || price <= 0 || last <= 0) return [...points];
  const scale = price / last;
  return points.map((point) => ({ at: point.at, price: point.price * scale }));
}

/** The change from the range's first close to a later one, per cent; null without two prices. */
export function changePct(from: number | null | undefined, to: number | null | undefined): number | null {
  if (typeof from !== "number" || typeof to !== "number" || !Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null;
  return (to / from - 1) * 100;
}

/**
 * Whether the pool's history starts inside the range — a token younger than
 * a year has no year to draw, and the page says since when instead of calling
 * a few months a year. A tenth of the span is the slack a quiet pool's first
 * bar is allowed.
 */
export function historyStartsLate(points: readonly LinePoint[], range: ChartRange, nowMs: number): boolean {
  if (points.length === 0) return false;
  const span = RANGE_SOURCE[range].spanMs;
  return points[0].at - (nowMs - span) > span / 10;
}

export type LineGeometry = Readonly<{
  /** The line, in a `width × height` box. */
  line: string;
  /** The same line closed to the bottom edge, for the soft fill under it. */
  area: string;
  /** Where the price the change is measured from sits, for the dotted line. */
  baselineY: number;
  /** Each point's place in the box, for the finger that reads the chart. */
  xs: readonly number[];
  ys: readonly number[];
}>;

/**
 * The price a day ago, as the day's change states it — the dotted line a
 * day's chart is read against, so the picture and the figure beside it can
 * never disagree about the direction (a pool's first bar of the day can be
 * one odd trade). Null without both figures.
 */
export function dayAgoPrice(price: number | null, dayChangePct: number | null): number | null {
  if (price === null || dayChangePct === null || !Number.isFinite(price) || !Number.isFinite(dayChangePct) || price <= 0 || dayChangePct <= -100) return null;
  return price / (1 + dayChangePct / 100);
}

/**
 * The line through the points: time runs left to right in proportion (a
 * quiet hour is a long straight stretch, not a hidden gap), the price fills
 * the height between the range's own low and high with a little air above
 * and below, and a flat range is a flat line through the middle. The dotted
 * line the change is measured from sits at `baseline` — the range's first
 * price unless a truer one is given — and the height always holds it.
 */
export function lineGeometry(points: readonly LinePoint[], width: number, height: number, pad = 8, baseline: number | null = null, minSpanRatio = 0): LineGeometry | null {
  if (points.length < 2) return null;
  const first = points[0].at;
  const span = Math.max(1, points[points.length - 1].at - first);
  const from = baseline !== null && Number.isFinite(baseline) && baseline > 0 ? baseline : points[0].price;
  let low = from;
  let high = from;
  for (const point of points) {
    low = Math.min(low, point.price);
    high = Math.max(high, point.price);
  }
  const flat = high - low <= Math.abs(high) * 1e-9;
  /* A quiet range is not drawn as a storm (RYN-COMPANY-PAGE-001): the height spans at least `minSpanRatio` of the price, so a move of a few tenths of a per cent stays a few tenths of the height. */
  const need = Math.abs((low + high) / 2) * minSpanRatio;
  if (!flat && high - low < need) {
    const mid = (low + high) / 2;
    low = mid - need / 2;
    high = mid + need / 2;
  }
  const x = (at: number): number => ((at - first) / span) * width;
  const y = (price: number): number => (flat ? height / 2 : pad + (1 - (price - low) / (high - low)) * (height - 2 * pad));
  const xs = points.map((point) => x(point.at));
  const ys = points.map((point) => y(point.price));
  const line = xs.map((value, index) => `${index === 0 ? "M" : "L"}${value.toFixed(2)} ${ys[index].toFixed(2)}`).join(" ");
  return { line, area: `${line} L${width} ${height} L0 ${height} Z`, baselineY: y(from), xs, ys };
}

/**
 * A pool's single trades read as needles on a short range: each inner point
 * takes the median of itself and its two neighbours — always one of the three
 * closes the pool printed, so any figure read on the line is a real price —
 * and the line keeps its moves while the one-trade spikes fall away
 * (RYN-COMPANY-PAGE-001, the Owner's «ніби дитина робила»). The ends stay as
 * they are: the last is anchored to the page's price.
 */
export function despike(points: readonly LinePoint[]): LinePoint[] {
  if (points.length < 3) return [...points];
  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return point;
    const trio = [points[index - 1].price, point.price, points[index + 1].price].sort((a, b) => a - b);
    return { at: point.at, price: trio[1] };
  });
}

/** The least height a range's line spans, as a share of the price — a day's small moves are not blown up to fill the chart. */
export const MIN_SPAN_RATIO: Readonly<Record<ChartRange, number>> = { "1d": 0.02, "1w": 0.04, "1m": 0.06, "1y": 0 };

/** The point nearest a place across the chart, `0` at the left edge and `1` at the right. */
export function nearestIndex(xs: readonly number[], width: number, fraction: number): number {
  if (xs.length === 0) return -1;
  const target = Math.min(1, Math.max(0, fraction)) * width;
  let best = 0;
  for (let index = 1; index < xs.length; index += 1) {
    if (Math.abs(xs[index] - target) < Math.abs(xs[best] - target)) best = index;
  }
  return best;
}

/* ------------------------------------------------------------ the purchase */

/**
 * The least a purchase is — a dollar (canon v5.5 В35: «Може хтось хоче на
 * долар купляти. Кожний день по долару»). It was $10, from the v5.0 draft,
 * which had copied Jupiter's minimums for its DCA vault, Trigger orders and
 * the gasless swap; a plain Swap v2 order has none.
 */
export const MIN_BUY_USD = 1;
export const MAX_BUY_USD = 1_000_000;

/**
 * The sum a purchase opens on — $10 (the Owner's word, 2026-09-25: «зроби,
 * щоб було 10»). A default, not advice: every sum from a dollar is the
 * person's own, on their own budget, and nothing on the sheet recommends one.
 */
export const DEFAULT_BUY_USD = 10;

/**
 * The quick choices of a purchase are shares of the wallet's USDC — 25 %, 50 %,
 * 75 % and 100 % (the Owner's word, 2026-09-25: «наскільки я хочу купити —
 * у відсотках: 25, 50, 75 і 100»); the sum itself stays free to type.
 */
export const BUY_SHARE_PRESETS_PCT = [25, 50, 75, 100] as const;

/**
 * A share of a balance in dollars and cents, never rounded up — computed on the
 * raw amount so that 100 % is exactly what the wallet holds. `decimals` is the
 * token's own (6 for USDC).
 */
export function shareOfRaw(raw: bigint, decimals: number, pct: number): number {
  if (raw <= 0n || !Number.isInteger(decimals) || decimals < 2 || !Number.isFinite(pct) || pct <= 0) return 0;
  const cents = (raw * BigInt(Math.round(Math.min(pct, 100) * 100))) / (10_000n * 10n ** BigInt(decimals - 2));
  return Number(cents) / 100;
}

/**
 * Where the live quote gives no route for the sum asked, the company says its
 * own minimum — the least of these sums the same quote routes (canon v5.5
 * В35: «мінімум цього активу з котирування, чесно»). Tried in order and only
 * above the sum asked; when none routes, no minimum is claimed.
 */
export const ROUTE_MINIMUM_LADDER_USD = [2, 5, 10, 25, 50, 100] as const;

/** The sums of the ladder above the one asked, in the order they are tried. */
export function routeMinimumSteps(amountUsd: number): number[] {
  if (!Number.isFinite(amountUsd)) return [];
  return ROUTE_MINIMUM_LADDER_USD.filter((step) => step > amountUsd + 1e-9);
}

/** Whether a quote failed because the venue found no route for the sum — the one failure a larger sum can answer. */
export function isNoRoute(code: string | null | undefined): boolean {
  return typeof code === "string" && /NO_ROUTE/.test(code);
}

/**
 * The pauses before a sum of the ladder is asked again when the answer was
 * held back — a rate limit, or the venue's passing refusal — rather than «no
 * route»: a limit's window resets within seconds.
 */
export const ROUTE_MINIMUM_RETRY_MS = [1_500, 3_000, 6_000] as const;

/**
 * A sum of dollars as a person types it: «25», «$25», «25,50» in Ukrainian,
 * «1,000.50» in English, never more than cents. Anything else is no amount.
 */
export function parseDollars(text: string, lang: Lang): number | null {
  let cleaned = text.replace(/[\s  $]/g, "");
  cleaned = lang === "uk" ? cleaned.replace(",", ".") : cleaned.replace(/,(?=\d{3}(\D|$))/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** «$25» for a whole sum, «$25.50» / «$25,50» for cents — the button's words. */
export function dollars(value: number, numberLocale: string): string {
  const whole = Math.abs(value - Math.round(value)) < 0.005;
  return `$${new Intl.NumberFormat(numberLocale, { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(whole ? Math.round(value) : value)}`;
}

/*
 * The amount in the unit the wallet shows, «Усі витрати» and the reserve's
 * rule are counted by the server since contract 1.20.0 (`lib/stocks/check.ts`)
 * — the purchase's and the sale's «Перевірка» read them from the quote and the
 * order; the names stay here for the receipts and the issuer event's sheet.
 */
export { BASE_SIGNATURE_LAMPORTS, buyCosts, reserveOverPurchase, unitsFromRaw, type BuyCostInput, type BuyCosts } from "../../../lib/stocks/check.ts";

/** A count of shares or tokens, to four decimals at most (canon §2, rule 2); a real but tiny one is never printed as zero. */
export function formatUnits(value: number, numberLocale: string): string {
  if (value > 0 && value < 0.0001) return `< ${new Intl.NumberFormat(numberLocale, { minimumFractionDigits: 4 }).format(0.0001)}`;
  return new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 4 }).format(value);
}

const UK_FORMS = {
  share: { one: "частка", few: "частки", many: "часток", fraction: "частки" },
  token: { one: "токен", few: "токени", many: "токенів", fraction: "токена" },
} as const;

/**
 * «0,0787 частки Apple», «2 частки», «1 токен» — the Ukrainian noun after a
 * number: a fraction takes the genitive singular, a whole number its plural
 * form. English says «of a share» below one and «shares» from one up.
 */
export function unitsPhrase(value: number, unit: "share" | "token", company: string, lang: Lang, numberLocale: string): string {
  const figure = formatUnits(value, numberLocale);
  if (lang === "uk") {
    const forms = UK_FORMS[unit];
    const whole = Number.isInteger(Number(value.toFixed(4)));
    const kind = whole ? new Intl.PluralRules("uk-UA").select(Math.round(value)) : "other";
    const noun = kind === "one" ? forms.one : kind === "few" ? forms.few : kind === "many" ? forms.many : forms.fraction;
    return `${figure} ${noun} ${company}`;
  }
  if (value < 1) return `${figure} of ${unit === "share" ? "a share" : "a token"}`;
  return `${figure} ${unit === "share" ? (value === 1 ? "share" : "shares") : value === 1 ? "token" : "tokens"}`;
}

/** «≈ $0,06», or «< $0,01» for a real cost too small to print as a cent. */
export function approxUsd(value: number, numberLocale: string): string {
  if (value < 0.01) return `< $${new Intl.NumberFormat(numberLocale, { minimumFractionDigits: 2 }).format(0.01)}`;
  return `≈ $${new Intl.NumberFormat(numberLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
}
