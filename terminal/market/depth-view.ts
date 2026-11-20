import { digits } from '../../city/lib/i18n/dict.ts';
import type { Lang } from '../../city/lib/i18n/langs.ts';
import type { DepthCoin, DepthKind, DepthList, DepthStats, DepthVenue, DepthWindow } from '../../lib/market-depth/model.ts';

/**
 * The Market's table on screen: which coins a filter keeps, how a
 * column sorts them, the one sign of a coin's risk and what stands behind it, the age of a coin in a word. The coins and
 * their figures are the engine's (`/api/v1/market/depth`, Jupiter's Token API v2); nothing here adds a figure.
 *
 * Pure: the screen and the tests read it as it is.
 */

/**
 * The tabs over the table: the kind of asset — All · Memes · Crypto · Stocks ·
 * Pre-IPO — and «Saved», the star. «All» is the memes and the crypto together.
 */
export const KINDS: readonly DepthKind[] = ['all', 'meme', 'crypto', 'stock', 'preipo'];
export type KindTab = DepthKind | 'saved';
export const KIND_TABS: readonly KindTab[] = [...KINDS, 'saved'];
export const isKindTab = (value: unknown): value is KindTab => typeof value === 'string' && (KIND_TABS as readonly string[]).includes(value);

/** The view of a list, quiet beside the tabs: Trending · Rising · Falling · Most trades. */
export type ShownList = Exclude<DepthList, 'fresh' | 'stocks'>;
export const LISTS: readonly ShownList[] = ['trending', 'gainers', 'losers', 'traded'];

/**
 * The columns each kind shows in its main set («Columns: Main»); «All» shows every column. A meme is read by its age,
 * launchpad, market cap, pool, holders, the top ten's share and its buys and sells; a coin by its price and moves; a
 * company's token by the company, the token's price, its day and its volume.
 */
export const MAIN_COLUMNS: Readonly<Record<DepthKind, readonly string[]>> = {
  all: ['n', 'coin', 'price', 'move', 'day', 'volume', 'mcap', 'liquidity', 'holders', 'bs', 'risk', 'quick', 'star'],
  meme: ['n', 'coin', 'move', 'mcap', 'liquidity', 'holders', 'top', 'bs', 'risk', 'quick', 'star'],
  crypto: ['n', 'coin', 'price', 'move', 'day', 'volume', 'mcap', 'liquidity', 'holders', 'risk', 'quick', 'star'],
  stock: ['n', 'coin', 'price', 'day', 'volume', 'mcap', 'quick', 'star'],
  preipo: ['n', 'coin', 'price', 'day', 'volume', 'liquidity', 'quick', 'star'],
};

/**
 * The filters as a kind reads them: «Launched on» is a meme's, so a coin, a stock and a pre-IPO token are never cut by
 * it; a company's token is not cut by its age either. The person's choice stays as it was for the memes.
 */
export function filtersFor(filters: Filters, kind: DepthKind | 'saved'): Filters {
  if (kind === 'stock' || kind === 'preipo') return { ...filters, venue: 'all', age: 'any' };
  if (kind === 'crypto') return { ...filters, venue: 'all' };
  return filters;
}

/** A company's name as its token's issuer writes it, without the issuer's own word: «NVIDIA xStock» → «NVIDIA». */
export function companyOf(name: string): string {
  const bare = name
    .replace(/\s+PreStocks$/i, '')
    .replace(/\s+xStock$/i, '')
    .replace(/\s+-\s+Backpack Securities$/i, '')
    .replace(/\s+\(Ondo Tokenized\)$/i, '')
    .trim();
  return bare || name;
}

/**
 * Whether the New York Stock Exchange is open: Monday to Friday, 9:30 to 16:00 in New York. Its holidays are not counted —
 * the mark says «by the exchange's hours», and the token trades on Solana either way.
 */
