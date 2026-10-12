/**
 * Spot markets — Jupiter Tokens V2 rows as one labelled market shape.
 *
 * Pure. Every number on a Spot row is the provider's own figure, carried as
 * its claim: a token Jupiter does not price has `price: null`, a stat it does
 * not state is `null`, and the page prints *Not available* rather than a zero.
 * The category comes from Jupiter's own tags and from nothing else — a token
 * is never classified by heuristic for the sake of a pretty menu, so a token
 * without a deciding tag is simply uncategorised and appears in `All` and in
 * search.
 *
 * Nothing in this module reads the network; `markets.server.ts` does, and the
 * API routes call that. Tests exercise this file against recorded rows.
 */

import { parseSolanaAddress } from "../solana/address.ts";
import { isRetiredMint, isRetiredToken, isRetiredVenueTag } from "../stocks/retired.ts";

export const SPOT_CATEGORIES = ["crypto", "meme", "stock"] as const;
export type SpotCategory = (typeof SPOT_CATEGORIES)[number];

/** The market switch: `All` and `Watchlist` are views, not categories. */
export const SPOT_VIEWS = ["all", "crypto", "meme", "stock", "watchlist"] as const;
export type SpotView = (typeof SPOT_VIEWS)[number];

export function isSpotView(value: unknown): value is SpotView {
  return typeof value === "string" && (SPOT_VIEWS as readonly string[]).includes(value);
}

/**
 * The tags that decide a category. Read off the live `verified` universe on
 * 2026-09-11: `meme` on 822 rows; `stocks` 1345, `xstocks` 835, `rwa` 1352,
 * `equities` 115, `prestocks` 9, `pre-ipo` 1, `commodities` 3. A token tagged
 * both `meme` and a stock tag is a stock — the issuer's classification wins
 * over the community one, because the tokenized-asset disclosure must not be
 * skipped for it.
 */
const STOCK_TAGS: ReadonlySet<string> = new Set(["stocks", "xstocks", "equities", "rwa", "prestocks", "pre-ipo", "commodities"]);
const MEME_TAG = "meme";

/**
 * A token Ryntra no longer supports (`lib/stocks/retired.ts`)
 * names no issuer: its row says, in the issuer's place, that it is no longer
 * supported. It stays readable by its address — a holder's Portfolio, a
 * watchlist, an old plan — and is offered nowhere: no list, no search, no
 * ticket.
 */
export const UNSUPPORTED_ISSUER: SpotIssuer = { label: "No longer supported in Ryntra", tag: "unsupported" };

/** Whether a market is a token Ryntra no longer supports. */
export function isUnsupportedMarket(market: Readonly<{ mint: string; issuer?: SpotIssuer | null }>): boolean {
  return market.issuer?.tag === UNSUPPORTED_ISSUER.tag || isRetiredMint(market.mint);
}

export type SpotStats = Readonly<{
  /** Percent, Jupiter's own scale (1.5 = +1.5 %). */
  priceChangePct: number | null;
  /** USD, buys plus sells over the window. */
  volumeUsd: number | null;
  buys: number | null;
  sells: number | null;
  traders: number | null;
}>;

export type SpotAudit = Readonly<{
  mintAuthorityDisabled: boolean | null;
  freezeAuthorityDisabled: boolean | null;
  /** 0–100, Jupiter's scale. */
  topHoldersPct: number | null;
  devBalancePct: number | null;
  suspicious: boolean;
}>;

export type SpotIssuer = Readonly<{
  /** `xstocks` → Backed's xStocks; `ondo` → Ondo Global Markets; else what the tag says. */
  label: string;
  tag: string;
}>;

