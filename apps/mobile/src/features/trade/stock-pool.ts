import { USDC_MINT, USDT_MINT, type StockAsset } from '../../lib/api.ts'
import { unitsFromRaw } from '../invest/buy-model.ts'
import {
  deviationOf,
  perSharePaid,
  POOL_FAR_PCT,
  poolWarningOf,
  shareWorthUsd,
  type LiveShareQuote,
  type PoolWarning,
} from '../invest/pool-warning.ts'

/**
 * A stock token's pool in Trade's own ticket (ST-5 r9: SGOVx — «Ринок $2 090,70» a token against a $100,59 share, the
 * limit pre-filled at «2069,79 USDC, −1 % від ринку» and no word of it). The facts are the stock's own read — the
 * issuer's reference for the share, the pool's deviation and liquidity, the shares a token stands for — the same the
 * asset page reads; nothing is guessed, a missing fact is no claim. Display only: what is signed is never touched.
 */

/** The stock's facts the ticket judges its pool on; any of them null where the read does not state it. */
export type StockPoolFacts = Readonly<{
  referencePerShare: number | null
  /** The pool's own price against the reference, per cent, as the issuer's row states it. */
  deviationPct: number | null
  liquidityUsd: number | null
  /** How many shares one token stands for — the mint's multiplier; null where the read does not give it. */
  sharesPerToken: number | null
}>

const positive = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/** The ticket's warning: the asset page's own judgement, on the ticket's live quote for its sum where it has one. */
export function ticketPoolWarning(facts: StockPoolFacts | null, live: LiveShareQuote | null = null): PoolWarning | null {
  if (!facts) return null
  return poolWarningOf({
    deviationPct: facts.deviationPct,
    referencePerShare: facts.referencePerShare,
    liquidityUsd: facts.liquidityUsd,
    live,
  })
}

/**
 * What the market ticket's own estimate paid (or got) for one share — the dollars over the shares the tokens stand
 * for — with the sum and the estimate's time; null without any of them (no multiplier, no dollars, no time).
 */
export function ticketLiveShare(
  input: Readonly<{
    usd: number | null
    /** The stock token's raw units in the estimate — received on a purchase, given on a sale. */
    tokenRaw: string | null
    decimals: number | null
    sharesPerToken: number | null
    /** When the phone received the estimate (ms). */
    at: number | null
  }>,
): LiveShareQuote | null {
  if (!positive(input.sharesPerToken) || !positive(input.usd) || !positive(input.at)) return null
  const shares = unitsFromRaw(input.tokenRaw, input.decimals, input.sharesPerToken)
  const perShare = perSharePaid(input.usd, shares)
  return perShare === null ? null : { perShare, usd: input.usd, at: input.at }
}

/**
 * How many shares one token stands for, as the asset page says it («1 SGOVx = 1,014694 SGOV»): the chain's multiplier,
 * else the issuer row's, else the issuer's own, else the mint's Scaled UI figure, else the wallet's read of it — the
 * first one stated. Null while none is (never a guessed 1).
 */
export function sharesPerTokenOf(read: StockAsset | null | undefined, heldMultiplier: number | null = null): number | null {
  const onchain = read?.onchain && 'scaledUi' in read.onchain ? read.onchain.scaledUi?.multiplier : null
  const candidates = [
    read?.chainMultiplier?.current,
    read?.row.multiplier?.current,
    read?.issuerMultiplier?.current,
    onchain,
    heldMultiplier,
  ]
  return candidates.find(positive) ?? null
}

const DOLLAR_MINTS: ReadonlySet<string> = new Set([USDC_MINT, USDT_MINT])

/**
 * The dollars of the leg of an estimate that is not the stock token: the estimate's own figure for it; else, for a
 * dollar token, its own units; else its units at its market price. Null without any. Display only.
 */
export function otherLegUsd(
  leg: Readonly<{ mint: string; raw: string | null; decimals: number | null; quotedUsd: string | number | null; price: number | null }>,
): number | null {
  const quoted = leg.quotedUsd === null ? Number.NaN : Number(leg.quotedUsd)
  if (positive(quoted)) return quoted
  const units = unitsFromRaw(leg.raw, leg.decimals, 1)
  if (!positive(units)) return null
  if (DOLLAR_MINTS.has(leg.mint)) return units
  return positive(leg.price) ? units * leg.price : null
}

