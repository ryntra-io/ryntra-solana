/**
 * Launch's figures as the web writes them: raw chain amounts to decimals and
 * back, shares, short money, a tiny price with its zeros counted, an address
 * short. The same shapes on both, so a person reads one number one way.
 */

import type { Locale } from '../../lib/locale.ts'

/** A decimal the person typed, in raw units of `decimals`; null when it is not an amount. Empty is zero. */
export function toRaw(text: string, decimals: number): bigint | null {
  const clean = text.trim().replace(',', '.')
  if (!clean) return 0n
  if (!/^\d+(\.\d+)?$/.test(clean)) return null
  const [whole = '0', fraction = ''] = clean.split('.')
  if (fraction.length > decimals) return null
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')
}

/** Raw units as a decimal, at most `places` digits after the point, trailing zeros dropped. */
export function fromRaw(raw: bigint | string, decimals: number, places = decimals): string {
  const value = typeof raw === 'string' ? BigInt(raw) : raw
  const unit = 10n ** BigInt(decimals)
  const whole = value / unit
  const fraction = (value % unit).toString().padStart(decimals, '0').slice(0, places).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

/**
 * Raw units as the amount field takes them back: cut down (never rounded up) to `places`, with the locale's decimal
 * separator and no grouping — `toRaw` reads it again as the same amount.
 */
export function typedAmount(raw: bigint | string, decimals: number, locale: Locale, places = decimals): string {
  const text = fromRaw(raw, decimals, places)
  return locale === 'uk' ? text.replace('.', ',') : text
}

const tag = (locale: Locale) => (locale === 'uk' ? 'uk-UA' : 'en-US')

export function formatNumber(value: number, locale: Locale, digits = 0): string {
  return new Intl.NumberFormat(tag(locale), { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value)
}

/** A raw amount as the person reads it: grouped, at most `digits` after the point. */
export function formatRaw(raw: bigint | string, decimals: number, locale: Locale, digits = 2): string {
  return formatNumber(Number(fromRaw(raw, decimals, Math.max(digits, 0))), locale, digits)
}

/**
 * A fee, never shown smaller than it is: two decimals from a whole unit up,
 * below it as many as three significant digits need (0.0162 · 0.00041),
 * never more than the currency has — the last digit rounded up, never down.
 * A share that is nothing (a part no one takes) is a plain zero.
 */
export function formatFeeRaw(raw: bigint | string, decimals: number, locale: Locale): string {
  const value = typeof raw === 'string' ? BigInt(raw) : raw
  if (value <= 0n) return formatNumber(0, locale, 0)
  const unit = 10n ** BigInt(decimals)
  const leadingZeros = value >= unit ? 0 : decimals - value.toString().length
  const places = Math.min(decimals, value >= unit ? 2 : Math.max(2, leadingZeros + 3))
  const step = 10n ** BigInt(decimals - places)
  const up = ((value + step - 1n) / step) * step
  return formatRaw(up, decimals, locale, places)
}

/**
 * What a fee is of the money it is taken from (a buy's amount in, a sale's proceeds before the fee), in basis points
 * rounded up — from the same figures the fee's amount is shown from, so «1.01% · 0.121» reads true on 12 and is never
 * smaller than it is. Null with nothing to take it from.
 */
export function feeShareBps(feeRaw: bigint | string, baseRaw: bigint | string): number | null {
  const fee = typeof feeRaw === 'string' ? BigInt(feeRaw) : feeRaw
  const base = typeof baseRaw === 'string' ? BigInt(baseRaw) : baseRaw
  if (base <= 0n || fee < 0n) return null
  return Number((fee * 10_000n + base - 1n) / base)
}

const percentSign = (locale: Locale) => (locale === 'uk' ? ' %' : '%')

/** «0,46 %» in Ukrainian, «0.46%» in English. */
export function formatPercent(value: number, locale: Locale, digits = 2): string {
  return `${formatNumber(value, locale, digits)}${percentSign(locale)}`
}

export function formatBps(bps: number, locale: Locale): string {
  return formatPercent(bps / 100, locale, 2)
}

export function formatDate(at: number | string, locale: Locale): string {
  return new Intl.DateTimeFormat(tag(locale), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(at))
}

export function formatDuration(seconds: number, locale: Locale): string {
  if (seconds % 60 === 0 && seconds < 3600) return locale === 'uk' ? `${seconds / 60} хв` : `${seconds / 60} min`
  return locale === 'uk' ? `${seconds} с` : `${seconds} s`
}

const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉'

/**
 * A token's price, however small: «0,0₅512» — the zeros after the point
 * counted in a subscript from four of them, three significant digits after
 * them. `plain` is the same number written out, for a screen reader.
 */
export function formatTinyPrice(value: number, locale: Locale): Readonly<{ text: string; plain: string }> {
  // No price read (or none that is a price) is unknown — a dash, never a false zero.
  if (!Number.isFinite(value) || value <= 0) return { text: '—', plain: '—' }
  const sep = locale === 'uk' ? ',' : '.'
  const plain = new Intl.NumberFormat(tag(locale), { maximumSignificantDigits: 4, maximumFractionDigits: 20 }).format(
    value,
  )
  if (value >= 0.0001) return { text: plain, plain }
  const zeros = Math.ceil(-Math.log10(value) - 1e-12) - 1
  const digits =
    Math.round(value * 10 ** (zeros + 3))
      .toString()
      .replace(/0+$/, '') || '0'
  const sub = String(zeros)
    .split('')
    .map((digit) => SUBSCRIPT[Number(digit)])
    .join('')
  return { text: `0${sep}0${sub}${digits}`, plain }
}

const UNITS: readonly Readonly<{ size: number; en: string; uk: string }>[] = [
  { size: 1e12, en: 'T', uk: ' трлн' },
  { size: 1e9, en: 'B', uk: ' млрд' },
  { size: 1e6, en: 'M', uk: ' млн' },
  { size: 1e3, en: 'K', uk: ' тис.' },
]

/** «$12,3 тис.» · «$912» · «$0,42» — or, in a currency that is not a dollar, «12,3 тис. COMM». */
export function formatMoneyShort(value: number, locale: Locale, dollar: boolean, symbol: string): string {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const unit = UNITS.find((entry) => abs >= entry.size) ?? null
  const scaled = unit ? abs / unit.size : abs
  const digits = unit ? (scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2) : abs >= 100 ? 0 : 2
  const text = `${new Intl.NumberFormat(tag(locale), { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(scaled)}${unit ? unit[locale] : ''}`
  const sign = value < 0 ? '−' : ''
  return dollar ? `${sign}$${text}` : `${sign}${text} ${symbol}`
}

/** A count, short: «9 870» · «12,4 тис.». */
export function formatCountShort(value: number, locale: Locale): string {
  if (value < 10_000) return formatNumber(value, locale, 0)
  const unit = UNITS.find((entry) => value >= entry.size) as (typeof UNITS)[number]
  return `${formatNumber(value / unit.size, locale, 1)}${unit[locale]}`
}

/** A signed move in basis points: «+4,2 %» · «−0,8 %». */
export function formatMove(bps: number, locale: Locale): string {
  const pct = Math.abs(bps) / 100
  const digits = pct >= 100 ? 0 : 1
  return `${bps > 0 ? '+' : bps < 0 ? '−' : ''}${formatNumber(pct, locale, digits)}${percentSign(locale)}`
}

/**
 * How far a trade moves the price, unsigned, as `formatMove` writes it («4,2 %»); null when it rounds to nothing —
 * said as «barely moves», never as «moves 0 %».
 */
export function formatMoveSize(bps: number, locale: Locale): string | null {
  if (!Number.isFinite(bps)) return null
  const pct = Math.abs(bps) / 100
  const digits = pct >= 100 ? 0 : 1
  if (Math.round(pct * 10 ** digits) === 0) return null
  return formatMove(Math.abs(bps), locale).replace(/^\+/, '')
}

/** An address as `Abcd…wxyz`. */
export function shortKey(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address
}

/** Where anyone sees a transaction or an account — the phone serves mainnet only, so the network is not asked. */
export function explorerUrl(_network: string, kind: 'tx' | 'account', id: string): string {
  return `https://solscan.io/${kind}/${id}`
}

/** A pair amount the person takes or pays, to the cent: «$174,09» · «361,33 COMM»; a crumb is «< $0,01», never a false zero. */
export function exactPair(
  raw: string | bigint,
  pair: Readonly<{ symbol: string; decimals: number; dollar: boolean }>,
  locale: Locale,
): string {
  const value = Number(fromRaw(raw, pair.decimals, 6))
  const sep = locale === 'uk' ? ',' : '.'
  if (value > 0 && value < 0.01) return pair.dollar ? `< $0${sep}01` : `< 0${sep}01 ${pair.symbol}`
  const text = formatRaw(raw, pair.decimals, locale, 2)
  return pair.dollar ? `$${text}` : `${text} ${pair.symbol}`
}

/** A pair amount short: «$12,4 тис.»; a crumb «< $0,01». */
export function shortPair(
  raw: string | bigint,
  pair: Readonly<{ symbol: string; decimals: number; dollar: boolean }>,
  locale: Locale,
): string {
  const value = Number(fromRaw(raw, pair.decimals, 6))
  // Below a thousand the cents are cut, never rounded up: «earned» never reads more than «to claim» of the same sum.
  if (value < 1000) return exactPair(raw, pair, locale)
  return formatMoneyShort(value, locale, pair.dollar, pair.symbol)
}