export type SpotMarket = Readonly<{
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  decimals: number | null;
  tokenProgram: string | null;
  price: number | null;
  /** Jupiter's `stats24h.priceChange`, percent. */
  change24hPct: number | null;
  change1hPct: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  holders: number | null;
  organicScore: number | null;
  organicScoreLabel: string | null;
  /**
   * Jupiter's verification, as a fact about its list: `isVerified` is present
   * only on the rows it verifies, so an absent flag is *not verified by
   * Jupiter* — which is what the row says, never *unknown*.
   */
  verified: boolean;
  tags: readonly string[];
  category: SpotCategory | null;
  issuer: SpotIssuer | null;
  /** ISO time of the first pool Jupiter knows for the mint. */
  firstPoolAt: string | null;
  audit: SpotAudit;
  links: Readonly<{ website: string | null; twitter: string | null; telegram: string | null }>;
  stats: Readonly<{ h1: SpotStats; h24: SpotStats }>;
  updatedAt: string | null;
}>;

/** The compact projection the market list carries — about a quarter of the row. */
export type SpotMarketListRow = Readonly<{
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  decimals: number | null;
  tokenProgram: string | null;
  price: number | null;
  change24hPct: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  verified: boolean;
  suspicious: boolean;
  category: SpotCategory | null;
  /** Who stands behind a tokenized stock — the one fact the Stocks page leads with. */
  issuer: SpotIssuer | null;
}>;

function asString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asHttpUrl(value: unknown): string | null {
  const text = asString(value, 512);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function asIsoTime(value: unknown): string | null {
  const text = asString(value, 64);
  if (!text) return null;
  const stamp = Date.parse(text);
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
}

function statsOf(raw: unknown): SpotStats {
  const stats = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!stats) return { priceChangePct: null, volumeUsd: null, buys: null, sells: null, traders: null };
  const buy = asFiniteNumber(stats.buyVolume);
  const sell = asFiniteNumber(stats.sellVolume);
  return {
    priceChangePct: asFiniteNumber(stats.priceChange),
    volumeUsd: buy === null && sell === null ? null : (buy ?? 0) + (sell ?? 0),
    buys: asFiniteNumber(stats.numBuys),
    sells: asFiniteNumber(stats.numSells),
    traders: asFiniteNumber(stats.numTraders),
  };
}

export function categoryOfTags(tags: readonly string[]): SpotCategory | null {
  if (tags.some((tag) => STOCK_TAGS.has(tag))) return "stock";
  if (tags.includes(MEME_TAG)) return "meme";
  /* A verified token that is neither is ordinary crypto: majors, DeFi, LSTs,
     stables, infrastructure. Jupiter's `unknown` tag marks the rows it has not
     classified at all, and those stay uncategorised rather than being called
     crypto by default. */
  if (tags.includes("verified") || tags.includes("strict") || tags.includes("community") || tags.includes("major")) return "crypto";
  return null;
}

export function issuerOfTags(tags: readonly string[]): SpotIssuer | null {
  if (tags.includes("xstocks")) return { label: "xStocks · Backed Finance", tag: "xstocks" };
  if (tags.includes("ondo")) return { label: "Ondo Global Markets", tag: "ondo" };
  /* An issuer is named by its own tag, never by a category: `pre-ipo` alone names nobody. */
  if (tags.includes("prestocks")) return { label: "PreStocks", tag: "prestocks" };
  if (tags.includes("backpack")) return { label: "Backpack Securities", tag: "backpack" };
  return null;
}

/**
 * Whether a right over the holders (minting, freezing) is off. Jupiter states an off right as `audit.*Disabled: true`
 * and a right still on by the authority's address at the top of the row (`mintAuthority`, `freezeAuthority`) with no
 * `*Disabled` key at all — measured 2026-10-12 on ORCA, USDC, RENDER. So an address, or an explicit `false`, is «on»; an
 * explicit `true` is «off»; neither is not stated.
 */
function authorityDisabled(disabled: unknown, authority: unknown): boolean | null {
  if (disabled === true) return true;
  if (disabled === false || (typeof authority === "string" && authority.length > 0)) return false;
  return null;
}

/**
 * One Tokens V2 row → one market, or null when the row has no usable identity.
 */
