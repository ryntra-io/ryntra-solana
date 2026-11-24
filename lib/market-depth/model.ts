/**
 * The Market's depth: the lists a trader opens first — trending, new, rising, falling, most traded, stocks —
 * and every figure of a coin in them, as Jupiter's Token API v2 measures it: the move over 5 minutes, an hour, six hours
 * and a day, the volume, the buys and the sells, the traders, the holders, the age, the mint and freeze rights.
 *
 * Pure: the server read (`./read.server.ts`) feeds it Jupiter's answers; the route serves what it builds; the terminal
 * and the tests read the same types. A figure Jupiter did not send is `null` — a screen writes «—», never a zero.
 *
 * Since 1.101.0 every coin carries its logo, the launchpad it was born on and, for a coin nobody
 * verified that borrows a known name, whose name it borrows; «trending» is the window's real trading — Jupiter's
 * trending and most traded together, ranked by the window's volume, past a floor of trades and liquidity — and no list
 * but «stocks» names a stock or a coin pegged to a currency.
 *
 * Since 1.102.0
 * every coin carries its kind — a meme, a crypto coin, a listed company's stock or a private company's token
 * before its IPO — and every list is read by kind: «all» is the memes and the crypto together; a stock and a pre-IPO
 * token stand only under their own kind; a coin pegged to a currency stands under none. A token of the disconnected
 * issuer, or one its issuer let expire, is no coin of the Market.
 */

import { launchNameHits } from "../core/launch/moderation.ts";
import { launchVenueOf, launchpadName, type PulseCurveVenue } from "../spot/pulse.ts";
import { listedCompanyFor } from "../stocks/company-listings.ts";
import { lifecycleEventFor } from "../stocks/lifecycle-events.ts";
import { isRetiredToken } from "../stocks/retired.ts";
import { passesForStock } from "../stocks/stock-book.ts";

/** The lists, in the Market's order. */
export const DEPTH_LISTS = ['trending', 'fresh', 'gainers', 'losers', 'traded', 'stocks'] as const;
export type DepthList = (typeof DEPTH_LISTS)[number];

/** The kinds of coin the Market shows by tab, «all» first: the memes and the crypto together. */
export const DEPTH_KINDS = ['all', 'meme', 'crypto', 'stock', 'preipo'] as const;
export type DepthKind = (typeof DEPTH_KINDS)[number];
/** What one coin is. */
export type AssetKind = Exclude<DepthKind, 'all'>;

/** The windows a move is read over. */
export const DEPTH_WINDOWS = ['5m', '1h', '6h', '24h'] as const;
export type DepthWindow = (typeof DEPTH_WINDOWS)[number];

/** The most coins one list carries. */
export const DEPTH_LIMIT = 50;

/** A rising or falling coin is named only past this liquidity: a pool of a few dollars moves by any trade. */
export const MOVERS_MIN_LIQUIDITY_USD = 10_000;

/**
 * «Trending» counts a coin's window only past this many trades: below it a few wallets trading with each other make a
 * volume nobody else made. Scaled to the window.
 */
export const TRENDING_MIN_TRADES: Readonly<Record<DepthWindow, number>> = { "5m": 20, "1h": 100, "6h": 300, "24h": 1_000 };

/** Jupiter's tags of a tokenized stock, fund or other real-world asset: such a coin stands only in «stocks». */
const STOCK_TAGS: ReadonlySet<string> = new Set(["stocks", "xstocks", "prestocks", "equities", "rwa"]);
/** Jupiter's tags of a private company's token before its IPO: PreStocks, the one issuer of them Ryntra carries. */
const PRE_IPO_TAGS: ReadonlySet<string> = new Set(["prestocks", "pre-ipo"]);
/** A coin born on a launchpad is a meme — unless Jupiter names it a protocol's or a major coin (MET was born on DBC). */
const NOT_MEME_TAGS: ReadonlySet<string> = new Set(["defi", "major", "strict", "lst", "stable"]);
/**
 * A coin pegged to a currency: Jupiter's «stable» tag, or a currency's ticker whose price sits by its peg and stood still
 * over the day (EURØP, VCHF: Jupiter tags no euro or franc as stable).
 */
const CURRENCY_TICKER = /^[a-z]?(usd|eur|chf|gbp)[a-z0-9]{0,3}$/i;
/** A peg of one of those currencies sits in this band of dollars (a euro ≈ 1.1, a franc ≈ 1.2, a pound ≈ 1.3). */
const PEG_USD = [0.5, 2] as const;
const STILL_PCT = 1.5;

