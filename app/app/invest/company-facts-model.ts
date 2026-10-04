/**
 * The company page's facts at rest — the pure half.
 *
 * Every figure the page shows about a company and its token is shaped here
 * once and tested: money in the product's one formatter («$5,44 трлн»,
 * «$16,3 млн»), counts, ratios, the period a figure covers, the
 * date of a report, the exchange's short name, the issuer's label and what it
 * says of dividends, the year's range and where the price sits in it, the
 * share of buying in a day's trading. No fetch, no clock, no React: the page
 * hands the facts in, and a fact that is missing comes back null — the page
 * draws nothing for it, never a zero.
 */

import type { PeriodFigure } from "../../../lib/stocks/company-facts.ts";
import type { StockIssuerId } from "../../../lib/stocks/representations.ts";

type Lang = "en" | "uk";

const intl = (lang: Lang) => (lang === "uk" ? "uk-UA" : "en-US");

const UNITS: ReadonlyArray<Readonly<{ size: number; en: string; uk: string }>> = [
  { size: 1e12, en: "T", uk: " трлн" },
  { size: 1e9, en: "B", uk: " млрд" },
  { size: 1e6, en: "M", uk: " млн" },
  { size: 1e3, en: "K", uk: " тис." },
];

/** «$5,44 трлн» · «$303 млрд» · «$16,3 млн» · «$912 тис.» · «$41» — three significant figures at most, a minus for a loss. */
export function moneyShort(value: number | null | undefined, lang: Lang): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  const unit = UNITS.find((entry) => abs >= entry.size) ?? null;
  const scaled = unit ? abs / unit.size : abs;
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  const text = new Intl.NumberFormat(intl(lang), {
    minimumFractionDigits: 0,
    maximumFractionDigits: unit ? digits : scaled >= 1 ? 0 : 2,
  }).format(scaled);
  return `${value < 0 ? "−" : ""}$${text}${unit ? unit[lang] : ""}`;
}

/** «110 тис.» · «1,2 млн» · «9 870» — people and trades, whole. */
export function countShort(value: number | null | undefined, lang: Lang): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  if (value < 10_000)
    return new Intl.NumberFormat(intl(lang), {
      maximumFractionDigits: 0,
    }).format(value);
  const unit = UNITS.find((entry) => value >= entry.size) as (typeof UNITS)[number];
  const scaled = value / unit.size;
  return `${new Intl.NumberFormat(intl(lang), { maximumFractionDigits: scaled >= 100 ? 0 : 1 }).format(scaled)}${unit[lang]}`;
}

/** «28,5» — a ratio, one decimal. */
export function ratioShort(value: number | null | undefined, lang: Lang): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat(intl(lang), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

/** «0,12%» — a share, two decimals under one per cent, one above. */
export function pctShort(value: number | null | undefined, lang: Lang): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const digits = Math.abs(value) < 1 ? 2 : 1;
  return `${new Intl.NumberFormat(intl(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)}%`;
}