export function normalizeSpotMarket(raw: unknown): SpotMarket | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const mint = asString(row.id, 44);
  if (!mint || !parseSolanaAddress(mint, "spot mint").ok) return null;
  const symbol = asString(row.symbol, 32);
  const name = asString(row.name, 128);
  if (!symbol && !name) return null;
  const venueTags = Array.isArray(row.tags)
    ? row.tags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0 && tag.length <= 32).slice(0, 24)
    : [];
  /* A token Ryntra no longer supports keeps its identity and its figures, and carries neither the disconnected issuer's tag, nor its icon, nor its links. */
  const retired = isRetiredToken({ mint, tags: venueTags });
  const tags = retired ? venueTags.filter((tag) => !isRetiredVenueTag(tag)) : venueTags;
  const decimals = asFiniteNumber(row.decimals);
  const audit = row.audit && typeof row.audit === "object" ? (row.audit as Record<string, unknown>) : null;
  const firstPool = row.firstPool && typeof row.firstPool === "object" ? (row.firstPool as Record<string, unknown>) : null;
  const h24 = statsOf(row.stats24h);
  const h1 = statsOf(row.stats1h);
  return {
    mint,
    symbol: symbol ?? name!.slice(0, 12),
    name: name ?? symbol!,
    icon: retired ? null : asHttpUrl(row.icon),
    decimals: decimals !== null && Number.isInteger(decimals) && decimals >= 0 && decimals <= 18 ? decimals : null,
    tokenProgram: asString(row.tokenProgram, 44),
    price: asFiniteNumber(row.usdPrice),
    change24hPct: h24.priceChangePct,
    change1hPct: h1.priceChangePct,
    volume24hUsd: h24.volumeUsd,
    liquidityUsd: asFiniteNumber(row.liquidity),
    marketCapUsd: asFiniteNumber(row.mcap),
    fdvUsd: asFiniteNumber(row.fdv),
    holders: asFiniteNumber(row.holderCount),
    organicScore: asFiniteNumber(row.organicScore),
    organicScoreLabel: asString(row.organicScoreLabel, 16),
    verified: row.isVerified === true || tags.includes("verified"),
    tags,
    category: categoryOfTags(tags),
    issuer: retired ? UNSUPPORTED_ISSUER : issuerOfTags(tags),
    firstPoolAt: firstPool ? asIsoTime(firstPool.createdAt) : null,
    audit: {
      mintAuthorityDisabled: authorityDisabled(audit?.mintAuthorityDisabled, row.mintAuthority),
      freezeAuthorityDisabled: authorityDisabled(audit?.freezeAuthorityDisabled, row.freezeAuthority),
      topHoldersPct: audit ? asFiniteNumber(audit.topHoldersPercentage) : null,
      devBalancePct: audit ? asFiniteNumber(audit.devBalancePercentage) : null,
      suspicious: audit?.isSus === true,
    },
    links: retired
      ? { website: null, twitter: null, telegram: null }
      : {
          website: asHttpUrl(row.website),
          twitter: asHttpUrl(row.twitter),
          telegram: asHttpUrl(row.telegram),
        },
    stats: { h1, h24 },
    updatedAt: asIsoTime(row.updatedAt),
  };
}

export function toListRow(market: SpotMarket): SpotMarketListRow {
  return {
    mint: market.mint,
    symbol: market.symbol,
    name: market.name,
    icon: market.icon,
    decimals: market.decimals,
    tokenProgram: market.tokenProgram,
    price: market.price,
    change24hPct: market.change24hPct,
    volume24hUsd: market.volume24hUsd,
    liquidityUsd: market.liquidityUsd,
    verified: market.verified,
    suspicious: market.audit.suspicious,
    category: market.category,
    issuer: market.issuer,
  };
}

/**
 * The ranked list for one view. Volume decides the order: it is the one figure
 * the provider states for every row it prices, and the one a trader scans for.
 * Rows the provider left unpriced sink to the bottom rather than vanishing.
 */