/** A right a mint keeps or gave up; `null` — Jupiter did not say. */
export type Right = 'on' | 'off' | null;

export type DepthStats = Readonly<{
  /** Percent, as Jupiter writes it (1.5 is +1.5 %). */
  change: number | null;
  volume: number | null;
  buys: number | null;
  sells: number | null;
  traders: number | null;
}>;

/** The launch program a coin was born on, where it is one of the three the Market names; null — none of them, or not said. */
export type DepthVenue = PulseCurveVenue;

export type DepthCoin = Readonly<{
  id: string;
  symbol: string;
  name: string;
  /** The coin's logo as Jupiter lists it (https); the screen draws it through the engine's own icon proxy. */
  icon: string | null;
  price: number | null;
  mcap: number | null;
  liquidity: number | null;
  holders: number | null;
  organic: number | null;
  verified: boolean;
  /** A tokenized stock or fund (Jupiter's stock or real-world-asset tags, or one of the engine's own stocks). */
  stock: boolean;
  /** 1.102.0: what the coin is — a meme, a crypto coin, a listed company's stock, a private company's token before its IPO. */
  kind: AssetKind;
  /** Pegged to a currency (Jupiter's `stable` tag, or a currency's name whose price stood still over the day). */
  stable: boolean;
  /** The launchpad by the name people know it by (pump.fun, Meteora, LaunchLab…); null — Jupiter names none. */
  launchpad: string | null;
  venue: DepthVenue | null;
  /**
   * The known brand, person or coin whose name an unverified coin borrows — the same check that refuses such a name at a
   * launch on Ryntra, or the ticker of a verified coin in the same answer; null — it borrows none, or it is verified.
   */
  copyOf: string | null;
  /** When the coin's first pool opened (else when the mint was made). */
  bornAt: string | null;
  mint: Right;
  freeze: Right;
  /** The share of the supply the biggest holders keep, percent (Jupiter's `topHoldersPercentage`). */
  topHolders: number | null;
  stats: Readonly<Record<DepthWindow, DepthStats | null>>;
}>;

export type DepthAnswer = Readonly<{
  /** A list, or «saved» — the coins a person starred, read by mint. */
  list: DepthList | "saved";
  /** 1.102.0: the kind the list was read for. */
  kind: DepthKind;
  window: DepthWindow;
  coins: readonly DepthCoin[];
  /** When the server read Jupiter for this answer. */
  readAt: string;
}>;

/** Jupiter's stats block, as Token API v2 sends it. */
export type JupiterStatsV2 = Readonly<{
  priceChange?: number | null;
  buyVolume?: number | null;
  sellVolume?: number | null;
  numBuys?: number | null;
  numSells?: number | null;
  numTraders?: number | null;
}>;

/** One coin of Token API v2 — only the fields the depth reads. */
export type JupiterTokenV2 = Readonly<{
  id?: unknown;
  symbol?: unknown;
  name?: unknown;
  icon?: unknown;
  usdPrice?: unknown;
  mcap?: unknown;
  liquidity?: unknown;
  holderCount?: unknown;
  organicScore?: unknown;
  isVerified?: unknown;
  tags?: unknown;
  mintAuthority?: unknown;
  freezeAuthority?: unknown;
  audit?: Readonly<{ mintAuthorityDisabled?: unknown; freezeAuthorityDisabled?: unknown; topHoldersPercentage?: unknown }> | null;
  firstPool?: Readonly<{ createdAt?: unknown }> | null;
  createdAt?: unknown;
  launchpad?: unknown;
  stats5m?: JupiterStatsV2 | null;
  stats1h?: JupiterStatsV2 | null;
  stats6h?: JupiterStatsV2 | null;
  stats24h?: JupiterStatsV2 | null;
}>;

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const count = (value: unknown): number | null => {
  const n = num(value);
  return n !== null && n >= 0 ? Math.round(n) : null;
};
const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');
const iso = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
};

function statsOf(raw: JupiterStatsV2 | null | undefined): DepthStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const buy = num(raw.buyVolume);
  const sell = num(raw.sellVolume);
  return {
    change: num(raw.priceChange),
    // Half a volume is not the volume: both sides measured, or none.
    volume: buy === null || sell === null ? null : buy + sell,
    buys: count(raw.numBuys),
    sells: count(raw.numSells),
    traders: count(raw.numTraders),
  };
}

