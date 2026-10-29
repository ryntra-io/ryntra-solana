/**
 * Search by company, ticker or token — pure ranking over what two reads
 * return. The confirmed stock universe answers company names (the venue's
 * catalogue does not know that NVDAx is NVIDIA); the venue's own search
 * answers symbols, names and mints across every token, copies included.
 * Stocks come first, verified before unverified, nothing is dropped and a
 * copy is shown for what it is — a token that takes a stock's ticker or its
 * company's name without being that stock says so, whatever the venue's
 * verification (ST-5 r4: «NVDA · NVIDIA» at $0.0001 is not NVIDIA).
 */

import type { MarketCategory, MarketIssuer, MarketRow, StockUniverseRow } from '@/lib/api'
import type { Locale } from '@/lib/i18n'
import { quoteFar } from '../features/invest/pool-warning.ts'
import { isBlockedToken } from './blocked-names.ts'
import { issuerLabel, sessionWord } from './stocks.ts'

export type SearchHit = Readonly<{
  mint: string
  symbol: string
  name: string
  icon: string | null
  price: number | null
  change24hPct: number | null
  category: MarketCategory | null
  issuer: MarketIssuer | null
  verified: boolean
  suspicious: boolean
  /** One more fact for the row: the session of a stock, in the language asked for. */
  note: string | null
  /** Halted trading is the one state a stock row must say. */
  halted: boolean
  origin: 'stocks' | 'catalogue'
  /** The company a catalogue token borrows its ticker or name from while it is not that stock; null otherwise. */
  lookalikeOf: string | null
  /**
   * A confirmed stock token whose pool price stands far from the issuer's reference for the share (ST-5 r8: SGOVx at
   * $2 090 beside SGOVon at $100,75) — from the row's own deviation and reference; never claimed without a reference.
   */
  poolFar: boolean
}>

const number = (value: number | null): number => (value === null ? Number.NEGATIVE_INFINITY : value)

/**
 * The edits a typed word may stand from a stock's name or ticker and still find it (ST-5 r6: «nvidiaa» found 20 coins
 * and no NVIDIA): none below 4 letters — «ab» is too short to guess at — one for 4 to 6, two from 7.
 */
export function typoBudget(length: number): number {
  return length < 4 ? 0 : length <= 6 ? 1 : 2
}

/**
 * The edits between two words — a letter added, dropped, changed, or two neighbours swapped («tesal» → «tesla» is one)
 * — or `max + 1` as soon as they stand further apart than `max`.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let before: number[] = []
  let previous: number[] = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = [i]
    let best = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, before[j - 2] + 1)
      current.push(value)
      if (value < best) best = value
    }
    if (best > max) return max + 1
    before = previous
    previous = current
  }
  return previous[b.length]
}

/** The shortest word a typo is guessed against: a three-letter ticker one letter off is another word («pepe» is not PEP). */
const TYPO_MIN_WORD = 4
/** The shortest full symbol a typo is guessed against, the issuer's suffix included («nvdsx» → NVDAx; «pepe» is not PEPx). */
const TYPO_MIN_SYMBOL = 5

/**
 * The words of a company's name too common to guess a typo against (ST-5 r7: «bonk» is one edit from «bond» and «bank»,
 * and drew every Treasury ETF and Bank of America above the coin). A name is guessed at by its distinctive words only
 * — «nvidia», «tesla» — and by the ticker root.
 */
const GENERIC_NAME_WORD = new Set([
  'bond', 'bonds', 'bank', 'banks', 'bancorp', 'fund', 'funds', 'trust', 'group', 'gold', 'silver', 'oil', 'gas', 'etf',
  'etfs', 'etn', 'index', 'treasury', 'treasuries', 'holding', 'holdings', 'inc', 'corp', 'corporation', 'company', 'ltd',
  'plc', 'capital', 'energy', 'tech', 'technology', 'technologies', 'systems', 'global', 'international', 'national',
  'america', 'american', 'financial', 'finance', 'partners', 'income', 'equity', 'dividend', 'growth', 'value', 'market',
  'markets', 'total', 'select', 'sector', 'health', 'year', 'month', 'term', 'short', 'long', 'high', 'yield', 'real',
  'estate', 'reit', 'ishares', 'shares', 'share', 'stock', 'stocks', 'xstock', 'tokenized', 'ultra', 'bull', 'bear',
  'daily', 'world', 'united', 'states', 'first', 'invesco', 'vanguard', 'spdr', 'pharma', 'pharmaceuticals', 'motors',
  'airlines', 'resources', 'services', 'solutions', 'industries', 'labs', 'media', 'semiconductor', 'semiconductors',
])