/** «+$2,72» · «−$0,41» — the day's move in dollars, beside its per cent. */
export function moneyChange(value: number | null | undefined, lang: Lang): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 2 : 4;
  const text = new Intl.NumberFormat(intl(lang), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(abs);
  if (Number(text.replace(/[^\d]/g, "")) === 0) return `$${text}`;
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}$${text}`;
}

/** «26 серп. 2026» · «Aug 26, 2026» — a report's day, as written on it (no clock). */
export function dayShort(iso: string | null | undefined, lang: Lang): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat(intl(lang), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** «червень 2025» · «June 2025» — since when. */
export function monthYear(iso: string | null | undefined, lang: Lang): string | null {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return null;
  return new Intl.DateTimeFormat(intl(lang), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(new Date(at))
    .replace(/\s*р\.$/, "");
}

/** The period a filing's figure covers, said after its label: «за 12 міс.» · «за фін. рік» · «за 6 міс.». */
export function periodWord(figure: PeriodFigure | null | undefined, lang: Lang): string | null {
  if (!figure) return null;
  const uk = lang === "uk";
  if (figure.basis === "ttm") return uk ? "за 12 міс." : "12 months";
  if (figure.basis === "fy") return uk ? "за фін. рік" : "fiscal year";
  const months = figure.months ?? 0;
  return months > 0 ? (uk ? `за ${months} міс.` : `${months} months`) : null;
}

const MIC_NAMES: Readonly<Record<string, string>> = {
  XNAS: "Nasdaq",
  XNGS: "Nasdaq",
  XNYS: "NYSE",
  ARCX: "NYSE Arca",
  XASE: "NYSE American",
  BATS: "Cboe",
  XHKG: "HKEX",
  XLON: "LSE",
  XETR: "Xetra",
};

/** The exchange's short name — «Nasdaq», «NYSE Arca» — from its MIC, else its filed name, else the SEC's. */
export function exchangeShort(exchange: Readonly<{ mic: string; name: string }> | null | undefined, secExchange: string | null | undefined): string | null {
  if (exchange?.mic && MIC_NAMES[exchange.mic]) return MIC_NAMES[exchange.mic];
  if (exchange?.name) return exchange.name.replace(/\s+(Stock Market|Stock Exchange|Global Select Market)$/i, "");
  return secExchange ?? null;
}

/** The label from the issuer's documents — the help topic that carries it and its line. */
export function truthTopic(issuer: StockIssuerId): "truthXStocks" | "truthOndo" | "truthBackpack" | "truthPreStocks" {
  switch (issuer) {
    case "xstocks":
      return "truthXStocks";
    case "ondo":
      return "truthOndo";
    case "backpack":
      return "truthBackpack";
    case "prestocks":
      return "truthPreStocks";
  }
}

/** What happens to the company's dividends for the holder of this token, by the issuer's documents. */
export function dividendWord(issuer: StockIssuerId, lang: Lang): string {
  const uk = lang === "uk";
  switch (issuer) {
    case "xstocks":
      return uk ? "Уже в кількості токена" : "Already in the token amount";
    case "ondo":
      return uk ? "Уже в ціні токена" : "Already in the token's price";
    case "backpack":
      return uk ? "Поки не виплачуються" : "Not paid out yet";
    case "prestocks":
      return uk ? "Немає" : "None";
  }
}

/** «×1,0012» — the multiplier a scaled token carries, when it is not one. */
export function multiplierWord(multiplier: number | null | undefined, lang: Lang): string | null {
  if (typeof multiplier !== "number" || !Number.isFinite(multiplier) || multiplier <= 0 || Math.abs(multiplier - 1) < 1e-9) return null;
  return `×${new Intl.NumberFormat(intl(lang), { maximumFractionDigits: 4 }).format(multiplier)}`;
}

/** The issuer's reserves against the tokens out: «100,06%», from the shares held and the supply, both as the issuer states them. */
export function backingPct(sharesHeld: string | number | null | undefined, circulating: string | number | null | undefined): number | null {
  if (sharesHeld === null || sharesHeld === undefined || sharesHeld === "" || circulating === null || circulating === undefined || circulating === "") return null;
  const held = Number(sharesHeld);
  const out = Number(circulating);
  if (!Number.isFinite(held) || !Number.isFinite(out) || out <= 0 || held < 0) return null;
  return (held / out) * 100;
}

export type YearRange = Readonly<{
  low: number;
  high: number;
  lowAt: number;
  highAt: number;
  position: number | null;
  since: number;
}>;

/**
 * The lowest and highest point of the year's line — the same daily closes the
 * chart's year draws, anchored to the page's price (`anchorPoints`) — with the
 * live price, which is part of the year, and where the price stands between
 * them, 0 to 1. Fewer than two points say nothing; `since` is the first
 * point, so a younger history says from when.
 */
export function yearRange(points: ReadonlyArray<Readonly<{ at: number; price: number }>>, price: number | null, nowMs: number): YearRange | null {
  const from = nowMs - 365 * 86_400_000;
  const year = points.filter((point) => Number.isFinite(point.price) && point.price > 0 && point.at >= from);
  if (year.length < 2) return null;
  let low = year[0];
  let high = year[0];
  for (const point of year) {
    if (point.price < low.price) low = point;
    if (point.price > high.price) high = point;
  }
  const live = typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
  const lowValue = live !== null ? Math.min(low.price, live) : low.price;
  const highValue = live !== null ? Math.max(high.price, live) : high.price;
  const span = highValue - lowValue;
  return {
    low: lowValue,
    high: highValue,
    lowAt: live !== null && live < low.price ? nowMs : low.at,
    highAt: live !== null && live > high.price ? nowMs : high.at,
    position: live !== null && span > 0 ? (live - lowValue) / span : null,
    since: year.reduce((min, point) => Math.min(min, point.at), Infinity),
  };
}

/** The buying side of a day's trading, per cent of the trades; null without both sides. */
export function buyShare(buys: number | null | undefined, sells: number | null | undefined): number | null {
  if (typeof buys !== "number" || typeof sells !== "number" || !Number.isFinite(buys) || !Number.isFinite(sells) || buys < 0 || sells < 0) return null;
  const total = buys + sells;
  return total > 0 ? (buys / total) * 100 : null;
}
