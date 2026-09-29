/**
 * The investor's shelves — Home and Markets on the beginner's path (canon
 * v5.1 §2, §3, §4; one version since v5.3 В28): the companies, the private companies, the dollars and the crypto.
 * Pure: the rows the public routes answer go in, cards come out; nothing here
 * reads the network or ranks anything by an opinion.
 *
 * **One company, one card.** The stock universe lists every confirmed
 * representation — Apple as xStocks' AAPLx, as Backpack's — which is what
 * the lists of «Для досвідчених» are for. A person who wants «частинку Apple» wants Apple: the
 * shelf groups the representations of one underlying (the same instrument,
 * never merely one company name) and shows the one it would buy — the most
 * liquid representation the issuer confirms in its own catalogue, else the
 * most liquid one. The rule is the web line's own (`lib/stocks/shelf.ts`), so
 * the phone and ryntra.io show the same cards in the same order.
 *
 * **Who is on the shelf:** xStocks and Backpack. Ondo is not a beginner's
 * first purchase (canon §3, the depth of its pools); a representation that is
 * halted, not offered by its issuer or has no price is no card either.
 *
 * **The order is neutral and published:** the company's trading volume over
 * the last twenty-four hours across its representations, the same for every
 * person (canon §4: no «топ-3», no one's opinion).
 *
 * **Private companies** (pre-IPO) are a shelf of their own, and they come
 * through PreStocks alone (canon v5.2 В25–В27): its eight companies, each its
 * own card, every one saying «Це не акція» and one honest number — its price
 * against PreStocks' own valuation of the company's token.
 */

import { SOL_MINT, USDC_MINT, USDT_MINT, type MarketRow, type StockRow } from '../../lib/api.ts'
import type { Locale } from '../../lib/i18n.ts'
import { eventOfRow, isIssuerEvent, type IssuerEvent } from './conversion-watch.ts'
import type { InvestCopy } from './copy.ts'

/** The issuers whose instruments a beginner is shown (canon §3, §7). */
export const SHELF_ISSUERS: ReadonlySet<string> = new Set(['xstocks', 'backpack'])

/** The one issuer of private companies (canon v5.2 В25: private companies through PreStocks only). */
export const PRIVATE_ISSUER = 'prestocks'

/** Cards on Home's «Популярні компанії». */
export const POPULAR_COUNT = 8

export type ShelfCard = Readonly<{
  /** The company as a person names it. */
  name: string
  /** The token the card opens and would buy — never a title on the card. */
  ticker: string
  mint: string
  icon: string | null
  /** Per token as the wallet shows it, USD — the price a person pays. */
  price: number
  change24h: number | null
  /** The company's trading over the last day, USD — the shelf's order. */
  volume24h: number
  issuer: string
  /** A private company's price against its issuer's own mark of the token, per cent; null when unknown or listed. */
  premiumPct: number | null
}>

export type CompanyShelf = Readonly<{
  companies: readonly ShelfCard[]
  privateCompanies: readonly ShelfCard[]
  /**
   * The issuers' windows to swap a token before a cut-off, as the universe
   * states them (the IPO and conversion watch, M19) — whether or not the
   * token is still on a shelf: Portfolio says a held token's deadline, and
   * that it has passed, from here.
   */
  events: readonly IssuerEvent[]
  /** When the market was read. */
  fetchedAt: string
}>

/** Index funds whose issuer name says something other than the index. */
const INDEX_NAMES: Readonly<Record<string, string>> = {
  SPY: 'S&P 500',
  QQQ: 'Nasdaq 100',
}

const COMMON_STOCK = /\s+common stock$/i
const LEADING_THE = /^the\s+/i
const LEGAL_FORM = /,?\s+(inc\.?|incorporated|corp\.?|corporation|co\.?|company|ltd\.?|limited|llc|plc|n\.v\.|s\.a\.)$/i
const TRAILING_AND = /\s+(and|&)$/i

/**
 * A company's name as a person reads it: the issuer's own words with the
 * legal form and the share class's boilerplate taken off. Never shorter than
 * a word — a name that would vanish is kept as the issuer wrote it.
 */
export function companyDisplayName(name: string, underlyingSymbol: string | null = null): string {
  const alias = underlyingSymbol ? INDEX_NAMES[underlyingSymbol.toUpperCase()] : undefined
  if (alias) return alias
  let out = name.trim().replace(COMMON_STOCK, '').replace(LEADING_THE, '')
  for (let pass = 0; pass < 3; pass += 1) {
    const next = out.replace(LEGAL_FORM, '').replace(TRAILING_AND, '').trim()
    if (next === out) break
    out = next
  }
  return out.length > 0 ? out : name.trim()
}

