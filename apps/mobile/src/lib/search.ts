/**
 * Search by company, ticker or token — pure ranking over what two reads
 * return. The confirmed stock universe answers company names (the venue's
 * catalogue does not know that NVDAx is NVIDIA); the venue's own search
 * answers symbols, names and mints across every token, copies included.
 * Stocks come first, verified before unverified, nothing is dropped and a
 * copy is shown for what it is.
 */

import type { MarketCategory, MarketIssuer, MarketRow, StockUniverseRow } from '@/lib/api'
import type { Locale } from '@/lib/i18n'
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
}>

const number = (value: number | null): number => (value === null ? Number.NEGATIVE_INFINITY : value)

/** The confirmed stocks that match, best first: exact symbol or mint, then a symbol prefix, then a name or symbol part. */
export function matchStocks(rows: readonly StockUniverseRow[], query: string): StockUniverseRow[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return []
  const score = (row: StockUniverseRow): number => {
    const symbol = row.symbol.toLowerCase()
    if (symbol === needle || row.mint.toLowerCase() === needle) return 3
    if (symbol.startsWith(needle)) return 2
    if (symbol.includes(needle) || row.name.toLowerCase().includes(needle)) return 1
    return 0
  }
  return rows
    .map((row) => ({ row, score: score(row) }))
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
  }
}

export function catalogueHit(row: MarketRow): SearchHit {
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
  }
}

/**
 * One list from both reads: the matching stocks first, then the venue's rows
 * in its own relevance order with the exact-symbol matches moved to the
 * front and verified rows before unverified ones. A mint appears once.
 */
export function mergeHits(
  stocks: readonly StockUniverseRow[],
  catalogue: readonly MarketRow[],
  query: string,
  locale: Locale = 'en',
): SearchHit[] {
  const needle = query.trim().toLowerCase()
  const seen = new Set<string>()
  const out: SearchHit[] = []
  for (const row of stocks) {
    if (seen.has(row.mint)) continue
    seen.add(row.mint)
    out.push(stockHit(row, locale))
  }
  const score = (row: MarketRow): number => {
    const symbol = row.symbol.toLowerCase()
    const exact = symbol === needle || row.mint.toLowerCase() === needle ? 2 : symbol.startsWith(needle) ? 1 : 0
    return exact * 10 + (row.verified ? 5 : 0) + (row.suspicious ? -3 : 0)
  }
  const ranked = catalogue
    .map((row, index) => ({ row, index, score: score(row) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
  for (const entry of ranked) {
    if (seen.has(entry.row.mint)) continue
    seen.add(entry.row.mint)
    out.push(catalogueHit(entry.row))
  }
  return out
}