/** Whether a typed word stands within its typo budget of a stock's ticker root, its symbol, its name or a distinctive word of it. */
function nearlyNames(row: StockUniverseRow, needle: string): boolean {
  const typed = needle.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const budget = typoBudget(typed.replace(/ /g, '').length)
  if (budget === 0) return false
  const company = nameWords(row.name)
  const distinctive = company.split(' ').filter((word) => !GENERIC_NAME_WORD.has(word))
  const symbol = row.symbol.toLowerCase()
  const candidates = [
    tickerRoot(row.symbol, row.issuer),
    // The whole name only while a word of it is its own: «Bank of America» stands, a bare «Gold Trust» does not.
    ...(distinctive.length > 0 ? [company] : []),
    ...distinctive,
  ].filter((candidate) => candidate.length >= TYPO_MIN_WORD)
  if (symbol.length >= TYPO_MIN_SYMBOL) candidates.push(symbol)
  return candidates.some((candidate) => editDistance(typed, candidate, budget) <= budget)
}

/** How a confirmed stock answers the typed words: 4 exact symbol or mint, 3 symbol prefix, 2 a part, 1 one typo away, 0 none. */
export function stockScore(row: StockUniverseRow, query: string): number {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return 0
  const symbol = row.symbol.toLowerCase()
  if (symbol === needle || row.mint.toLowerCase() === needle) return 4
  if (symbol.startsWith(needle)) return 3
  if (symbol.includes(needle) || row.name.toLowerCase().includes(needle)) return 2
  if (nearlyNames(row, needle)) return 1
  return 0
}

/**
 * The confirmed stocks that match, best first: exact symbol or mint, then a symbol prefix, then a name or symbol part,
 * then a name or ticker one typo away («nvidiaa», «nvdia», «tesal»). `mergeHits` leaves the typo-only ones out when the
 * venue holds the typed word itself (ST-5 r7: «bonk» is the coin).
 */