const positive = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

const instrumentClass = (row: StockRow): string => row.representation.instrument?.class ?? 'listed-equity'
const unitBasis = (row: StockRow): string => row.representation.instrument?.unitBasis ?? 'share'

/**
 * Whether two representations are one underlying: the same instrument class
 * and unit, the same underlying symbol and, where both issuers state an ISIN,
 * the same ISIN. A share class, an ETF or a private instrument is its own group.
 */
export function sameUnderlying(anchor: StockRow, candidate: StockRow): boolean {
  if (unitBasis(anchor) !== unitBasis(candidate) || instrumentClass(anchor) !== instrumentClass(candidate)) return false
  const a = anchor.representation.underlying
  const b = candidate.representation.underlying
  if (a.symbol.trim().toUpperCase() !== b.symbol.trim().toUpperCase()) return false
  if (a.isin !== null && b.isin !== null) return a.isin.toUpperCase() === b.isin.toUpperCase()
  return true
}

/** A representation a beginner can be shown and can buy now. */
export function isShelfCandidate(row: StockRow): boolean {
  return (
    SHELF_ISSUERS.has(row.representation.issuer.id) &&
    row.representation.tradingHalted !== true &&
    row.lifecycle?.tradable !== false &&
    positive(row.market.priceUsd)
  )
}

const liquidity = (row: StockRow): number => row.market.liquidityUsd ?? 0
const volume = (row: StockRow): number => (positive(row.market.volume24hUsd) ? row.market.volume24hUsd : 0)

/** The representation a card stands for: the issuer's catalogue before the venue's tag, then the deepest pool. */
function defaultOf(group: readonly StockRow[]): StockRow | null {
  const candidates = group.filter(isShelfCandidate)
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => {
    const confirmed =
      Number(b.representation.issuerConfirmation === 'issuer-catalogue') -
      Number(a.representation.issuerConfirmation === 'issuer-catalogue')
    return confirmed !== 0 ? confirmed : liquidity(b) - liquidity(a)
  })[0]!
}

function cardOf(row: StockRow, dayVolume: number, name: string): ShelfCard {
  const change = row.market.change24hPct
  const premium = row.markPremiumPct
  return {
    name,
    ticker: row.representation.symbol,
    mint: row.representation.mint,
    icon: row.market.icon,
    price: row.market.priceUsd as number,
    change24h: typeof change === 'number' && Number.isFinite(change) ? Math.round(change * 100) / 100 : null,
    volume24h: Math.round(dayVolume),
    issuer: row.representation.issuer.id,
    premiumPct: typeof premium === 'number' && Number.isFinite(premium) ? Math.round(premium * 100) / 100 : null,
  }
}

/** The listed companies, one card each, by the day's volume. */
export function shelfCompanies(rows: readonly StockRow[]): ShelfCard[] {
  const listed = rows.filter((row) => instrumentClass(row) === 'listed-equity')
  const groups: StockRow[][] = []
  for (const row of [...listed].sort((a, b) => liquidity(b) - liquidity(a))) {
    const home = groups.find((group) => sameUnderlying(group[0]!, row))
    if (home) home.push(row)
    else groups.push([row])
  }
  const cards: ShelfCard[] = []
  for (const group of groups) {
    const chosen = defaultOf(group)
    if (!chosen) continue
    const name = companyDisplayName(
      chosen.representation.underlying.name ?? chosen.representation.name,
      chosen.representation.underlying.symbol,
    )
    cards.push(
      cardOf(
        chosen,
        group.reduce((sum, row) => sum + volume(row), 0),
        name,
      ),
    )
  }
  return cards.sort((a, b) => b.volume24h - a.volume24h || a.name.localeCompare(b.name))
}

/** The private companies — PreStocks' alone: every instrument its own card, never folded (canon §7), by the day's volume. */
export function shelfPrivateCompanies(rows: readonly StockRow[]): ShelfCard[] {
  return rows
    .filter(
      (row) =>
        instrumentClass(row) === 'pre-ipo' &&
        row.representation.issuer.id === PRIVATE_ISSUER &&
        row.representation.tradingHalted !== true &&
        row.lifecycle?.tradable !== false &&
        positive(row.market.priceUsd),
    )
    .map((row) =>
      cardOf(row, volume(row), companyDisplayName(row.representation.underlying.name ?? row.representation.name)),
    )
    .sort((a, b) => b.volume24h - a.volume24h || a.name.localeCompare(b.name))
}

