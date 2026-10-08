/**
 * «Ринки» — one screener for everything Ryntra trades, the web's
 * own (`lib/markets/screener.ts`): memes, crypto, tokenized stocks and private
 * companies in one list, with the tabs Усі · Меми · Крипта · Акції · Приватні ·
 * Обране. Pure: rows in, rows out.
 *
 * Every figure is the source's own — the venue's for coins (the Spot list the
 * phone already reads), the stock universe's for stocks — and a figure a
 * source did not state stays null, drawn as a dash, never a zero. The order is
 * the one the person chose and nothing else: no row is «recommended».
 * «Тренди» is a sort of this list («У тренді»), not a page; a deposit receipt
 * (Jupiter Lend's jlUSDC and its kin) is a lending position, not a market, and
 * is not a row.
 */

import type { MarketRow, SessionPeriod, StockUniverseRow } from '../../lib/api.ts'

export const SCREENER_TABS = ['all', 'memes', 'crypto', 'stocks', 'private', 'watchlist'] as const
export type ScreenerTab = (typeof SCREENER_TABS)[number]

export function isScreenerTab(value: unknown): value is ScreenerTab {
  return typeof value === 'string' && (SCREENER_TABS as readonly string[]).includes(value)
}

const one = (value: string | readonly string[] | null | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null

/**
 * The tab an address asks for: `?tab=`, and the words the lists this screener
 * replaced used — the web's stock screener's `?kind=preipo` and Trends'
 * `?mode=meme`, the phone's own lists' `stock`, `meme`, `crypto` and
 * `watchlist` — so an old link opens where it pointed.
 */
export function screenerTabOf(
  params: Readonly<Record<string, string | readonly string[] | null | undefined>>,
): ScreenerTab {
  const tab = one(params.tab)
  const kind = one(params.kind)
  if (kind === 'preipo') return 'private'
  if (isScreenerTab(tab)) return tab
  if (tab === 'stock' || tab === 'companies') return 'stocks'
  if (tab === 'meme') return 'memes'
  if (tab === 'dollars') return 'crypto'
  if (kind === 'listed') return 'stocks'
  const mode = one(params.mode)
  if (mode === 'meme' || mode === 'memes') return 'memes'
  if (mode === 'stocks') return 'stocks'
  return 'all'
}

/** The screener's address on a tab — the bar's Markets, opened where it should be. */
export function marketsPath(tab: ScreenerTab = 'all'): string {
  return tab === 'all' ? '/(tabs)/markets' : `/(tabs)/markets?tab=${tab}`
}

export type ScreenerKind = 'meme' | 'crypto' | 'stock' | 'private'

export type ScreenerRow = Readonly<{
  kind: ScreenerKind
  mint: string
  symbol: string
  name: string
  icon: string | null
  price: number | null
  change24h: number | null
  volume24h: number | null
  liquidity: number | null
  verified: boolean
  /** The venue's own flag on a token it found suspicious. */
  suspicious: boolean
  /** The issuer's id for a stock or a private company; the venue's tag for a stock it lists. */
  issuer: string | null
  /** The exchange's trading period for a stock, as the stock universe states it. */
  period: SessionPeriod | null
  /** The token against the exchange's price of the share, per cent. */
  deviation: number | null
  /** A private company's token against the issuer's own valuation, per cent — context, never a deviation. */
  markPremium: number | null
  halted: boolean
  /** Whether the issuer offers a new purchase. */
  tradable: boolean
}>

const finite = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/** A deposit receipt — one of Jupiter Lend's, which its issuer names «Jupiter Lend …»; the public list carries no tags. */
export function isDepositToken(row: Pick<MarketRow, 'name'>): boolean {
  return /^jupiter lend(?:\s|$)/i.test(row.name ?? '')
}

/**
 * A row of the venue's list as a screener row, or null where it is not one the
 * screener draws: a deposit receipt, or a token the venue did not classify. A
 * stock the venue lists is a row only where `stocks` is asked (the watchlist,
 * which may hold any kind) — the stock universe draws the stocks otherwise,
 * with the issuer's facts.
 */
export function marketScreenerRow(row: MarketRow, options: Readonly<{ stocks?: boolean }> = {}): ScreenerRow | null {
  if (isDepositToken(row)) return null
  const kind: ScreenerKind | null =
    row.category === 'meme'
      ? 'meme'
      : row.category === 'crypto'
        ? 'crypto'
        : row.category === 'stock' && options.stocks
          ? 'stock'
          : null
  if (!kind) return null
  return {
    kind,
    mint: row.mint,
    symbol: row.symbol,
    name: row.name,
    icon: row.icon,
    price: finite(row.price),
    change24h: finite(row.change24hPct),
    volume24h: finite(row.volume24hUsd),
    liquidity: finite(row.liquidityUsd),
    verified: row.verified,
    suspicious: row.suspicious,
    issuer: kind === 'stock' ? (row.issuer?.tag ?? null) : null,
    period: null,
    deviation: null,
    markPremium: null,
    halted: false,
    tradable: true,
  }
}

/** One token of the stock universe as a row: a listed stock or ETF, or a private company's token — «Це не акція». */
export function stockScreenerRow(row: StockUniverseRow): ScreenerRow {
  const privateCompany = row.kind === 'pre-ipo'
  return {
    kind: privateCompany ? 'private' : 'stock',
    mint: row.mint,
    symbol: row.symbol,
    name: row.name,
    icon: row.icon,
    price: finite(row.price),
    change24h: finite(row.change24h),
    volume24h: finite(row.volume),
    liquidity: finite(row.liquidity),
    verified: true,
    suspicious: false,
    issuer: row.issuer,
    period: privateCompany || row.period === 'unknown' ? null : row.period,
    deviation: privateCompany ? null : finite(row.deviation),
    markPremium: privateCompany ? finite(row.markPremium) : null,
    halted: row.halted,
    tradable: row.tradable !== false,
  }
}

/** Rows of several reads as one list, one row per mint — the first read that names a mint keeps it. */
export function uniqueRows(...lists: readonly (readonly ScreenerRow[])[]): ScreenerRow[] {
  const seen = new Set<string>()
  const rows: ScreenerRow[] = []
  for (const list of lists) {
    for (const row of list) {
      if (seen.has(row.mint)) continue
      seen.add(row.mint)
      rows.push(row)
    }
  }
  return rows
}

/** The rows a tab holds. «Обране» is read on its own (`useWatchlistMarkets`) and holds whatever kind the person starred. */
export function rowsForTab(rows: readonly ScreenerRow[], tab: ScreenerTab): ScreenerRow[] {
  switch (tab) {
    case 'memes':
      return rows.filter((row) => row.kind === 'meme')
    case 'crypto':
      return rows.filter((row) => row.kind === 'crypto')
    case 'stocks':
      return rows.filter((row) => row.kind === 'stock')
    case 'private':
      return rows.filter((row) => row.kind === 'private')
    default:
      return [...rows]
  }
}

/**
 * The orders a person can choose, the web's own words: «У тренді» (the day's
 * volume), «Зростають», «Падають», «Ліквідність», and for stocks «До біржі»
 * (the largest deviation from the exchange). The web's «Рух за годину» and
 * «Нові» need the hour's change and the first pool's age, which the public
 * list the phone reads does not carry.
 */
export const SCREENER_SORTS = ['volume', 'rise', 'fall', 'liquidity', 'deviation'] as const
export type ScreenerSort = (typeof SCREENER_SORTS)[number]

/** The orders a tab offers: «До біржі» only where every row is a listed stock. */
export function sortsFor(tab: ScreenerTab): readonly ScreenerSort[] {
  return tab === 'stocks' ? SCREENER_SORTS : SCREENER_SORTS.filter((sort) => sort !== 'deviation')
}

/** A figure a source did not state sorts after every stated one, whichever way the order runs. */
function byFigure(pick: (row: ScreenerRow) => number | null, direction: 1 | -1) {
  return (a: ScreenerRow, b: ScreenerRow): number => {
    const x = pick(a)
    const y = pick(b)
    if (x === null && y === null) return 0
    if (x === null) return 1
    if (y === null) return -1
    return direction * (y - x)
  }
}

export function sortRows(rows: readonly ScreenerRow[], sort: ScreenerSort): ScreenerRow[] {
  const copy = [...rows]
  // Equal figures keep the source's own order; a tie on the figure falls back to the day's volume.
  const volume = byFigure((row) => row.volume24h, 1)
  const order = (primary: (a: ScreenerRow, b: ScreenerRow) => number) => (a: ScreenerRow, b: ScreenerRow) =>
    primary(a, b) || volume(a, b)
  switch (sort) {
    case 'rise':
      return copy.sort(order(byFigure((row) => row.change24h, 1)))
    case 'fall':
      return copy.sort(order(byFigure((row) => row.change24h, -1)))
    case 'liquidity':
      return copy.sort(order(byFigure((row) => row.liquidity, 1)))
    case 'deviation':
      return copy.sort(order(byFigure((row) => (row.deviation === null ? null : Math.abs(row.deviation)), 1)))
    default:
      return copy.sort(volume)
  }
}

/* ---------------------------------------------------------- a contract address */

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** A Solana address as a person pastes it — base58, 32 to 44 characters, nothing else around it. */
export function isContractAddress(text: string): boolean {
  return ADDRESS.test(text.trim())
}

/**
 * Where a token's address leads — the web's own order (`app/app/token/[mint]`):
 * a tokenized stock's or a private company's page, a launch's page when the
 * token was launched on Ryntra, else the token's own page, which reads any
 * mint the venue knows and says so when it knows none.
 */
export function tokenDestination(
  mint: string,
  found: Readonly<{ stockSymbol: string | null; launched: boolean }>,
): Readonly<{ pathname: '/asset/[mint]' | '/launch/[mint]'; params: Readonly<Record<string, string>> }> {
  if (found.stockSymbol) return { pathname: '/asset/[mint]', params: { mint, symbol: found.stockSymbol } }
  if (found.launched) return { pathname: '/launch/[mint]', params: { mint } }
  return { pathname: '/asset/[mint]', params: { mint } }
}
