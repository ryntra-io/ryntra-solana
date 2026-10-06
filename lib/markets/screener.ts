/**
 * «Ринки» — one screener for everything Ryntra trades (the menu v6.2): memes, crypto, tokenized stocks
 * and private companies in one table, with tabs Усі · Меми · Крипта · Акції ·
 * Приватні · Обране and the columns each kind of asset has a figure for.
 *
 * Pure: rows in, rows out. Every figure is the source's own — the venue's for
 * coins (Jupiter Tokens V2, the same reads Spot makes), the stock universe's
 * for stocks — and a figure a source did not state stays null, drawn as a
 * dash, never a zero. The order is the one the person chose (volume, change,
 * age…) and nothing else: no row is «recommended» (B.2). «Тренди» is a sort of
 * this table, not a page; a deposit receipt (jlUSDC, syrupUSDC — a lending
 * position, not a market a person screens) is not a row.
 */

import type { SpotMarket } from "../spot/markets.ts";
import { isUnsupportedMarket, marketAgeDays } from "../spot/markets.ts";
import type { SessionPeriod } from "../stocks/session.ts";

export const SCREENER_TABS = ["all", "memes", "crypto", "stocks", "private", "watchlist"] as const;
export type ScreenerTab = (typeof SCREENER_TABS)[number];

export function isScreenerTab(value: unknown): value is ScreenerTab {
  return typeof value === "string" && (SCREENER_TABS as readonly string[]).includes(value);
}

/**
 * The tab an address asks for: `?tab=`, and the words the two lists this
 * screener replaced used — the stock screener's `?kind=preipo` and Trends'
 * `?mode=meme` — so an old link opens where it pointed. The older Markets
 * tabs (`companies`, `memes`, `dollars`) map to their nearest tab.
 */
export function screenerTabOf(params: Readonly<Record<string, string | string[] | undefined>>): ScreenerTab {
  const one = (key: string) => {
    const raw = params[key];
    return Array.isArray(raw) ? raw[0] : raw;
  };
  const tab = one("tab");
  /* The old screener's pre-IPO filter arrives as `?tab=stocks&kind=preipo` (the redirect keeps the query): it meant the private companies. */
  if (one("kind") === "preipo") return "private";
  if (isScreenerTab(tab)) return tab;
  if (tab === "companies") return "stocks";
  if (tab === "dollars") return "crypto";
  if (one("kind") === "preipo") return "private";
  if (one("kind") === "listed") return "stocks";
  const mode = one("mode");
  if (mode === "meme" || mode === "memes") return "memes";
  if (mode === "stocks") return "stocks";
  return "all";
}

export type ScreenerKind = "meme" | "crypto" | "stock" | "private";


export type ScreenerRow = Readonly<{
  kind: ScreenerKind;
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  /** The token's page: a company's page for a stock, the market in Spot for a coin. */
  href: string;
  price: number | null;
  change1h: number | null;
  change24h: number | null;
  volume24h: number | null;
  liquidity: number | null;
  marketCap: number | null;
  verified: boolean;
  /** The venue's own flag on a token it found suspicious. */
  suspicious: boolean;
  /* ---- coins: what the venue states about the token, not a verdict ---- */
  /** Whole days since the first pool the venue knows. */
  ageDays: number | null;
  /** The venue's organic-score label — `high`, `medium`, `low`. */
  organic: string | null;
  topHoldersPct: number | null;
  devPct: number | null;
  mintAuthorityOff: boolean | null;
  freezeAuthorityOff: boolean | null;
  /* ---- stocks and private companies ---- */
  /** The issuer's short name. */
  issuer: string | null;
  /** The exchange's trading period for a stock, as the stock universe states it. */
  period: SessionPeriod | null;
  /** The token against the exchange's price of the share, per cent. */
  deviation: number | null;
  /** A private company's token against the issuer's own valuation, per cent — context, never a deviation. */
  markPremium: number | null;
  halted: boolean;
  /** Whether the issuer offers a new purchase. */
  tradable: boolean;
}>;

/** Jupiter's tags of a lending or yield receipt — a deposit position, not a market. */
const DEPOSIT_TAGS: ReadonlySet<string> = new Set(["jup-lend-earn", "yb"]);

/**
 * A deposit receipt: tagged as one by the venue, or one of Jupiter Lend's own
 * receipts, which its issuer names «Jupiter Lend …» and does not always tag
 * (jleUSDG carried only `verified` on 2026-10-06).
 */
export function isDepositToken(market: Pick<SpotMarket, "tags"> & Partial<Pick<SpotMarket, "name">>): boolean {
  return market.tags.some((tag) => DEPOSIT_TAGS.has(tag)) || /^jupiter lend(?:\s|$)/i.test(market.name ?? "");
}

/** Six significant digits for a price, two decimals for a percent, whole dollars for a sum — what a row draws. */
const price = (value: number | null): number | null => (value === null || !Number.isFinite(value) ? null : Number(value.toPrecision(6)));
const percent = (value: number | null): number | null => (value === null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100);
const dollars = (value: number | null): number | null => (value === null || !Number.isFinite(value) ? null : Math.round(value));

/**
 * A coin of the venue's list as a row, or null where it is not one the
 * screener draws: a stock (the stock universe draws those, with the issuer's
 * facts), a token Ryntra no longer supports, a deposit receipt, or a token
 * the venue did not classify.
 */
