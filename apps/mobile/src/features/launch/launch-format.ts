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

const tag = (locale: Locale) => (locale === 'uk' ? 'uk-UA' : 'en-US')

export function formatNumber(value: number, locale: Locale, digits = 0): string {
  return new Intl.NumberFormat(tag(locale), { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value)
}

/** A raw amount as the person reads it: grouped, at most `digits` after the point. */
export function formatRaw(raw: bigint | string, decimals: number, locale: Locale, digits = 2): string {
  return formatNumber(Number(fromRaw(raw, decimals, Math.max(digits, 0))), locale, digits)
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
  if (!Number.isFinite(value) || value <= 0) return { text: '0', plain: '0' }
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