export function rankMarkets(markets: readonly SpotMarket[], view: Exclude<SpotView, "watchlist">, limit: number): SpotMarketListRow[] {
  const seen = new Set<string>();
  const rows: SpotMarket[] = [];
  for (const market of markets) {
    if (seen.has(market.mint)) continue;
    /* A token Ryntra no longer supports is on no list. */
    if (isUnsupportedMarket(market)) continue;
    if (view !== "all" && market.category !== view) continue;
    seen.add(market.mint);
    rows.push(market);
  }
  /* Stablecoins are tradable and stay in the list, but a dollar pegged to a
     dollar is not what a person opens a market list to chart, and by volume
     they would take the top four rows of every view. Jupiter's own `stable`
     tag sinks them below the rest; nothing about them is guessed. */
  const stable = (market: SpotMarket) => (market.tags.includes("stable") ? 1 : 0);
  rows.sort((a, b) => stable(a) - stable(b) || (b.volume24hUsd ?? -1) - (a.volume24hUsd ?? -1) || (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1));
  return rows.slice(0, limit).map(toListRow);
}

/**
 * Search ranking. Jupiter's search already orders by relevance; this keeps that
 * order and only moves the exact-ticker matches to the front, verified before
 * unverified, so `NVDAx` finds NVIDIA xStock above the pump.fun copies that
 * borrowed its name. Nothing is dropped — a copy is shown, labelled unverified,
 * with its address one disclosure away — except a token Ryntra no longer
 * supports, which no search offers.
 */
export function rankSearch(markets: readonly SpotMarket[], query: string, limit: number): SpotMarketListRow[] {
  const needle = query.trim().toLowerCase();
  const score = (market: SpotMarket): number => {
    const symbol = market.symbol.toLowerCase();
    const exact = symbol === needle || market.mint.toLowerCase() === needle ? 2 : symbol.startsWith(needle) ? 1 : 0;
    return exact * 10 + (market.verified ? 5 : 0) + (market.audit.suspicious ? -3 : 0);
  };
  return markets
    .filter((market) => !isUnsupportedMarket(market))
    .map((market, index) => ({ market, index, score: score(market) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => toListRow(entry.market));
}

export type SpotTradingAvailability =
  | Readonly<{ allowed: true; notice: "ISSUER_TERMS" | null }>
  | Readonly<{ allowed: false; reason: "NO_LONGER_SUPPORTED" }>;

/**
 * May this market be bought and sold here?
 *
 * Since 2026-09-12 every market in the terminal trades. A tokenized stock or
 * RWA trades on the same engine as everything else — the quote route
 * accepted every stock mint tried, at the same fee — and the ticket names its
 * issuer in one line, because the issuer's terms are the one fact about such a
 * token that the chain does not carry. The earlier *not yet* for the whole
 * category (2026-09-11) is withdrawn; the route's own refusal still applies
 * on top of this. The one exception is a token Ryntra no longer supports: no
 * side of it trades here, and the ticket says where it can be sold instead —
 * the routes refuse it too.
 */
export function tradingAvailability(market: Pick<SpotMarket, "category"> & Partial<Pick<SpotMarket, "mint" | "issuer">>): SpotTradingAvailability {
  if (market.mint !== undefined && isUnsupportedMarket({ mint: market.mint, issuer: market.issuer ?? null })) return { allowed: false, reason: "NO_LONGER_SUPPORTED" };
  return { allowed: true, notice: market.category === "stock" ? "ISSUER_TERMS" : null };
}

/** Age of the market from its first pool, whole days, or null. */
export function marketAgeDays(market: Pick<SpotMarket, "firstPoolAt">, now: number): number | null {
  if (!market.firstPoolAt) return null;
  const stamp = Date.parse(market.firstPoolAt);
  if (!Number.isFinite(stamp) || stamp > now) return null;
  return Math.floor((now - stamp) / 86_400_000);
}
