/**
 * The portfolio as values — pure. What the wallet holds, as the server's
 * holdings read states it, folded into rows a screen draws: the group each
 * asset belongs to, its amount in its own units, its value where the
 * venue's catalogue prices it and a dash where it does not, the total of
 * what could be priced with the count of what could not, the day's move
 * over the rows that carry one. Nothing here reads the network.
 *
 * The one rule that is not cosmetic: an unknown price is not zero. The total
 * is the sum of what could be priced, it says how many assets it could not
 * price, and an unpriced row shows a dash rather than $0.00.
 *
 * And one that is not cosmetic either: a mint with the Scaled UI Amount
 * extension is counted in the unit the wallet shows — the raw amount times the
 * multiplier the holdings read states (1.15.0), the unit the catalogue prices
 * (PreStocks' SPACEX is ×5: its raw amount alone read five times too cheap).
 * The raw amounts stay beside it for a sale, which the chain counts raw.
 */

import { SOL_MINT, USDC_MINT, type Holding, type HoldingsCoverage, type HoldingsResponse } from '../../lib/api.ts'
import { DASH, shortAddress } from '../../utils/format.ts'
import { formatUnits, rawToNumber } from '../trade/trade-model.ts'

export const PORTFOLIO_GROUPS = ['stock', 'crypto', 'meme', 'cash', 'other'] as const
export type PortfolioGroup = (typeof PORTFOLIO_GROUPS)[number]

/**
 * Dollar-pegged assets the venue lists under "crypto": grouped as cash so a
 * balance a person keeps to trade with is not read as a position. The mints
 * are the issuers' own on mainnet; a symbol alone counts only on a verified
 * row, so a copy named "USDC" stays where the venue put it.
 */
const STABLE_MINTS: ReadonlySet<string> = new Set([
  USDC_MINT,
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', // PYUSD
  'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA', // USDS
  'DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT', // USDe
  '9zNQRsGLjNKwCUU5Gq5LR8beUCPzQMVMqKAi3SSZh54u', // FDUSD
  'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr', // EURC
])
const STABLE_SYMBOLS: ReadonlySet<string> = new Set([
  'USDC',
  'USDT',
  'PYUSD',
  'USDS',
  'USDE',
  'FDUSD',
  'EURC',
  'USD1',
  'USDG',
])

/** Below this a position is dust: folded away, still counted, never hidden. */
const DUST_MICROS = 10_000n
const PRICE_SCALE = 12n
const MICROS_PER_USD = 1_000_000n

export type PortfolioRow = Readonly<{
  /** The row's own identity in a list: the mint, or `native-sol`. */
  key: string
  /** The market's address — wrapped SOL for the native balance — for the asset screen and Trade. */
  mint: string
  native: boolean
  symbol: string
  name: string | null
  icon: string | null
  group: PortfolioGroup
  decimals: number
  /** What the chain counts, raw — what a sale spends. */
  amountRaw: string
  spendableRaw: string
  /** The mint's Scaled UI Amount multiplier in force, where it carries one (1.15.0); null otherwise. */
  multiplier: number | null
  /** The amount in the unit the wallet shows — through the multiplier. */
  amount: number
  /** That amount, formatted; the raw figure is kept beside it. */
  amountText: string
  price: number | null
  dayChangePct: number | null
  /** USD micro-units, exact; null when the catalogue has no price. */
  valueMicros: bigint | null
  value: number | null
  verified: boolean | null
  suspicious: boolean
  /** The venue quotes it: a Buy or a Sell can start from here. */
  tradeable: boolean
  /** A market row exists for it: the asset screen can open. */
  listed: boolean
  /** The row has a name from the venue or the chain. */
  named: boolean
}>

export type PortfolioGroupView = Readonly<{
  id: PortfolioGroup
  rows: readonly PortfolioRow[]
  /** The sum of the group's priced rows; null when none is priced. */
  subtotal: number | null
  priced: number
  unpriced: number
}>

export type DayChange = Readonly<{
  usd: number
  pct: number
  /** How many priced rows carried a day's move, of how many priced rows there are. */
  covered: number
  of: number
}>

export type PortfolioView = Readonly<{
  owner: string
  observedAt: string
  coverage: HoldingsCoverage
  /** Every asset row, priced first and by value, then by name. */
  rows: readonly PortfolioRow[]
  priced: number
  unpriced: number
  /** The sum of what could be priced; null when nothing could and something is held. */
  total: number | null
  dayChange: DayChange | null
  groups: readonly PortfolioGroupView[]
  /** Balances under a cent and unpriced ones, folded under one line. */
  dust: readonly PortfolioRow[]
  /** True only when the read was complete and the wallet holds nothing but an empty native balance. */
  empty: boolean
}>