/** A right from what Jupiter said: the audit's «disabled» first, then whether an authority is named. */
function rightOf(disabled: unknown, authority: unknown): Right {
  if (disabled === true) return 'off';
  if (typeof authority === 'string' && authority.length > 0) return 'on';
  if (disabled === false) return 'on';
  return null;
}

/**
 * Whether a coin is pegged to a currency: Jupiter's tag, or a currency's ticker (USDGO, EURØP, VCHF) with a price by its
 * peg that stood still over the day. A meme that only sounds like money (AUDIO, «Pound Dog») is not one.
 */
export function stableOf(tags: readonly string[], symbol: string, change24h: number | null, price: number | null): boolean {
  if (tags.includes("stable")) return true;
  if (change24h === null || Math.abs(change24h) > STILL_PCT || price === null || price < PEG_USD[0] || price > PEG_USD[1]) return false;
  return CURRENCY_TICKER.test(symbol.normalize("NFKD").replace(/ø/gi, "o").replace(/[^\p{L}\p{N}]/gu, ""));
}

/**
 * What a coin is, from Jupiter's tags alone (and the engine's own list of stocks): a pre-IPO token by PreStocks' tags,
 * a stock by the stock and real-world-asset tags, a meme by its tag or its launchpad, else a crypto coin.
 */
export function kindOf(tags: readonly string[], launchpad: string | null, id: string, stockMints: ReadonlySet<string> = new Set()): AssetKind {
  if (tags.some((tag) => PRE_IPO_TAGS.has(tag))) return 'preipo';
  if (stockMints.has(id) || tags.some((tag) => STOCK_TAGS.has(tag))) return 'stock';
  if (tags.includes('meme')) return 'meme';
  if (launchpad && !tags.some((tag) => NOT_MEME_TAGS.has(tag))) return 'meme';
  return 'crypto';
}

/** The known name an unverified coin borrows (the launch check's list, whole words), or null. */
export function borrowedOf(verified: boolean, symbol: string, name: string): string | null {
  if (verified) return null;
  return launchNameHits({ name, symbol }, { wholeWords: true })[0]?.label ?? null;
}

/** One of Jupiter's coins as the depth carries it; `null` for an answer that is not a coin. */
export function depthCoinOf(token: JupiterTokenV2, stockMints: ReadonlySet<string> = new Set()): DepthCoin | null {
  if (!token || typeof token !== 'object') return null;
  const id = typeof token.id === 'string' && MINT.test(token.id) ? token.id : null;
  const symbol = text(token.symbol, 24);
  if (!id || !symbol) return null;
  const verified = token.isVerified === true;
  const tags = Array.isArray(token.tags) ? token.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  // The disconnected issuer's tokens, and a token its issuer let expire, are no coins of the Market.
  if (isRetiredToken({ mint: id, tags }) || lifecycleEventFor(id)?.state === 'expired') return null;
  const icon = typeof token.icon === 'string' && /^https:\/\//.test(token.icon) && token.icon.length <= 400 ? token.icon : null;
  const price = num(token.usdPrice);
  const name = text(token.name, 64) || symbol;
  const day = statsOf(token.stats24h);
  const launchpad = text(token.launchpad, 40) || null;
  return {
    id,
    symbol,
    name,
    icon,
    price: price !== null && price > 0 ? price : null,
    mcap: num(token.mcap),
    liquidity: num(token.liquidity),
    holders: count(token.holderCount),
    organic: num(token.organicScore),
    verified,
    stock: stockMints.has(id) || tags.some((tag) => STOCK_TAGS.has(tag)),
    kind: kindOf(tags, launchpad, id, stockMints),
    stable: stableOf(tags, symbol, day?.change ?? null, price),
    launchpad: launchpadName(launchpad),
    venue: launchVenueOf(launchpad),
    /* A coin passing for a tokenized stock it is not borrows that company's name too. */
    copyOf: borrowedOf(verified, symbol, name) ?? (verified ? null : (passesForStock({ symbol, name, mint: id, verified })?.company ?? null)),
    bornAt: iso(token.firstPool?.createdAt) ?? iso(token.createdAt),
    mint: rightOf(token.audit?.mintAuthorityDisabled, token.mintAuthority),
    freeze: rightOf(token.audit?.freezeAuthorityDisabled, token.freezeAuthority),
    topHolders: num(token.audit?.topHoldersPercentage),
    stats: { '5m': statsOf(token.stats5m), '1h': statsOf(token.stats1h), '6h': statsOf(token.stats6h), '24h': day },
  };
}

