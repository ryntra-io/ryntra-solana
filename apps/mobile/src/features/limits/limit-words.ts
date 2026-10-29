/**
 * How a limit's figures are written: a price in its quote token (not in
 * dollars — a SOL-priced limit is SOL per token) to six significant digits,
 * the way it is typed, and SOL for the network's fee and the rent. In the
 * person's language: «0,0001234» · «0.0001234». Pure.
 */

import type { Locale } from '../../lib/i18n.ts'
import { formatPrice } from '../../utils/format.ts'

const TAG: Readonly<Record<Locale, string>> = { en: 'en-US', uk: 'uk-UA' }

const significant: Readonly<Record<Locale, Intl.NumberFormat>> = {
  en: new Intl.NumberFormat(TAG.en, { maximumSignificantDigits: 6 }),
  uk: new Intl.NumberFormat(TAG.uk, { maximumSignificantDigits: 6 }),
}

const whole: Readonly<Record<Locale, Intl.NumberFormat>> = {
  en: new Intl.NumberFormat(TAG.en, { maximumFractionDigits: 0 }),
  uk: new Intl.NumberFormat(TAG.uk, { maximumFractionDigits: 0 }),
}

/** A price in its quote, six significant digits; a dash when unknown. */
export function quotePrice(value: number | null | undefined, locale: Locale): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—'
  return significant[locale].format(value)
}

/**
 * The market's price beside «Ринок» (ST-5), in the app's own price shape (`formatPrice`): a dollar quote as the page's
 * head says it — «$0,0₅295» — any other quote the same figure in its own token, «0,0₇195 SOL»; never eleven places.
 * A dash when unknown. Display only: the price the button types stays the market's own (`typedPrice`).
 */
export function marketPriceText(
  value: number | null | undefined,
  quote: Readonly<{ symbol: string; dollar: boolean }>,
  locale: Locale,
): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—'
  const shaped = formatPrice(value, locale)
  return quote.dollar ? shaped : `${shaped.replace('$', '')} ${quote.symbol}`
}

/**
 * A token amount an estimate says (ST-5): whole tokens from 1 000 up — «1 724 375», never «1 724 375,775969» of a meme —
 * and six significant digits below it; cut, never rounded up, so an estimate never says more than it is. A dash when
 * unknown. Display only: the amount typed and sent stays as it is.
 */
export function estimateAmount(value: number | null | undefined, locale: Locale): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—'
  if (value >= 1000) return whole[locale].format(Math.floor(value))
  if (value === 0) return whole[locale].format(0)
  const places = Math.max(0, 6 - (Math.floor(Math.log10(value)) + 1))
  const scale = 10 ** places
  // A hair over the float's own error, so 0.29 × 100 is 29, never 28.999….
  const cut = Math.floor(value * scale * (1 + 1e-12)) / scale
  return new Intl.NumberFormat(TAG[locale], { maximumFractionDigits: places }).format(cut)
}

/** Lamports as SOL, up to six places. */
export function solAmount(lamports: number, locale: Locale): string {
  return `${new Intl.NumberFormat(TAG[locale], { maximumFractionDigits: 6 }).format(lamports / 1e9)} SOL`
}
