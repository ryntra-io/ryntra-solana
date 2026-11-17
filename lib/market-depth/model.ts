/**
 * The Market's depth: the lists a trader opens first — trending, new, rising, falling, most traded, stocks —
 * and every figure of a coin in them, as Jupiter's Token API v2 measures it: the move over 5 minutes, an hour, six hours
 * and a day, the volume, the buys and the sells, the traders, the holders, the age, the mint and freeze rights.
 *
 * Pure: the server read (`./read.server.ts`) feeds it Jupiter's answers; the route serves what it builds; the terminal
 * and the tests read the same types. A figure Jupiter did not send is `null` — a screen writes «—», never a zero.
 */

/** The lists, in the Market's order. */
export const DEPTH_LISTS = ['trending', 'fresh', 'gainers', 'losers', 'traded', 'stocks'] as const;
export type DepthList = (typeof DEPTH_LISTS)[number];

/** The windows a move is read over. */
export const DEPTH_WINDOWS = ['5m', '1h', '6h', '24h'] as const;
export type DepthWindow = (typeof DEPTH_WINDOWS)[number];

/** The most coins one list carries. */
export const DEPTH_LIMIT = 50;

/** A rising or falling coin is named only past this liquidity: a pool of a few dollars moves by any trade. */
export const MOVERS_MIN_LIQUIDITY_USD = 10_000;

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

export type DepthCoin = Readonly<{
  id: string;
  symbol: string;
  name: string;
  /** Only a verified coin's logo is carried: a coin nobody vetted is drawn by its letter. */
  icon: string | null;
  price: number | null;
  mcap: number | null;
  liquidity: number | null;
  holders: number | null;
  organic: number | null;
  verified: boolean;
  /** A tokenized stock or fund (Jupiter's `stocks` tag, or one of the engine's own stocks). */
  stock: boolean;
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

/** One of Jupiter's coins as the depth carries it; `null` for an answer that is not a coin. */
export function depthCoinOf(token: JupiterTokenV2, stockMints: ReadonlySet<string> = new Set()): DepthCoin | null {
  if (!token || typeof token !== 'object') return null;
  const id = typeof token.id === 'string' && MINT.test(token.id) ? token.id : null;
  const symbol = text(token.symbol, 24);
  if (!id || !symbol) return null;
  const verified = token.isVerified === true;
  const tags = Array.isArray(token.tags) ? token.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  const icon = verified && typeof token.icon === 'string' && /^https:\/\//.test(token.icon) ? token.icon.slice(0, 400) : null;
  const price = num(token.usdPrice);
  return {
    id,
    symbol,
    name: text(token.name, 64) || symbol,
    icon,
    price: price !== null && price > 0 ? price : null,
    mcap: num(token.mcap),
    liquidity: num(token.liquidity),
    holders: count(token.holderCount),
    organic: num(token.organicScore),
    verified,
    stock: stockMints.has(id) || tags.includes('stocks'),
    bornAt: iso(token.firstPool?.createdAt) ?? iso(token.createdAt),
    mint: rightOf(token.audit?.mintAuthorityDisabled, token.mintAuthority),
    freeze: rightOf(token.audit?.freezeAuthorityDisabled, token.freezeAuthority),
    topHolders: num(token.audit?.topHoldersPercentage),
    stats: { '5m': statsOf(token.stats5m), '1h': statsOf(token.stats1h), '6h': statsOf(token.stats6h), '24h': statsOf(token.stats24h) },
  };
}

/** Coins from several answers, each once (the first answer that named it wins), in the order they came. */
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
  return out;
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
      return change !== null && (way === 'up' ? change > 0 : change < 0) && (coin.liquidity ?? 0) >= MOVERS_MIN_LIQUIDITY_USD;
    })
    .sort((a, b) => (way === 'up' ? (changeOf(b, window) ?? 0) - (changeOf(a, window) ?? 0) : (changeOf(a, window) ?? 0) - (changeOf(b, window) ?? 0)))
    .slice(0, DEPTH_LIMIT);
}

/** What a list is read from: Jupiter's paths, in the order their coins are merged. */
export function listPaths(list: DepthList, window: DepthWindow, stockMints: readonly string[]): string[] {
  const limit = `limit=${DEPTH_LIMIT}`;
  switch (list) {
    case 'trending':
      return [`toptrending/${window}?${limit}`];
    case 'traded':
      return [`toptraded/${window}?${limit}`];
    case 'fresh':
      return [`recent?${limit}`];
    case 'gainers':
    case 'losers':
      return [`toptrending/${window}?${limit}`, `toptraded/${window}?${limit}`, `toporganicscore/${window}?${limit}`];
    case 'stocks':
      return [...(stockMints.length ? [`search?query=${stockMints.slice(0, 100).join(',')}`] : []), `toptraded/24h?${limit}`];
  }
}

/** The coins of a list, from the answers of its paths (in `listPaths` order). */
export function listCoins(list: DepthList, window: DepthWindow, answers: readonly (readonly JupiterTokenV2[])[], stockMints: ReadonlySet<string>): DepthCoin[] {
  const coins = mergeCoins(answers, stockMints);
  switch (list) {
    case 'gainers':
      return movers(coins, window, 'up');
    case 'losers':
      return movers(coins, window, 'down');
    case 'stocks':
      return coins.filter((coin) => coin.stock).slice(0, DEPTH_LIMIT);
    default:
      return coins.slice(0, DEPTH_LIMIT);
  }
}

export const isDepthList = (value: unknown): value is DepthList => typeof value === 'string' && (DEPTH_LISTS as readonly string[]).includes(value);
/** The mints of «saved», as the route reads them: comma-separated addresses, at most `DEPTH_LIMIT`; null — not that. */
export function savedMints(value: string | null): string[] | null {
  if (!value) return [];
  if (value.length > 45 * DEPTH_LIMIT) return null;
  const mints = value.split(",");
  return mints.length <= DEPTH_LIMIT && mints.every((mint) => MINT.test(mint)) ? [...new Set(mints)] : null;
}

export const isDepthWindow = (value: unknown): value is DepthWindow => typeof value === 'string' && (DEPTH_WINDOWS as readonly string[]).includes(value);