const nameKey = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase();

/**
 * Coins from several answers, each once (the first answer that named it wins), in the order they came. An unverified
 * coin whose ticker or name is a verified coin's ticker in the same answers is marked as that coin's copy.
 */
export function mergeCoins(lists: readonly (readonly JupiterTokenV2[])[], stockMints: ReadonlySet<string> = new Set()): DepthCoin[] {
  const seen = new Set<string>();
  const out: DepthCoin[] = [];
  for (const list of lists) {
    for (const token of list) {
      const coin = depthCoinOf(token, stockMints);
      if (!coin || seen.has(coin.id)) continue;
      seen.add(coin.id);
      out.push(coin);
    }
  }
  const verified = new Map<string, string>();
  for (const coin of out) if (coin.verified && nameKey(coin.symbol).length >= 2) verified.set(nameKey(coin.symbol), coin.symbol);
  return out.map((coin) => {
    if (coin.verified || coin.copyOf) return coin;
    const twin = verified.get(nameKey(coin.symbol)) ?? verified.get(nameKey(coin.name)) ?? null;
    return twin ? { ...coin, copyOf: twin } : coin;
  });
}

/** A coin a list of the market names: not a stock (they have their own list), not a coin pegged to a currency. */
const marketCoin = (coin: DepthCoin) => !coin.stock && !coin.stable;

/** Whether a coin stands under a kind: «all» is the memes and the crypto; a coin pegged to a currency stands under none. */
export const inKind = (coin: Pick<DepthCoin, 'kind' | 'stable'>, kind: DepthKind): boolean =>
  !coin.stable && (kind === 'all' ? coin.kind === 'meme' || coin.kind === 'crypto' : coin.kind === kind);

/** A company's token trades on its own scale: the most traded first, past no floor of a meme's market. */
function byVolume(coins: readonly DepthCoin[], window: DepthWindow): DepthCoin[] {
  return coins
    .filter((coin) => (coin.stats[window]?.volume ?? 0) > 0)
    .sort((a, b) => (b.stats[window]?.volume ?? 0) - (a.stats[window]?.volume ?? 0) || a.id.localeCompare(b.id))
    .slice(0, DEPTH_LIMIT);
}

const tradesOf = (coin: DepthCoin, window: DepthWindow): number | null => {
  const stats = coin.stats[window];
  return stats && stats.buys !== null && stats.sells !== null ? stats.buys + stats.sells : null;
};

/**
 * «Trending»: the window's real trading — the coins Jupiter names trending or most traded, past the window's floor of
 * trades and the liquidity floor, without stocks or currencies, the most volume first.
 */
export function trending(coins: readonly DepthCoin[], window: DepthWindow): DepthCoin[] {
  return coins
    .filter((coin) => marketCoin(coin) && (tradesOf(coin, window) ?? 0) >= TRENDING_MIN_TRADES[window] && (coin.liquidity ?? 0) >= MOVERS_MIN_LIQUIDITY_USD && (coin.stats[window]?.volume ?? 0) > 0)
    .sort((a, b) => (b.stats[window]?.volume ?? 0) - (a.stats[window]?.volume ?? 0) || a.id.localeCompare(b.id))
    .slice(0, DEPTH_LIMIT);
}

/** «Most trades»: the window's count of trades, the most first, without stocks or currencies. */
export function mostTraded(coins: readonly DepthCoin[], window: DepthWindow): DepthCoin[] {
  return coins
    .filter((coin) => marketCoin(coin) && (tradesOf(coin, window) ?? 0) > 0)
    .sort((a, b) => (tradesOf(b, window) ?? 0) - (tradesOf(a, window) ?? 0) || a.id.localeCompare(b.id))
    .slice(0, DEPTH_LIMIT);
}

/** A coin's move over a window, or null. */
export const changeOf = (coin: DepthCoin, window: DepthWindow): number | null => coin.stats[window]?.change ?? null;

/**
 * The movers: coins with a measured move over the window, past the liquidity floor, the biggest rise (or fall) first.
 * A coin that did not move the asked way is not a mover.
 */
export function movers(coins: readonly DepthCoin[], window: DepthWindow, way: 'up' | 'down'): DepthCoin[] {
  return coins
    .filter((coin) => {
      const change = changeOf(coin, window);
      return marketCoin(coin) && change !== null && (way === 'up' ? change > 0 : change < 0) && (coin.liquidity ?? 0) >= MOVERS_MIN_LIQUIDITY_USD;
    })
    .sort((a, b) => (way === 'up' ? (changeOf(b, window) ?? 0) - (changeOf(a, window) ?? 0) : (changeOf(a, window) ?? 0) - (changeOf(b, window) ?? 0)))
    .slice(0, DEPTH_LIMIT);
}