/** Every window the universe states on a token's own row, named by the company as the shelf names it. */
export function shelfEvents(rows: readonly StockRow[]): IssuerEvent[] {
  return rows.flatMap((row) => {
    const event = eventOfRow(row, companyDisplayName(row.representation.underlying.name ?? row.representation.name))
    return event ? [event] : []
  })
}

export function companyShelf(universe: Readonly<{ rows: readonly StockRow[]; fetchedAt: string }>): CompanyShelf {
  return {
    companies: shelfCompanies(universe.rows),
    privateCompanies: shelfPrivateCompanies(universe.rows),
    events: shelfEvents(universe.rows),
    fetchedAt: universe.fetchedAt,
  }
}

/** The company a card names, by the token's address — for the words of another screen. */
export function shelfCardFor(shelf: CompanyShelf | null | undefined, mint: string): ShelfCard | null {
  if (!shelf) return null
  return (
    shelf.companies.find((card) => card.mint === mint) ??
    shelf.privateCompanies.find((card) => card.mint === mint) ??
    null
  )
}

/** Search the shelf by the company's name or the token's symbol: the exact word first, then a start, then anywhere. */
export function matchShelf(cards: readonly ShelfCard[], query: string): ShelfCard[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return [...cards]
  const score = (card: ShelfCard): number => {
    const name = card.name.toLowerCase()
    const ticker = card.ticker.toLowerCase()
    if (name === needle || ticker === needle) return 3
    if (name.startsWith(needle) || ticker.startsWith(needle)) return 2
    return name.includes(needle) || ticker.includes(needle) ? 1 : 0
  }
  return cards
    .map((card) => ({ card, score: score(card) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.card.volume24h - a.card.volume24h)
    .map((entry) => entry.card)
}

/* ---- a private company's one number (canon v5.2 В27) ---- */

export type MarkPremium = Readonly<{ side: 'above' | 'below' | 'at'; pct: number }>

/**
 * A private company's price against PreStocks' own valuation of its token, as
 * a person reads it at a glance: a whole per cent from ten up, one decimal
 * below; nothing when the server states none — never a zero in its place.
 * Context for orientation, never a reason to trade: no tone of good or bad.
 */
export function markPremium(pct: number | null | undefined): MarkPremium | null {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null
  const size = Math.abs(pct)
  const rounded = size >= 10 ? Math.round(size) : Math.round(size * 10) / 10
  if (rounded === 0) return { side: 'at', pct: 0 }
  return { side: pct > 0 ? 'above' : 'below', pct: rounded }
}

/** «На 31% дорожче за оцінку PreStocks», «22% below PreStocks’ valuation»; null when the server states none. */
export function premiumPhrase(
  pct: number | null | undefined,
  locale: Locale,
  words: Pick<InvestCopy, 'markAbove' | 'markBelow' | 'markAt'>,
): string | null {
  const premium = markPremium(pct)
  if (!premium) return null
  if (premium.side === 'at') return words.markAt
  const figure = `${new Intl.NumberFormat(locale === 'uk' ? 'uk-UA' : 'en-US', { maximumFractionDigits: 1 }).format(premium.pct)}%`
  return premium.side === 'above' ? words.markAbove(figure) : words.markBelow(figure)
}

/* ---- dollars and crypto ---- */

/** The dollar tokens, in the canon's order (§3): USDC, USDT. */
export const DOLLAR_MINTS: readonly string[] = [USDC_MINT, USDT_MINT]

/**
 * Money tokens the venue lists among its majors — none of them is «crypto» to
 * a beginner: by address for the ones the product names, by the symbol's own
 * word for the rest (a dollar or a euro token says so in its symbol).
 */
const DOLLAR_LIKE: ReadonlySet<string> = new Set([
  USDC_MINT,
  USDT_MINT,
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', // PYUSD
  'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA', // USDS
])
const MONEY_SYMBOL = /usd|eur/i

/** Crypto cards on Markets before «Показати ще». */
export const CRYPTO_SHOWN = 8

export type ShelfCoin = Readonly<{
  name: string
  symbol: string
  mint: string
  icon: string | null
  price: number
  change24h: number | null
  volume24h: number
}>

export type CoinShelf = Readonly<{ dollars: readonly ShelfCoin[]; crypto: readonly ShelfCoin[] }>

/** The name a person knows a coin by; SOL is listed by the venue as its wrapped form. */
export function coinName(row: Pick<MarketRow, 'mint' | 'name'>): string {
  if (row.mint === SOL_MINT) return 'Solana'
  if (row.mint === USDC_MINT) return 'USD Coin'
  if (row.mint === USDT_MINT) return 'Tether USD'
  return row.name
}

const priced = (row: MarketRow): boolean => positive(row.price)

function coinOf(row: MarketRow): ShelfCoin {
  const change = row.change24hPct
  return {
    name: coinName(row),
    symbol: row.mint === SOL_MINT ? 'SOL' : row.symbol,
    mint: row.mint,
    icon: row.icon,
    price: row.price as number,
    change24h: typeof change === 'number' && Number.isFinite(change) ? Math.round(change * 100) / 100 : null,
    volume24h: Math.round(row.volume24hUsd ?? 0),
  }
}

/**
 * The dollars — USDC and USDT, in that order, when the venue prices them — and
 * the crypto: the venue's verified crypto, never a meme (memes are «Для досвідчених»),
 * never a token the venue flags, never a money token again, by the day's volume.
 */
export function coinShelf(rows: readonly MarketRow[]): CoinShelf {
  const byMint = new Map(rows.map((row) => [row.mint, row]))
  const dollars = DOLLAR_MINTS.flatMap((mint) => {
    const row = byMint.get(mint)
    return row && priced(row) ? [coinOf(row)] : []
  })
  const seen = new Set<string>()
  const crypto = rows
    .filter((row) => {
      if (seen.has(row.mint)) return false
      seen.add(row.mint)
      return (
        row.category === 'crypto' &&
        row.verified &&
        !row.suspicious &&
        !DOLLAR_LIKE.has(row.mint) &&
        !MONEY_SYMBOL.test(row.symbol) &&
        priced(row)
      )
    })
    .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
    .map(coinOf)
  return { dollars, crypto }
}

/** Search the coins by name or symbol. */
export function matchCoins(coins: readonly ShelfCoin[], query: string): ShelfCoin[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return [...coins]
  return coins.filter((coin) => coin.name.toLowerCase().includes(needle) || coin.symbol.toLowerCase().includes(needle))
}

/* ---- the device's copy ---- */

function isCard(value: unknown): value is ShelfCard {
  if (!value || typeof value !== 'object') return false
  const card = value as Record<string, unknown>
  return (
    typeof card.name === 'string' &&
    typeof card.ticker === 'string' &&
    typeof card.mint === 'string' &&
    typeof card.price === 'number' &&
    Number.isFinite(card.price) &&
    (card.icon === null || typeof card.icon === 'string') &&
    (card.change24h === null || typeof card.change24h === 'number') &&
    typeof card.volume24h === 'number' &&
    typeof card.issuer === 'string' &&
    (card.premiumPct === undefined || card.premiumPct === null || typeof card.premiumPct === 'number')
  )
}

/** A kept card as today's shelf draws it: a card kept before the premium was read says none. */
const keptCard = (card: ShelfCard): ShelfCard => ({ ...card, premiumPct: card.premiumPct ?? null })

/**
 * A shelf kept on the device, read back defensively: anything that is not a
 * shelf is none, never a crash; and today's rule applies to the copy too — a
 * card of an issuer the shelf no longer takes is not shown from an old read.
 */
export function parseShelf(stored: string | null | undefined): CompanyShelf | null {
  if (!stored) return null
  try {
    const value: unknown = JSON.parse(stored)
    if (!value || typeof value !== 'object') return null
    const raw = value as Record<string, unknown>
    if (typeof raw.fetchedAt !== 'string' || !Number.isFinite(Date.parse(raw.fetchedAt))) return null
    if (!Array.isArray(raw.companies) || !Array.isArray(raw.privateCompanies)) return null
    if (!raw.companies.every(isCard) || !raw.privateCompanies.every(isCard)) return null
    return {
      companies: raw.companies.filter((card) => SHELF_ISSUERS.has(card.issuer)).map(keptCard),
      privateCompanies: raw.privateCompanies.filter((card) => card.issuer === PRIVATE_ISSUER).map(keptCard),
      // A copy kept before the watch knew no events; an event that does not read back whole is dropped, never guessed.
      events: Array.isArray(raw.events) ? raw.events.filter(isIssuerEvent) : [],
      fetchedAt: raw.fetchedAt,
    }
  } catch {
    return null
  }
}

export function serializeShelf(shelf: CompanyShelf): string {
  return JSON.stringify(shelf)
}