export function exchangeOpen(now: number): boolean {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  if (part('weekday') === 'Sat' || part('weekday') === 'Sun') return false;
  const minutes = Number(part('hour')) * 60 + Number(part('minute'));
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export const WINDOWS: readonly DepthWindow[] = ['5m', '1h', '6h', '24h'];
export const DEFAULT_WINDOW: DepthWindow = '1h';

export type AgeBound = 'any' | '1h' | '24h' | '7d';
/** Where a coin was launched: everywhere, on Ryntra, or on one of the three launch programs. */
export type Venue = 'all' | 'ryntra' | DepthVenue;

/** From — to, in dollars; null — no bound. */
export type Range = Readonly<{ min: number | null; max: number | null }>;

export type Filters = Readonly<{
  liquidity: Range;
  mcap: Range;
  /** Floors: the window's volume in dollars, the holders in people; null — any. */
  volume: number | null;
  holders: number | null;
  /** Younger than. */
  age: AgeBound;
  venue: Venue;
  /** A coin nobody verified with a fact against it stands hidden (decision 109: on by default). */
  hideRisky: boolean;
  verified: boolean;
}>;

const ANY: Range = { min: null, max: null };

/** Decision 109: «Hide risky» on, «Verified only» off. */
export const DEFAULT_FILTERS: Filters = { liquidity: ANY, mcap: ANY, volume: null, holders: null, age: 'any', venue: 'all', hideRisky: true, verified: false };

export const AGES: readonly AgeBound[] = ['any', '1h', '24h', '7d'];
export const VENUES: readonly Venue[] = ['all', 'ryntra', 'pump', 'meteora-dbc', 'launchlab'];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const AGE_MS: Readonly<Record<Exclude<AgeBound, 'any'>, number>> = { '1h': HOUR, '24h': DAY, '7d': 7 * DAY };

const sameRange = (a: Range, b: Range) => a.min === b.min && a.max === b.max;

/** How many filters stand away from the default — the number on «Filters». A range counts once. */
export function filtersOn(filters: Filters): number {
  let on = 0;
  if (!sameRange(filters.liquidity, DEFAULT_FILTERS.liquidity)) on += 1;
  if (!sameRange(filters.mcap, DEFAULT_FILTERS.mcap)) on += 1;
  for (const key of ['volume', 'holders', 'age', 'venue', 'hideRisky', 'verified'] as const) if (filters[key] !== DEFAULT_FILTERS[key]) on += 1;
  return on;
}

const floorOk = (value: number | null, floor: number | null) => floor === null || (value !== null && value >= floor);
const rangeOk = (value: number | null, range: Range) => (range.min === null && range.max === null) || (value !== null && (range.min === null || value >= range.min) && (range.max === null || value <= range.max));

/**
 * A sum as a person types it into a filter: «50K», «$1.2M», «2 млн», «10 000» → dollars; empty — no bound (null); a sum
 * that does not read — undefined.
 */
export function readSum(typed: string): number | null | undefined {
  const bare = typed.trim().replace(/^\$/, '').replace(/[\s\u00a0_]/g, '').toLowerCase();
  // Commas that group thousands (1,000 · 1,000,000), or with a point beside them, are dropped; a lone comma is the point.
  // Points that group thousands (1.000.000) are dropped the same way.
  const grouped = /^\d{1,3}(\.\d{3}){2,}(\D.*)?$/.test(bare) ? bare.replace(/\./g, '') : bare;
  const text = grouped.includes('.') || /^\d{1,3}(,\d{3})+(\D.*)?$/.test(grouped) ? grouped.replace(/,/g, '') : grouped.replace(',', '.');
  if (!text) return null;
  const match = /^(\d+(?:\.\d+)?)(k|m|b|тис\.?|млн|млрд)?$/.exec(text);
  if (!match) return undefined;
  const scale: Record<string, number> = { k: 1e3, 'тис': 1e3, 'тис.': 1e3, m: 1e6, 'млн': 1e6, b: 1e9, 'млрд': 1e9 };
  const value = Number(match[1]) * (match[2] ? scale[match[2]]! : 1);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

/** A filter's bound as its field shows it: 50000 → «50K». */
export function sumField(value: number | null): string {
  if (value === null) return '';
  for (const [size, unit] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as const) if (value >= size && value % (size / 10) === 0) return `${value / size}${unit}`;
  return String(value);
}

/* ------------------------------------------------------------ risk */

/** A fact that counts against a coin: a right kept, the supply in few hands, a thin pool, few holders, a borrowed name. */
export type RiskFact = 'mint' | 'freeze' | 'top' | 'thin' | 'few' | 'copy';

/** The biggest holders keep at least this share of the supply, percent. */
export const RISK_TOP_PCT = 50;
/** The pool holds less than this, in dollars. */
export const RISK_THIN_USD = 10_000;
/** Fewer holders than this. */
export const RISK_FEW_HOLDERS = 100;

/** The facts against a coin, as the engine read them — a fact nobody measured is not counted. Facts, never a score. */
export function riskFacts(coin: Pick<DepthCoin, 'mint' | 'freeze' | 'topHolders' | 'liquidity' | 'holders' | 'copyOf'>): RiskFact[] {
  const facts: RiskFact[] = [];
  if (coin.copyOf) facts.push('copy');
  if (coin.mint === 'on') facts.push('mint');
  if (coin.freeze === 'on') facts.push('freeze');
  if (coin.topHolders !== null && coin.topHolders >= RISK_TOP_PCT) facts.push('top');
  if (coin.liquidity !== null && coin.liquidity < RISK_THIN_USD) facts.push('thin');
  if (coin.holders !== null && coin.holders < RISK_FEW_HOLDERS) facts.push('few');
  return facts;
}

/**
 * Risky — what «Hide risky» hides: a coin that borrows a known name, or a coin nobody verified with any fact against it.
 * A verified coin keeps its facts on its sign (a bridged coin's issuer keeps its rights) and stays in the list.
 */
export function isRisky(coin: Pick<DepthCoin, 'verified' | 'mint' | 'freeze' | 'topHolders' | 'liquidity' | 'holders' | 'copyOf'>): boolean {
  if (coin.copyOf) return true;
  return !coin.verified && riskFacts(coin).length > 0;
}

/* Cyrillic and Greek letters that read as Latin ones: «TTWО» with a Cyrillic «О» is TTWO to the eye. */
const FOLD: Readonly<Record<string, string>> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X', І: 'I', Ј: 'J', Ѕ: 'S',
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', һ: 'h', ӏ: 'l',
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X', ο: 'o', ν: 'v',
};
const LATIN = /[A-Za-z]/;
const LOOKALIKE = /[Ͱ-ϿЀ-ӿԀ-ԯ]/;

/**
 * The Latin name a ticker or a name passes for, when a word of it mixes Latin letters with Cyrillic or Greek ones that
 * look the same and folds whole into plain Latin — a twin of a known coin dressed in its letters. Null for a word in one
 * script («Pepe Козак», «SOL Кіт» stay themselves) and for a letter that reads as no Latin one («μSOL»).
 */
export function mixedScriptOf(text: string): string | null {
  let mixed = false;
  const words = text.split(/(\s+)/).map((word) => {
    if (!LATIN.test(word) || !LOOKALIKE.test(word)) return word;
    const folded = [...word].map((char) => FOLD[char] ?? char).join('');
    if (/^[\x21-\x7e]+$/.test(folded)) mixed = true;
    return folded;
  });
  return mixed ? words.join('') : null;
}

/** A coin whose ticker or name is such a twin carries it as the name it borrows: the risk sign says so, «Hide risky» hides it. */
export function withTwin<T extends Pick<DepthCoin, 'verified' | 'copyOf' | 'symbol' | 'name'>>(coin: T): T {
  if (coin.verified || coin.copyOf) return coin;
  const twin = mixedScriptOf(coin.symbol) ?? mixedScriptOf(coin.name);
  return twin ? { ...coin, copyOf: twin } : coin;
}

/** A coin's age in milliseconds, or null when Jupiter did not say when it was born. */
export function ageMs(coin: Pick<DepthCoin, 'bornAt'>, now: number): number | null {
  if (!coin.bornAt) return null;
  const at = Date.parse(coin.bornAt);
  return Number.isFinite(at) ? Math.max(0, now - at) : null;
}

export const statsOf = (coin: DepthCoin, window: DepthWindow): DepthStats | null => coin.stats[window];
export const changeOf = (coin: DepthCoin, window: DepthWindow): number | null => coin.stats[window]?.change ?? null;
export const volumeOf = (coin: DepthCoin, window: DepthWindow): number | null => coin.stats[window]?.volume ?? null;

/**
 * Whether a coin passes every filter. A figure Jupiter did not measure never passes a bound. `ryntra` — the mints of the
 * coins launched on Ryntra the Pulse has seen, for «Launched on: Ryntra».
 */
export function passes(coin: DepthCoin, filters: Filters, window: DepthWindow, now: number, ryntra: ReadonlySet<string> = new Set()): boolean {
  if (filters.verified && !coin.verified) return false;
  if (filters.hideRisky && isRisky(coin)) return false;
  if (!rangeOk(coin.liquidity, filters.liquidity) || !rangeOk(coin.mcap, filters.mcap) || !floorOk(coin.holders, filters.holders)) return false;
  if (!floorOk(volumeOf(coin, window), filters.volume)) return false;
  if (filters.venue !== 'all' && (filters.venue === 'ryntra' ? !ryntra.has(coin.id) : coin.venue !== filters.venue)) return false;
  if (filters.age !== 'any') {
    const age = ageMs(coin, now);
    if (age === null || age > AGE_MS[filters.age]) return false;
  }
  return true;
}

/** A column the table sorts by; `rank` is the list's own order (Jupiter's). */
export const SORT_KEYS = ['rank', 'symbol', 'price', 'change5m', 'change1h', 'change6h', 'change24h', 'volume', 'mcap', 'liquidity', 'holders', 'age', 'trades', 'traders'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type Sort = Readonly<{ key: SortKey; dir: 'asc' | 'desc' }>;
export const DEFAULT_SORT: Sort = { key: 'rank', dir: 'desc' };

/** The sort after a tap on a column's head: the same column turns round, then back to the list's own order. */
export function nextSort(sort: Sort, key: SortKey): Sort {
  if (sort.key !== key) return { key, dir: key === 'symbol' || key === 'age' ? 'asc' : 'desc' };
  const first = key === 'symbol' || key === 'age' ? 'asc' : 'desc';
  return sort.dir === first ? { key, dir: first === 'asc' ? 'desc' : 'asc' } : DEFAULT_SORT;
}

/** The figure a column sorts by, or null when it was not measured. */
export function sortValue(coin: DepthCoin, key: SortKey, window: DepthWindow, now: number): number | null {
  switch (key) {
    case 'rank':
    case 'symbol':
      return null;
    case 'price':
      return coin.price;
    case 'change5m':
      return changeOf(coin, '5m');
    case 'change1h':
      return changeOf(coin, '1h');
    case 'change6h':
      return changeOf(coin, '6h');
    case 'change24h':
      return changeOf(coin, '24h');
    case 'volume':
      return volumeOf(coin, window);
    case 'mcap':
      return coin.mcap;
    case 'liquidity':
      return coin.liquidity;
    case 'holders':
      return coin.holders;
    case 'age':
      return ageMs(coin, now);
    case 'trades': {
      const s = statsOf(coin, window);
      return s && s.buys !== null && s.sells !== null ? s.buys + s.sells : null;
    }
    case 'traders':
      return statsOf(coin, window)?.traders ?? null;
  }
}

/** The rows in a column's order; an unmeasured figure stands last whichever way the column runs. */
export function sortCoins(coins: readonly DepthCoin[], sort: Sort, window: DepthWindow, now: number): DepthCoin[] {
  if (sort.key === 'rank') return [...coins];
  const turn = sort.dir === 'asc' ? 1 : -1;
  if (sort.key === 'symbol') return [...coins].sort((a, b) => turn * a.symbol.localeCompare(b.symbol, 'en', { sensitivity: 'base' }));
  return [...coins].sort((a, b) => {
    const x = sortValue(a, sort.key, window, now);
    const y = sortValue(b, sort.key, window, now);
    if (x === null || y === null) return Number(x === null) - Number(y === null);
    return turn * (x - y);
  });
}

/** A coin answers the search by its ticker, its name or its address. */
export function matches(coin: Pick<DepthCoin, 'id' | 'symbol' | 'name'>, query: string): boolean {
  const q = query.trim().replace(/^\$+/, '').toLowerCase();
  if (!q) return true;
  return coin.symbol.toLowerCase().includes(q) || coin.name.toLowerCase().includes(q) || coin.id === query.trim();
}

export type DepthView = Readonly<{ filters: Filters; window: DepthWindow; sort: Sort; query: string; now: number; ryntra?: ReadonlySet<string> }>;

/** The table on screen. */
export function depthRows(coins: readonly DepthCoin[], view: DepthView): DepthCoin[] {
  return sortCoins(
    coins.filter((coin) => passes(coin, view.filters, view.window, view.now, view.ryntra) && matches(coin, view.query)),
    view.sort,
    view.window,
    view.now,
  );
}

/**
 * «All» on screen (its count did not add up with the tabs under it): the memes and the crypto — the list read
 * for «All» first, in its own order, then whatever the Memes' and the Crypto's own lists hold beyond it — each coin once.
 */
export function allCoins([all, ...kinds]: readonly (readonly DepthCoin[] | undefined)[]): DepthCoin[] {
  /* Once the Memes' and the Crypto's lists are read, «All» holds exactly their coins — its own read only orders them. */
  const read = kinds.length > 0 && kinds.every((list) => list !== undefined);
  const held = read ? new Set(kinds.flatMap((list) => list!.map((coin) => coin.id))) : null;
  const seen = new Set<string>();
  const out: DepthCoin[] = [];
  for (const list of [all, ...kinds]) {
    for (const coin of list ?? []) {
      if (seen.has(coin.id) || (coin.kind !== 'meme' && coin.kind !== 'crypto') || (held && !held.has(coin.id))) continue;
      seen.add(coin.id);
      out.push(coin);
    }
  }
  return out;
}

/** The table of a list whose coins are of several kinds: each coin kept by its own kind's filters — «All» counts what its tabs count. */
export function mixedRows(coins: readonly DepthCoin[], view: DepthView): DepthCoin[] {
  return sortCoins(
    coins.filter((coin) => passes(coin, filtersFor(view.filters, coin.kind), view.window, view.now, view.ryntra) && matches(coin, view.query)),
    view.sort,
    view.window,
    view.now,
  );
}

/**
 * The day's line of a coin: its price a day, six hours, an hour and five minutes ago, and now — each from the move
 * Jupiter measured over that window. Fewer than three known points draw no line.
 */
export function dayLine(coin: DepthCoin): DayPoint[] | null {
  if (coin.price === null) return null;
  const at = (window: DepthWindow, hoursAgo: number): DayPoint | null => {
    const change = changeOf(coin, window);
    const price = change === null || change <= -100 ? null : coin.price! / (1 + change / 100);
    return price === null || !Number.isFinite(price) ? null : { x: 1 - hoursAgo / 24, price };
  };
  const points = [at('24h', 24), at('6h', 6), at('1h', 1), at('5m', 5 / 60), { x: 1, price: coin.price }].filter((p): p is DayPoint => p !== null);
  return points.length >= 3 ? points : null;
}

/** A point of the day's line: where it stands on the day (0 — a day ago, 1 — now) and the price then. */
export type DayPoint = Readonly<{ x: number; price: number }>;

/** The SVG path of points placed by time (`x` 0…1) in a box. */
export function timePath(points: readonly DayPoint[], width: number, height: number, pad = 2): string {
  if (points.length < 2) return '';
  const prices = points.map((p) => p.price);
  const lo = Math.min(...prices);
  const span = Math.max(...prices) - lo || 1;
  return points
    .map((p, i) => `${i ? 'L' : 'M'}${(pad + p.x * (width - pad * 2)).toFixed(1)} ${(height - pad - ((p.price - lo) / span) * (height - pad * 2)).toFixed(1)}`)
    .join(' ');
}

/** The age in one short word and its unit: minutes, hours, days, months, years. */
export function ageParts(ms: number): Readonly<{ n: number; unit: 'min' | 'h' | 'd' | 'mo' | 'y' }> {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return { n: Math.max(1, minutes), unit: 'min' };
  const hours = Math.floor(ms / HOUR);
  if (hours < 24) return { n: hours, unit: 'h' };
  const days = Math.floor(ms / DAY);
  if (days < 60) return { n: days, unit: 'd' };
  const months = Math.floor(days / 30.44);
  if (months < 24) return { n: months, unit: 'mo' };
  return { n: Math.floor(days / 365.25), unit: 'y' };
}

/**
 * A coin's logo through the engine's own icon proxy (`/api/spot/icon`): the page never loads a picture from the address
 * a coin's creator wrote. Null — the coin has no logo; the screen draws its letter.
 */
export function logoOf(coin: Readonly<{ id: string; icon: string | null }>): string | null {
  if (!coin.icon || coin.icon.length > 512 || !coin.icon.startsWith('https://')) return null;
  return `/api/spot/icon?mint=${encodeURIComponent(coin.id)}&u=${encodeURIComponent(coin.icon)}`;
}

/** An IPFS picture's content id and path, from a path gateway (`…/ipfs/<cid>/…`) or a subdomain one (`<cid>.ipfs.…`). */
const IPFS_PATH = /^https:\/\/[^/?#]+\/ipfs\/(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})(\/[^?#]*)?/;
const IPFS_HOST = /^https:\/\/(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})\.ipfs\.[^/?#]+(\/[^?#]*)?/;

/**
 * Where a coin's logo is tried next when its first address does not load (`CoinLogo`'s `also`; QA 19.11: LetsBONK,
 * BONKAI, WANTED stood as letters): the same IPFS picture through the public gateway the engine's own proxy spreads
 * over its mirrors — a creator's own pinning gateway refuses strangers — then the city's logo route by mint. Every
 * address is the engine's own route; the page never loads a picture from elsewhere. `icon` is the catalogue's address,
 * raw or already through `/api/spot/icon`; `src`, the first address, is not repeated.
 */
export function logoAlso(mint: string, icon: string | null | undefined, src?: string | null): string[] {
  let raw = icon ?? null;
  if (raw?.startsWith('/api/spot/icon?')) raw = new URLSearchParams(raw.slice(raw.indexOf('?') + 1)).get('u');
  const also: string[] = [];
  const ipfs = raw ? (IPFS_PATH.exec(raw) ?? IPFS_HOST.exec(raw)) : null;
  if (ipfs && !raw!.startsWith('https://ipfs.io/')) also.push(`/api/spot/icon?mint=${encodeURIComponent(mint)}&u=${encodeURIComponent(`https://ipfs.io/ipfs/${ipfs[1]}${ipfs[2] ?? ''}`)}`);
  also.push(`/api/icon/${encodeURIComponent(mint)}`);
  return also.filter((address) => address !== src);
}

/** `CoinLogo`'s two props for a coin: its first address, else the first of the others — never a letter while one is left. */
export function logoChain(mint: string, icon: string | null | undefined, src: string | null): Readonly<{ src: string | null; also: string[] }> {
  const also = logoAlso(mint, icon, src);
  return src ? { src, also } : { src: also[0] ?? null, also: also.slice(1) };
}

/** The rows a list shows before «Show more», and how many more each tap adds. */
export const ROWS_FIRST = 12;
export const ROWS_PHONE = 8;
export const ROWS_MORE = 12;

/** The quick-buy sums a person picks from, in SOL. */
export const QUICK_SOL = ['0.05', '0.1', '0.25', '0.5', '1'] as const;
export type QuickSol = (typeof QUICK_SOL)[number];
export const DEFAULT_QUICK: QuickSol = '0.1';
export const isQuick = (value: unknown): value is QuickSol => typeof value === 'string' && (QUICK_SOL as readonly string[]).includes(value);

/** The buys' share of a window's trades, 0–1, or null. */
export function buyShare(stats: DepthStats | null): number | null {
  if (!stats || stats.buys === null || stats.sells === null) return null;
  const all = stats.buys + stats.sells;
  return all > 0 ? stats.buys / all : null;
}

/** The inner padding of a table row and the gap between columns, px: what `fitColumns` counts besides the columns. */
export const TABLE_PAD = 32;
export const TABLE_GAP = 10;

/** The columns that fit a table this wide, in their own order: the lowest ranks first, the rest dropped. */
export function fitColumns<T extends Readonly<{ min: number; rank: number }>>(columns: readonly T[], width: number): T[] {
  const kept = new Set<T>();
  let used = TABLE_PAD - TABLE_GAP;
  for (const column of [...columns].sort((a, b) => a.rank - b.rank)) {
    if (kept.size && used + TABLE_GAP + column.min > width) continue;
    kept.add(column);
    used += TABLE_GAP + column.min;
  }
  return columns.filter((column) => kept.has(column));
}

/**
 * A count, short: 16K, 1.2M — in Ukrainian «16K», «1,2M» too: the table writes its counts the way it writes its sums
 * ($1,7M), one style across a row (QA 19.11: «77 тис.» beside «$19,0M»).
 */
export function countText(n: number | null, lang: Lang): string {
  if (n === null || !Number.isFinite(n)) return '—';
  const units: [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  // Rounded first, then the unit: 999,950 reads «1M», not «1000K».
  const round = (v: number) => (v < 10 ? Math.round(v * 10) / 10 : Math.round(v));
  for (const [size, unit] of units) {
    if (size === 1e3 && n < 1e4) break;
    const value = round(n / size);
    if (value >= 1) return digits(`${String(value)}${unit}`, lang);
  }
  return digits(String(Math.round(n)), lang);
}