/** What a list is read from: Jupiter's paths, in the order their coins are merged. */
export function listPaths(list: DepthList, window: DepthWindow, stockMints: readonly string[], kind: DepthKind = 'all'): string[] {
  const limit = `limit=${DEPTH_LIMIT}`;
  const stocks = [...(stockMints.length ? [`search?query=${stockMints.slice(0, 100).join(',')}`] : []), `toptraded/24h?${limit}`];
  // A company's token is read where the companies are: the engine's own stocks and the day's most traded; a private
  // company's token by its issuer's name.
  if (kind === 'stock') return stocks;
  if (kind === 'preipo') return ['search?query=prestocks'];
  switch (list) {
    case 'trending':
      return [`toptrending/${window}?${limit}`, `toptraded/${window}?${limit}`];
    case 'traded':
      return [`toptraded/${window}?${limit}`];
    case 'fresh':
      return [`recent?${limit}`];
    case 'gainers':
    case 'losers':
      return [`toptrending/${window}?${limit}`, `toptraded/${window}?${limit}`, `toporganicscore/${window}?${limit}`];
    case 'stocks':
      return stocks;
  }
}

/** The coins of a list, from the answers of its paths (in `listPaths` order). */
export function listCoins(list: DepthList, window: DepthWindow, answers: readonly (readonly JupiterTokenV2[])[], stockMints: ReadonlySet<string>, kind: DepthKind = 'all'): DepthCoin[] {
  const merged = mergeCoins(answers, stockMints);
  if (list === 'stocks') return merged.filter((coin) => coin.stock).slice(0, DEPTH_LIMIT);
  if (kind === 'stock' || kind === 'preipo') {
    /* «Pre-IPO» is the private companies: a token whose company has gone public (SpaceX; Anthropic since 19.11)
       is no private company's, and its own page says what it is now. */
    const companies = merged.filter((coin) => inKind(coin, kind) && !(kind === 'preipo' && listedCompanyFor({ mint: coin.id }) !== null));
    switch (list) {
      case 'gainers':
      case 'losers':
        return companies
          .filter((coin) => {
            const change = changeOf(coin, window);
            return change !== null && (list === 'gainers' ? change > 0 : change < 0);
          })
          .sort((a, b) => (list === 'gainers' ? (changeOf(b, window) ?? 0) - (changeOf(a, window) ?? 0) : (changeOf(a, window) ?? 0) - (changeOf(b, window) ?? 0)))
          .slice(0, DEPTH_LIMIT);
      case 'traded':
        return companies
          .filter((coin) => (tradesOf(coin, window) ?? 0) > 0)
          .sort((a, b) => (tradesOf(b, window) ?? 0) - (tradesOf(a, window) ?? 0) || a.id.localeCompare(b.id))
          .slice(0, DEPTH_LIMIT);
      default:
        return byVolume(companies, window);
    }
  }
  const coins = merged.filter((coin) => inKind(coin, kind));
  switch (list) {
    case 'trending':
      return trending(coins, window);
    case 'traded':
      return mostTraded(coins, window);
    case 'gainers':
      return movers(coins, window, 'up');
    case 'losers':
      return movers(coins, window, 'down');
    default:
      return coins.slice(0, DEPTH_LIMIT);
  }
}

export const isDepthKind = (value: unknown): value is DepthKind => typeof value === 'string' && (DEPTH_KINDS as readonly string[]).includes(value);
export const isDepthList = (value: unknown): value is DepthList => typeof value === 'string' && (DEPTH_LISTS as readonly string[]).includes(value);
/** The mints of «saved», as the route reads them: comma-separated addresses, at most `DEPTH_LIMIT`; null — not that. */
export function savedMints(value: string | null): string[] | null {
  if (!value) return [];
  if (value.length > 45 * DEPTH_LIMIT) return null;
  const mints = value.split(",");
  return mints.length <= DEPTH_LIMIT && mints.every((mint) => MINT.test(mint)) ? [...new Set(mints)] : null;
}

export const isDepthWindow = (value: unknown): value is DepthWindow => typeof value === 'string' && (DEPTH_WINDOWS as readonly string[]).includes(value);