export function coinScreenerRow(market: SpotMarket, now: number): ScreenerRow | null {
  if (market.category !== "meme" && market.category !== "crypto") return null;
  if (isUnsupportedMarket(market) || isDepositToken(market)) return null;
  return {
    kind: market.category,
    mint: market.mint,
    symbol: market.symbol,
    name: market.name,
    icon: market.icon,
    href: `/app/spot?mint=${encodeURIComponent(market.mint)}`,
    price: price(market.price),
    change1h: percent(market.change1hPct),
    change24h: percent(market.change24hPct),
    volume24h: dollars(market.volume24hUsd),
    liquidity: dollars(market.liquidityUsd),
    marketCap: dollars(market.marketCapUsd),
    verified: market.verified,
    suspicious: market.audit.suspicious,
    ageDays: marketAgeDays(market, now),
    organic: market.organicScoreLabel,
    topHoldersPct: percent(market.audit.topHoldersPct),
    devPct: percent(market.audit.devBalancePct),
    mintAuthorityOff: market.audit.mintAuthorityDisabled,
    freezeAuthorityOff: market.audit.freezeAuthorityDisabled,
    issuer: null,
    period: null,
    deviation: null,
    markPremium: null,
    halted: false,
    tradable: true,
  };
}

/**
 * The coins of the venue's reads, ranked by the day's volume, one row per
 * mint — the most traded `limit` of each kind, so neither memes nor crypto
 * crowds the other out. Stablecoins sink below the rest by the venue's own
 * `stable` tag, as in Spot's list.
 */
export function rankScreenerCoins(markets: readonly SpotMarket[], limit: Readonly<{ meme: number; crypto: number }>, now: number): ScreenerRow[] {
  const seen = new Set<string>();
  const byKind: Record<"meme" | "crypto", { market: SpotMarket; row: ScreenerRow }[]> = { meme: [], crypto: [] };
  for (const market of markets) {
    if (seen.has(market.mint)) continue;
    const row = coinScreenerRow(market, now);
    if (!row || (row.kind !== "meme" && row.kind !== "crypto")) continue;
    seen.add(market.mint);
    byKind[row.kind].push({ market, row });
  }
  const stable = (market: SpotMarket) => (market.tags.includes("stable") ? 1 : 0);
  const order = (a: { market: SpotMarket; row: ScreenerRow }, b: { market: SpotMarket; row: ScreenerRow }) =>
    stable(a.market) - stable(b.market) || (b.row.volume24h ?? -1) - (a.row.volume24h ?? -1) || (b.row.liquidity ?? -1) - (a.row.liquidity ?? -1);
  return [
    ...byKind.crypto.sort(order).slice(0, limit.crypto).map((entry) => entry.row),
    ...byKind.meme.sort(order).slice(0, limit.meme).map((entry) => entry.row),
  ];
}

/** The rows a tab holds. «Обране» is the person's own list of mints, in whatever kind. */
export function rowsForTab(rows: readonly ScreenerRow[], tab: ScreenerTab, watchlist: ReadonlySet<string>): ScreenerRow[] {
  switch (tab) {
    case "memes":
      return rows.filter((row) => row.kind === "meme");
    case "crypto":
      return rows.filter((row) => row.kind === "crypto");
    case "stocks":
      return rows.filter((row) => row.kind === "stock");
    case "private":
      return rows.filter((row) => row.kind === "private");
    case "watchlist":
      return rows.filter((row) => watchlist.has(row.mint));
    default:
      return [...rows];
  }
}

export const SCREENER_SORTS = ["volume24h", "change24h", "change1h", "liquidity", "marketCap", "age", "price", "name"] as const;
export type ScreenerSort = (typeof SCREENER_SORTS)[number];

export function isScreenerSort(value: unknown): value is ScreenerSort {
  return typeof value === "string" && (SCREENER_SORTS as readonly string[]).includes(value);
}

/** The direction a column sorts in when it is first pressed: the newest first for age, A to Z for a name, the most for a figure. */
export const SORT_FIRST_DIRECTION: Readonly<Record<ScreenerSort, "asc" | "desc">> = {
  volume24h: "desc",
  change24h: "desc",
  change1h: "desc",
  liquidity: "desc",
  marketCap: "desc",
  age: "asc",
  price: "desc",
  name: "asc",
};

function sortValue(row: ScreenerRow, key: ScreenerSort): number | string | null {
  switch (key) {
    case "volume24h":
      return row.volume24h;
    case "change24h":
      return row.change24h;
    case "change1h":
      return row.change1h;
    case "liquidity":
      return row.liquidity;
    case "marketCap":
      return row.marketCap;
    case "age":
      return row.ageDays;
    case "price":
      return row.price;
    default:
      return row.symbol.toLowerCase();
  }
}

/** The rows in the order chosen; a row with no figure for the key goes last, whatever the direction — unknown is not small. */
export function sortScreener(rows: readonly ScreenerRow[], key: ScreenerSort, direction: "asc" | "desc"): ScreenerRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, key) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      if (typeof a.value === "string" || typeof b.value === "string") return sign * String(a.value).localeCompare(String(b.value)) || a.index - b.index;
      return sign * (a.value - b.value) || a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** A filter of the table by a name, a ticker, an issuer or a pasted contract address. */
export function matchScreener(rows: readonly ScreenerRow[], query: string): ScreenerRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter(
    (row) =>
      row.mint === query.trim() ||
      row.symbol.toLowerCase().includes(needle) ||
      row.name.toLowerCase().includes(needle) ||
      (row.issuer?.toLowerCase().includes(needle) ?? false),
  );
}
