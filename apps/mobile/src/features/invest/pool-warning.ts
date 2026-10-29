import type { Locale } from '../../lib/i18n.ts'
import { dollarsText } from './buy-model.ts'

/**
 * A stock token's pool that cannot stand for the share (ST-5 r7: SGOVx at $2 090 a token against a $100,59 share, $0,2
 * in its pool): the page says so in plain words at its head and again right over «Купити», and the purchase's sheet over
 * its own action. Two facts, each the page's own read — never a guess:
 *
 * - **far** — the price against the issuer's reference for the share, beyond `POOL_FAR_PCT` either way. The freshest
 *   figure says it (ST-5 r8): a live quote's price for a share — the purchase's own estimate, or the quote for an
 *   amount — wins over the pool's listed price, which may be minutes old; with no live figure, the pool's own
 *   deviation, the list basis the row states. Said only where a reference stands: with no reference, no claim.
 * - **empty** — the pool's liquidity, as the venue states it, under `POOL_EMPTY_USD`: a fact of the pool, said even
 *   when a live quote finds the price near the share.
 */
export const POOL_FAR_PCT = 10
export const POOL_EMPTY_USD = 1_000

/** How long a live quote may judge the warning: past it the pool's own listed price speaks again (ST-5 r9). */
export const LIVE_FRESH_MS = 5 * 60_000
/** The live figures a page keeps, one per sum — the newest few. */
const LIVE_KEPT = 8

/**
 * Which engine priced a live figure (ST-5 r10): `swap` — the swap quote the purchase sheet buys through
 * (`/api/solana/swap/quote`), `stock-quote` — the quote card under «Деталі» (`/api/stocks/quote`). The two may route a
 * thin pool differently, so only the purchase's own engine judges the warning over a purchase.
 */
export type LiveSource = 'swap' | 'stock-quote'

/** The engine whose figures judge the pool warning over «Купити» and on the purchase sheet: the one it buys through. */
export const BUY_ENGINE: LiveSource = 'swap'

/**
 * A live quote's price for one share, the sum it was quoted for in dollars, when it was quoted (ms), and its engine —
 * a figure with no engine named never judges the purchase's warning (`liveAt`, `fairFromOf`).
 */
export type LiveShareQuote = Readonly<{ perShare: number; usd: number; at: number; source?: LiveSource }>

export type PoolWarning = Readonly<{
  /** The price against the share's reference, per cent; null when it is near or no reference stands. */
  farPct: number | null
  /** The sum the live quote that says the distance was asked for; null when the pool's own price says it. */
  liveUsd: number | null
  empty: boolean
  /**
   * A larger sum a live quote actually priced near the share, and when (ST-5 r9: SGOVx — $10 at +47 674 %, $1 000 at
   * $100,81): said beside a far price only where such a quote was seen; null otherwise — the threshold is never guessed.
   */
  fairFrom: Readonly<{ usd: number; at: number }> | null
}>

const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value)

/** How far a price for one share stands from the reference, per cent; null without either. */
export function deviationOf(perShare: number | null | undefined, referencePerShare: number | null | undefined): number | null {
  if (!finite(perShare) || perShare <= 0 || !finite(referencePerShare) || referencePerShare <= 0) return null
  return (perShare / referencePerShare - 1) * 100
}

export function poolWarningOf(
  input: Readonly<{
    deviationPct: number | null | undefined
    referencePerShare: number | null | undefined
    liquidityUsd: number | null | undefined
    /**
     * The freshest live quote for the share **at the sum about to be bought** — it wins over the pool's own price
     * (ST-5 r8). A quote for another sum never stands in for it (ST-5 r9): pick it with `liveAt`.
     */
    live?: LiveShareQuote | null
    /** A larger sum priced near the share (`fairFromOf`), said beside a far price; null for none. */
    fairFrom?: LiveShareQuote | null
  }>,
): PoolWarning | null {
  const referenced = finite(input.referencePerShare) && input.referencePerShare > 0
  const live = input.live && finite(input.live.usd) ? input.live : null
  const liveDeviation = live ? deviationOf(live.perShare, input.referencePerShare) : null
  const deviation = liveDeviation ?? input.deviationPct
  const farPct = referenced && finite(deviation) && Math.abs(deviation) > POOL_FAR_PCT ? deviation : null
  const empty = finite(input.liquidityUsd) && input.liquidityUsd >= 0 && input.liquidityUsd < POOL_EMPTY_USD
  if (farPct === null && !empty) return null
  const fair = farPct !== null && input.fairFrom && finite(input.fairFrom.usd) ? input.fairFrom : null
  return {
    farPct,
    liveUsd: farPct !== null && liveDeviation !== null && live ? live.usd : null,
    empty,
    fairFrom: fair ? { usd: fair.usd, at: fair.at } : null,
  }
}

/** Two sums in dollars are one sum to the cent. */
export function sameSum(a: number | null | undefined, b: number | null | undefined): boolean {
  return finite(a) && finite(b) && Math.round(a * 100) === Math.round(b * 100)
}