export function matchStocks(rows: readonly StockUniverseRow[], query: string): StockUniverseRow[] {
  if (query.trim().length === 0) return []
  return rows
    .map((row) => ({ row, score: stockScore(row, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || number(b.row.volume) - number(a.row.volume))
    .map((entry) => entry.row)
}

export function stockHit(row: StockUniverseRow, locale: Locale = 'en'): SearchHit {
  return {
    mint: row.mint,
    symbol: row.symbol,
    name: row.name,
    icon: row.icon,
    price: row.price,
    change24hPct: row.change24h,
    category: 'stock',
    issuer: { label: issuerLabel(row.issuer), tag: row.issuer },
    verified: true,
    suspicious: false,
    note: row.period === 'unknown' ? null : sessionWord(row.period, locale),
    halted: row.halted,
    origin: 'stocks',
    lookalikeOf: null,
    poolFar: stockPoolFar(row),
  }
}

/** Whether a confirmed stock's row says its pool price stands far from the share — by its own deviation and reference. */
export function stockPoolFar(row: Pick<StockUniverseRow, 'deviation' | 'reference' | 'kind'>): boolean {
  // A private company's token has no share to stand against (its premium to the issuer's valuation is no deviation).
  if (row.kind === 'pre-ipo') return false
  return quoteFar(row.deviation, row.reference)
}

/* ---- look-alikes: a token that takes a stock's ticker or its company's name ---- */

/** The suffix an issuer adds to the company's ticker: NVDAx (xStocks), AAPLon (Ondo). */
const ISSUER_SUFFIX: Readonly<Record<string, string>> = { xstocks: 'x', ondo: 'on' }

/** The company's own ticker under the issuer's symbol, lower case: NVDAx → nvda. */
export function tickerRoot(symbol: string, issuer: string): string {
  const lower = symbol.trim().toLowerCase()
  const suffix = ISSUER_SUFFIX[issuer]
  return suffix && lower.length > suffix.length && lower.endsWith(suffix) ? lower.slice(0, -suffix.length) : lower
}

const LEGAL_FORM = new Set(['inc', 'corp', 'corporation', 'co', 'company', 'ltd', 'plc', 'sa', 'ag', 'nv', 'se', 'holdings'])

/** A name as words to compare: lower case, letters and digits only, the legal form at its end taken off. */
function nameWords(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 0)
  while (words.length > 1 && LEGAL_FORM.has(words[words.length - 1])) words.pop()
  return words.join(' ')
}

type CatalogueIdentity = Readonly<{
  mint: string
  symbol: string
  name: string
  category: MarketCategory | null
  issuer: MarketIssuer | null
  /** The token's own price, USD; null or absent when the venue states none. */
  price?: number | null
}>

/**
 * The issuers of tokenized shares a token's name may name — «NVIDIA - Securitize», «NVIDIA xStock», «AAPL (Ondo
 * Tokenized)». A token that names one may be a real share from an issuer the phone does not list: we cannot confirm
 * it, and while its price may be the share's we do not call it «not the stock» (`stockLookalike`).
 */
const SHARE_ISSUER_NAME =
  /(?:^|[^\p{L}\p{N}])(?:securitize|backpack|xstocks?|ondo|dinari|robinhood|prestocks?|kraken|backed finance)(?:$|[^\p{L}\p{N}])/iu

/** Whether a token's name names an issuer of tokenized shares. */
export function namesShareIssuer(name: string): boolean {
  return SHARE_ISSUER_NAME.test(name)
}

/** How close a token's price may stand to the share's for it to be taken as tracking the share: ±5 %. */
const TRACKS_SHARE = 0.05

/** Whether a token's price stands within ±5 % of the stock's — the token's price of the share or the exchange's. */
export function tracksShare(price: number | null | undefined, stock: Pick<StockUniverseRow, 'price' | 'reference'>): boolean {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return false
  return [stock.price, stock.reference].some(
    (own) => typeof own === 'number' && Number.isFinite(own) && own > 0 && Math.abs(price / own - 1) <= TRACKS_SHARE,
  )
}

/**
 * How far a token that names an issuer may stand from the share's price and still be taken for that issuer's share:
 * half to twice it — a thin pool drifts, a copy priced at $0.000003 against $217 is not a share at all.
 */
const ISSUER_BAND = { low: 0.5, high: 2 } as const

/**
 * Whether a token's price stands far from the share's — outside half to twice every price of the share we know. False
 * when the token states no price or nothing is known of the share's: far is never guessed.
 */
export function farFromShare(price: number | null | undefined, stock: Pick<StockUniverseRow, 'price' | 'reference'>): boolean {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return false
  const own = [stock.price, stock.reference].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0,
  )
  return own.length > 0 && own.every((value) => price / value < ISSUER_BAND.low || price / value > ISSUER_BAND.high)
}

/**
 * The stock a token passes itself off as: its symbol is a stock's ticker (NVDA, NVDAx) or its name is the company's
 * («NVIDIA») while its mint is none of the confirmed stocks'. Never marked: the confirmed stock's own mint; a stock token
 * the venue names an issuer for (a supported one, or one Ryntra retired); a token priced within ±5 % of the share — it
 * tracks the share, and all we cannot say is who issued it (the venue's own «unverified» says that). A token whose name
 * names an issuer of tokenized shares («NVIDIA - Securitize», «NVIDIA xStock») is taken at its word only while its price
 * may be that share's — unknown, or within half to twice the share's (ST-5 r6: two «NVDAx · NVIDIA xStock» at
 * $0.0000029 beside the real one at $217 are not the stock). Null when the token names no stock.
 */
export function stockLookalike(
  token: CatalogueIdentity,
  universe: readonly StockUniverseRow[],
): StockUniverseRow | null {
  if (token.category === 'stock' && token.issuer !== null) return null
  if (universe.some((row) => row.mint === token.mint)) return null
  const issuerNamed = namesShareIssuer(token.name)
  const symbol = token.symbol.trim().replace(/^\$/, '').toLowerCase()
  const name = nameWords(token.name)
  for (const row of universe) {
    const root = tickerRoot(row.symbol, row.issuer)
    const company = nameWords(row.name)
    const named =
      (symbol.length > 0 && (symbol === root || symbol === row.symbol.toLowerCase())) ||
      (company.length >= 3 && name.length > 0 && (name === company || name.startsWith(`${company} `)))
    if (!named) continue
    if (issuerNamed) return farFromShare(token.price, row) ? row : null
    return tracksShare(token.price, row) ? null : row
  }
  return null
}

/**
 * Whether a catalogue row answers the typed words on its face — its symbol or name holds them, or its mint is them.
 * While the venue's answer on screen is still the previous query's, only such rows may stand under the new one
 * (ST-5 r6: «bonk» showed the rows for «b» under a count).
 */
export function catalogueMatches(row: Pick<MarketRow, 'mint' | 'symbol' | 'name'>, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return false
  return (
    row.mint.toLowerCase() === needle ||
    row.symbol.toLowerCase().includes(needle) ||
    row.name.toLowerCase().includes(needle)
  )
}

export function catalogueHit(row: MarketRow, universe: readonly StockUniverseRow[] = []): SearchHit {
  return {
    mint: row.mint,
    symbol: row.symbol,
    name: row.name,
    icon: row.icon,
    price: row.price,
    change24hPct: row.change24hPct,
    category: row.category,
    issuer: row.issuer,
    verified: row.verified,
    suspicious: row.suspicious,
    note: null,
    halted: false,
    origin: 'catalogue',
    lookalikeOf: stockLookalike(row, universe)?.name ?? null,
    // The venue's catalogue carries no reference for the share: no claim.
    poolFar: false,
  }
}

/**
 * Whether the venue holds the typed word itself: a verified, clean row whose symbol or name is it or starts with it
 * («bonk» → Bonk). A copy does not count — an unverified «NVIDIAA» does not make «nvidiaa» anything but NVIDIA misspelt.
 */
function catalogueHoldsWord(row: MarketRow, hit: SearchHit, needle: string): boolean {
  if (!row.verified || row.suspicious || hit.lookalikeOf !== null) return false
  const symbol = row.symbol.trim().replace(/^\$/, '').toLowerCase()
  const name = row.name.trim().toLowerCase()
  return symbol.startsWith(needle) || name.startsWith(needle)
}

/**
 * One list from both reads: the matching stocks first, then the venue's rows
 * in its own relevance order with the exact-symbol matches moved to the
 * front and verified rows before unverified ones; a token that borrows a
 * stock's ticker or name (`universe` — the whole confirmed universe, the
 * matching stocks when not given) comes after every row that does not. A
 * stock found only by a typo stands after every stock that holds the typed
 * words, and is left out when the venue holds the word itself (ST-5 r7:
 * «bonk» is the coin, not a Treasury ETF one letter from «bond»). A mint
 * appears once; a token whose symbol or name carries a slur does not appear.
 */
export function mergeHits(
  stocks: readonly StockUniverseRow[],
  catalogue: readonly MarketRow[],
  query: string,
  locale: Locale = 'en',
  universe: readonly StockUniverseRow[] = stocks,
): SearchHit[] {
  const needle = query.trim().toLowerCase()
  const score = (row: MarketRow): number => {
    const symbol = row.symbol.toLowerCase()
    const exact = symbol === needle || row.mint.toLowerCase() === needle ? 2 : symbol.startsWith(needle) ? 1 : 0
    return exact * 10 + (row.verified ? 5 : 0) + (row.suspicious ? -3 : 0)
  }
  const ranked = catalogue
    // A token whose symbol or name carries a slur is never listed (ST-5 r5, `blocked-names.ts`).
    .filter((row) => !isBlockedToken(row))
    .map((row, index) => ({ row, index, score: score(row), hit: catalogueHit(row, universe) }))
    .sort(
      (a, b) =>
        Number(a.hit.lookalikeOf !== null) - Number(b.hit.lookalikeOf !== null) ||
        b.score - a.score ||
        a.index - b.index,
    )
  const venueHoldsWord = needle.length > 0 && ranked.some((entry) => catalogueHoldsWord(entry.row, entry.hit, needle))
  const typoOnly = (row: StockUniverseRow): boolean => stockScore(row, needle) === 1
  const ordered = [...stocks.filter((row) => !typoOnly(row)), ...(venueHoldsWord ? [] : stocks.filter(typoOnly))]
  const seen = new Set<string>()
  const out: SearchHit[] = []
  for (const row of ordered) {
    if (seen.has(row.mint)) continue
    seen.add(row.mint)
    out.push(stockHit(row, locale))
  }
  for (const entry of ranked) {
    if (seen.has(entry.row.mint)) continue
    seen.add(entry.row.mint)
    out.push(entry.hit)
  }
  return out
}

/** The oldest of some times: the time a list drawn from several reads is true at. */
function oldestTime(times: readonly (string | null | undefined)[]): string | null {
  let found: string | null = null
  for (const time of times) {
    if (!time || Number.isNaN(Date.parse(time))) continue
    if (found === null || Date.parse(time) < Date.parse(found)) found = time
  }
  return found
}

/**
 * The time a merged list is true at — the oldest of the reads its rows come from: the venue's while one of its rows is
 * drawn, the stocks' while a stock is. Null when no drawn read states a time (ST-5 r7: a picker's prices carry their time).
 */
export function hitsObservedAt(
  hits: readonly Pick<SearchHit, 'origin'>[],
  catalogueAt: string | null | undefined,
  stocksAt: string | null | undefined,
): string | null {
  return oldestTime([
    hits.some((hit) => hit.origin === 'catalogue') ? catalogueAt : null,
    hits.some((hit) => hit.origin === 'stocks') ? stocksAt : null,
  ])
}