/** A decimal price as text into an integer at `PRICE_SCALE` decimals; null for anything that is not a positive number. */
function priceScaled(text: string | null | undefined): bigint | null {
  if (typeof text !== 'string' || !/^\d+(\.\d+)?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  const digits = (fraction + '0'.repeat(Number(PRICE_SCALE))).slice(0, Number(PRICE_SCALE))
  const scaled = BigInt(whole) * 10n ** PRICE_SCALE + BigInt(digits)
  return scaled > 0n ? scaled : null
}

/** A multiplier the holdings read states, when it scales anything: a finite positive number other than one. */
function scaling(multiplier: number | null | undefined): number | null {
  return typeof multiplier === 'number' && Number.isFinite(multiplier) && multiplier > 0 && multiplier !== 1
    ? multiplier
    : null
}

/**
 * A raw amount in the unit the wallet shows, still raw: a scaled mint's raw
 * amount times its multiplier, taken as an exact ratio nine places deep —
 * the web's own rule (`shownRaw`), so the phone and ryntra.io count one
 * position alike (OpenAI's 1.4861347, SpaceX's 5).
 */
export function shownRaw(amountRaw: string, multiplier: number | null | undefined): string {
  const scale = scaling(multiplier)
  if (scale === null || !/^\d+$/.test(amountRaw)) return amountRaw
  return ((BigInt(amountRaw) * BigInt(Math.round(scale * 1e9))) / 1_000_000_000n).toString()
}

/** `amountRaw × price`, in USD micro-units, exact; null without a usable price. */
export function valueMicrosOf(amountRaw: string, decimals: number, price: string | null | undefined): bigint | null {
  const scaled = priceScaled(price)
  if (scaled === null || !/^\d+$/.test(amountRaw) || !Number.isInteger(decimals) || decimals < 0) return null
  return (BigInt(amountRaw) * scaled) / (10n ** BigInt(decimals) * 10n ** (PRICE_SCALE - 6n))
}

export function microsToUsd(micros: bigint): number {
  return Number(micros) / Number(MICROS_PER_USD)
}

function isStable(holding: Holding): boolean {
  const mint = holding.mint ?? holding.catalog?.mint ?? null
  if (mint && STABLE_MINTS.has(mint)) return true
  const symbol = (holding.catalog?.symbol ?? holding.symbol ?? '').toUpperCase()
  return holding.catalog?.isVerified === true && STABLE_SYMBOLS.has(symbol)
}

/** Where a holding sits: the native balance and stablecoins have their places; the rest is the venue's category. */
export function groupOf(holding: Holding): PortfolioGroup {
  if (holding.kind === 'NATIVE_SOL') return 'crypto'
  if (isStable(holding)) return 'cash'
  const category = holding.catalog?.category
  return category === 'stock' || category === 'meme' || category === 'crypto' ? category : 'other'
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** The amount in the asset's units, at most six places; a balance too small for six places says so instead of reading as zero. */
export function amountTextOf(amountRaw: string, decimals: number): string {
  const text = formatUnits(amountRaw, decimals, Math.min(6, decimals))
  return text === '0' && /^\d+$/.test(amountRaw) && amountRaw !== '0' ? '<0.000001' : text
}

export function portfolioRow(holding: Holding): PortfolioRow {
  const native = holding.kind === 'NATIVE_SOL'
  const mint = native ? SOL_MINT : (holding.mint ?? holding.catalog?.mint ?? '')
  const catalogSymbol = holding.catalog?.symbol?.trim() || null
  const ownSymbol = holding.symbol?.trim() || null
  const named = Boolean(catalogSymbol || ownSymbol || holding.name || holding.catalog?.name)
  const symbol = native ? 'SOL' : (catalogSymbol ?? ownSymbol ?? shortAddress(mint))
  const price = holding.catalog?.usdPrice ? Number(holding.catalog.usdPrice) : null
  // The catalogue prices the unit the wallet shows: a scaled mint's raw amount goes through its multiplier first.
  const multiplier = native ? null : scaling(holding.uiMultiplier)
  const shown = shownRaw(holding.amountRaw, multiplier)
  const valueMicros = valueMicrosOf(shown, holding.decimals, holding.catalog?.usdPrice)
  const change = holding.catalog?.dayChangePct
  return {
    key: native ? 'native-sol' : mint,
    mint,
    native,
    symbol,
    name: native ? 'Solana' : (holding.catalog?.name ?? holding.name ?? null),
    icon: holding.catalog?.icon ?? null,
    group: groupOf(holding),
    decimals: holding.decimals,
    amountRaw: holding.amountRaw,
    spendableRaw: holding.spendableRaw,
    multiplier,
    amount: rawToNumber(shown, holding.decimals),
    amountText: amountTextOf(shown, holding.decimals),
    price: finite(price) && price > 0 ? price : null,
    dayChangePct: finite(change) ? change : null,
    valueMicros,
    value: valueMicros === null ? null : microsToUsd(valueMicros),
    verified: typeof holding.catalog?.isVerified === 'boolean' ? holding.catalog.isVerified : null,
    suspicious: holding.catalog?.isSuspicious === true,
    tradeable: native || Boolean(catalogSymbol),
    listed: native || holding.catalog !== null,
    named: native || named,
  }
}

function byValue(a: PortfolioRow, b: PortfolioRow): number {
  if (a.valueMicros !== null && b.valueMicros !== null)
    return a.valueMicros > b.valueMicros ? -1 : a.valueMicros < b.valueMicros ? 1 : 0
  if (a.valueMicros !== null) return -1
  if (b.valueMicros !== null) return 1
  return a.symbol.localeCompare(b.symbol)
}

/**
 * Dust: a balance under a cent, or one the venue cannot price at all — the
 * airdropped and the unlisted. Counted, folded under one line, never hidden;
 * the native balance is never dust.
 */
export function isDust(row: PortfolioRow): boolean {
  if (row.native) return false
  return row.valueMicros === null || row.valueMicros < DUST_MICROS
}

/** The day's move over the priced rows that carry one: today's value against what it was a day ago. */
export function dayChangeOf(rows: readonly PortfolioRow[]): DayChange | null {
  let current = 0
  let previous = 0
  let covered = 0
  let of = 0
  for (const row of rows) {
    if (row.value === null) continue
    of += 1
    if (row.dayChangePct === null || row.dayChangePct <= -100) continue
    const before = row.value / (1 + row.dayChangePct / 100)
    current += row.value
    previous += before
    covered += 1
  }
  if (covered === 0 || previous <= 0) return null
  const usd = current - previous
  return { usd, pct: (usd / previous) * 100, covered, of }
}

/** The whole read, as the screen draws it. */
export function portfolioView(data: HoldingsResponse['data']): PortfolioView {
  const rows = data.holdings.map(portfolioRow).sort(byValue)
  const coverage: HoldingsCoverage = data.tokenRead ?? 'COMPLETE'
  const priced = rows.filter((row) => row.valueMicros !== null)
  const unpriced = rows.length - priced.length
  const totalMicros = priced.reduce((sum, row) => sum + (row.valueMicros ?? 0n), 0n)
  const total = priced.length === 0 && unpriced > 0 ? null : microsToUsd(totalMicros)
  const dust = rows.filter(isDust)
  const positions = rows.filter((row) => !isDust(row))
  const groups: PortfolioGroupView[] = PORTFOLIO_GROUPS.map((id) => {
    const members = positions.filter((row) => row.group === id)
    const pricedMembers = members.filter((row) => row.valueMicros !== null)
    return {
      id,
      rows: members,
      subtotal:
        pricedMembers.length === 0
          ? null
          : microsToUsd(pricedMembers.reduce((sum, row) => sum + (row.valueMicros ?? 0n), 0n)),
      priced: pricedMembers.length,
      unpriced: members.length - pricedMembers.length,
    }
  }).filter((group) => group.rows.length > 0)
  const native = rows.find((row) => row.native)
  const empty = coverage === 'COMPLETE' && rows.length <= 1 && (native === undefined || native.amountRaw === '0')
  return {
    owner: data.owner,
    observedAt: data.observedAt,
    coverage,
    rows,
    priced: priced.length,
    unpriced,
    total,
    dayChange: dayChangeOf(rows),
    groups,
    dust,
    empty,
  }
}

/** The row for a mint, the native balance answering to wrapped SOL's address. */
export function rowForMint(view: PortfolioView, mint: string): PortfolioRow | null {
  return view.rows.find((row) => row.mint === mint) ?? null
}

export { DASH }