/** A figure that may judge the purchase's warning: the purchase's own engine, fresh, every figure finite. */
const freshAt = (quote: LiveShareQuote, nowMs: number): boolean =>
  quote.source === BUY_ENGINE &&
  finite(quote.at) &&
  nowMs - quote.at <= LIVE_FRESH_MS &&
  finite(quote.perShare) &&
  finite(quote.usd)

/** The live figures kept with a new one heard: one per engine and sum, the newest, a few at most. */
export function heardLive(held: readonly LiveShareQuote[], next: LiveShareQuote): readonly LiveShareQuote[] {
  const sameKey = (quote: LiveShareQuote) => quote.source === next.source && sameSum(quote.usd, next.usd)
  const same = held.find(sameKey)
  if (same && same.perShare === next.perShare && same.at >= next.at) return held
  return [next, ...held.filter((quote) => !sameKey(quote))].slice(0, LIVE_KEPT)
}

/**
 * The fresh live figure for exactly this sum from the purchase's own engine — the newest — or null: a quote for
 * another sum, or from the quote card's engine (ST-5 r10), never judges this one.
 */
export function liveAt(seen: readonly LiveShareQuote[], usd: number | null | undefined, nowMs: number): LiveShareQuote | null {
  let best: LiveShareQuote | null = null
  for (const quote of seen)
    if (sameSum(quote.usd, usd) && freshAt(quote, nowMs) && (best === null || quote.at > best.at)) best = quote
  return best
}

/**
 * The smallest larger sum a fresh live quote priced near the share, with no larger sum seen far — or null. Only what
 * was quoted, and only through the engine the purchase buys through (ST-5 r10: the quote card's fair $1 000 said
 * «Від $1 000 ціна близька до акції» while the purchase at $1 000 was priced far): never a guess, never another engine.
 */
export function fairFromOf(
  seen: readonly LiveShareQuote[],
  usd: number | null | undefined,
  referencePerShare: number | null | undefined,
  nowMs: number,
): LiveShareQuote | null {
  if (!finite(usd) || !finite(referencePerShare) || referencePerShare <= 0) return null
  const larger = seen
    .filter((quote) => freshAt(quote, nowMs) && quote.usd > usd && !sameSum(quote.usd, usd))
    .map((quote) => ({ quote, deviation: deviationOf(quote.perShare, referencePerShare) }))
    .filter((row): row is { quote: LiveShareQuote; deviation: number } => row.deviation !== null)
    .sort((a, b) => a.quote.usd - b.quote.usd)
  for (let index = 0; index < larger.length; index += 1) {
    const row = larger[index]
    if (Math.abs(row.deviation) > POOL_FAR_PCT) continue
    if (larger.slice(index + 1).some((later) => Math.abs(later.deviation) > POOL_FAR_PCT)) continue
    return row.quote
  }
  return null
}

/** Whether a quote's own figure for the share stands far from the reference — its price impact is then no cost to read. */
export function quoteFar(deviationPct: number | null | undefined, referencePerShare: number | null | undefined): boolean {
  return (
    finite(referencePerShare) && referencePerShare > 0 && finite(deviationPct) && Math.abs(deviationPct) > POOL_FAR_PCT
  )
}

/** What one paid for a share in a purchase's estimate: the dollars spent over the shares that arrive; null without both. */
export function perSharePaid(spendUsd: number | null | undefined, shares: number | null | undefined): number | null {
  if (!finite(spendUsd) || spendUsd <= 0 || !finite(shares) || shares <= 0) return null
  return spendUsd / shares
}

/** What the shares a purchase brings are worth at the share's reference, in dollars; null without either. */
export function shareWorthUsd(shares: number | null | undefined, referencePerShare: number | null | undefined): number | null {
  if (!finite(shares) || shares < 0 || !finite(referencePerShare) || referencePerShare <= 0) return null
  return shares * referencePerShare
}

/** «1 978%» · «1,978%» — the distance in whole per cent, unsigned: the words say which way. */
export function farPctText(pct: number, locale: Locale): string {
  return `${new Intl.NumberFormat(locale === 'uk' ? 'uk-UA' : 'en-US', { maximumFractionDigits: 0 }).format(Math.abs(pct))}%`
}

/** The warning's one line, in the person's language. */
export function poolWarningText(
  warning: PoolWarning,
  locale: Locale,
  words: Readonly<{
    poolFar: (pct: string, above: boolean, empty: boolean) => string
    sumFar: (sum: string, pct: string, above: boolean, empty: boolean) => string
    poolEmpty: string
    fairFrom: (sum: string, time: string) => string
  }>,
  /** The clock a seen quote's time is said in («11:56»); without it the larger fair sum is not said. */
  clockOf?: (ms: number) => string,
): string {
  if (warning.farPct === null) return words.poolEmpty
  const pct = farPctText(warning.farPct, locale)
  const line =
    warning.liveUsd !== null
      ? words.sumFar(dollarsText(warning.liveUsd, locale), pct, warning.farPct > 0, warning.empty)
      : words.poolFar(pct, warning.farPct > 0, warning.empty)
  return warning.fairFrom && clockOf
    ? `${line}. ${words.fairFrom(dollarsText(warning.fairFrom.usd, locale), clockOf(warning.fairFrom.at))}`
    : line
}