/**
 * What an estimate paid (or got) for one share — the ticket's Market and the swap's stock leg alike (ST-5 r10: SGOVx,
 * $10 — the line said «≈ 0,00020509 SGOVx» while the warning still read the pool's listed +1 978 %): the other leg's
 * dollars over the shares the stock leg stands for, with the estimate's time. Null without any of them.
 */
export function quoteLiveShare(
  input: Readonly<{
    other: Parameters<typeof otherLegUsd>[0]
    stock: Readonly<{ raw: string | null; decimals: number | null }>
    sharesPerToken: number | null
    at: number | null
  }>,
): LiveShareQuote | null {
  return ticketLiveShare({
    usd: otherLegUsd(input.other),
    tokenRaw: input.stock.raw,
    decimals: input.stock.decimals,
    sharesPerToken: input.sharesPerToken,
    at: input.at,
  })
}

/**
 * A stock token's dollars at the share's reference — the tokens × the shares each stands for × the reference — for a
 * pool far from the share (ST-5 r10: 1,5 SOL → 0,00020892 SGOVx read «≈ $0,44» at the pool's $2 090 a token; at the
 * share ≈ $0,02). Null without the reference or the multiplier: the figure is then a dash, never the pool's.
 */
export function stockLegUsd(
  raw: string | null,
  decimals: number | null,
  facts: Pick<StockPoolFacts, 'referencePerShare' | 'sharesPerToken'> | null,
): number | null {
  if (!facts || !positive(facts.referencePerShare) || !positive(facts.sharesPerToken)) return null
  return shareWorthUsd(unitsFromRaw(raw, decimals, facts.sharesPerToken), facts.referencePerShare)
}

/**
 * The issuer's reference for one token in the limit's quote: the reference per share × the shares one token stands
 * for, over the quote's dollar price — the market's figure for it, or a dollar token's own dollar. Null without any.
 */
export function referencePerToken(
  input: Readonly<{
    referencePerShare: number | null
    sharesPerToken: number | null
    /** The quote's price in dollars, as the limit's market read states it. */
    quoteUsd: number | null
    /** The quote is a dollar token (USDC, USDT): its own dollar when the read states no price for it. */
    dollarQuote: boolean
  }>,
): number | null {
  if (!positive(input.referencePerShare) || !positive(input.sharesPerToken)) return null
  const quoteUsd = positive(input.quoteUsd) ? input.quoteUsd : input.dollarQuote ? 1 : null
  if (quoteUsd === null) return null
  const value = (input.referencePerShare * input.sharesPerToken) / quoteUsd
  return Number.isFinite(value) && value > 0 ? value : null
}

/** What the limit's −1 · −2 · −5 % (a sale's +) stand on: the market's price, the share's reference, or nothing. */
export type LimitBase = Readonly<{ price: number; basis: 'market' | 'reference' }> | null

/**
 * Where a pool cannot stand for the share — far from it or nearly empty — the presets never stand on its price: on
 * the issuer's reference for the token where the read gives it, otherwise on nothing (the price is left empty beside
 * the warning). While the stock's read is still coming, nothing is pre-filled either.
 */
export function limitBase(
  input: Readonly<{ marketPrice: number | null; warned: boolean; pending: boolean; referencePerToken: number | null }>,
): LimitBase {
  if (input.pending) return null
  if (input.warned) return positive(input.referencePerToken) ? { price: input.referencePerToken, basis: 'reference' } : null
  return positive(input.marketPrice) ? { price: input.marketPrice, basis: 'market' } : null
}

/** How far a typed limit price stands from the share's reference for the token, per cent; null without either. */
export function shareDistance(price: number, referencePerToken: number | null): number | null {
  return deviationOf(price, referencePerToken)
}

/** Far enough from the share to say so beside the price (the pool warning's own bound). */
export function shareFar(distance: number | null): boolean {
  return distance !== null && Math.abs(distance) > POOL_FAR_PCT
}
