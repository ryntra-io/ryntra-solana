/**
 * What a Phoenix order's Review and receipt say, from the server's answers alone — pure, so a test reads the same lines
 * the sheet draws (C4b; the web's `OrderReviewView` and `OrderReceipt` of B6b). The Review is the transaction the
 * server built and simulated: Phoenix's own view of the account after it (leverage, liquidation, collateral), the fees
 * by Phoenix's schedule and Ryntra's builder rate as the chain holds it, the funding. The receipt is Phoenix's record of
 * what the signature filled; the Review's figures never stand in for a fill. A figure the server did not send is a dash.
 */

import type { Locale } from '../../lib/i18n.ts'
import { DASH, formatAmount, formatPrice } from '../../utils/format.ts'

import type { OrderCopy } from './order-copy.ts'
import {
  fillsSummary,
  liquidationDistancePercent,
  STOP_SLIPPAGE_BPS,
  tradesNow,
  type OrderResult,
  type OrderReview,
  type PerpSide,
} from './orders-model.ts'

export type ViewRow = Readonly<{ label: string; value: string; tone?: 'danger' | 'warning' }>

const percentMark = (locale: Locale) => (locale === 'uk' ? ' %' : '%')

/** A share in per cent with up to `digits` decimals: «0,035 %», never rounded to «0,04 %». */
export const shareText = (percent: number, locale: Locale, digits = 4) =>
  `${formatAmount(percent, digits, locale)}${percentMark(locale)}`

/** A fee rate (a fraction of the notional) as an exact share: 0.00035 is «0.035%». */
const rateText = (rate: number | null, locale: Locale) => (rate === null ? DASH : shareText(rate * 100, locale))

/** USDC as an amount of money in the language's shape, two to six decimals: «12.5» is «12.50». */
export const usdcText = (value: number | null, locale: Locale) =>
  value === null ? DASH : formatAmount(value, 6, locale, 2)

/** Lamports as SOL, up to nine decimals. */
export const solText = (lamports: bigint, locale: Locale) => `${formatAmount(Number(lamports) / 1e9, 9, locale)} SOL`

/** A size Phoenix states as an exact decimal, in the reader's shape. */
export const sizeText = (decimal: string, locale: Locale) => formatAmount(Math.abs(Number(decimal)), 8, locale)

export type ReviewView = Readonly<{
  title: string
  pay: string
  get: string
  rows: readonly ViewRow[]
  costs: readonly ViewRow[]
  total: string
  what: string
}>

/** Is the Review a close — a cut that leaves nothing of the position? */
export const closes = (review: OrderReview) =>
  review.kind === 'reduce' && review.after !== null && Number(review.after.positionUnits) === 0

export function reviewView(review: OrderReview, words: OrderCopy, locale: Locale): ReviewView {
  const coin = review.symbol
  const side = review.side
  const size = sizeText(review.sizeUnits, locale)
  const price = (value: number | null) => formatPrice(value, locale)
  const after = review.after
  const close = closes(review)
  const type = review.type === 'limit' ? words.limit.toLowerCase() : words.market.toLowerCase()
  const title =
    review.kind === 'open'
      ? words.titles.open(side, size, coin, type)
      : review.kind === 'reduce'
        ? close
          ? words.titles.close(side, size, coin)
          : words.titles.reduce(side, size, coin)
        : review.kind === 'protect'
          ? words.titles.protect(side, coin)
          : words.titles.cancel(coin)

  const marginUsed =
    after?.initialMarginUsd != null && review.before?.initialMarginUsd != null
      ? after.initialMarginUsd - review.before.initialMarginUsd
      : null
  const pay =
    review.kind === 'open'
      ? words.payMargin(usdcText(marginUsed === null ? null : Math.max(0, marginUsed), locale))
      : review.kind === 'reduce'
        ? words.payPosition(side, size, coin)
        : words.payNone
  const get =
    review.kind === 'open'
      ? words.getPosition(
          side,
          size,
          coin,
          review.notionalUsd === null ? DASH : formatAmount(review.notionalUsd, 2, locale, 2),
        )
      : review.kind === 'reduce'
        ? (after?.collateralChangeUsd ?? 0) < 0
          ? words.getCollateralOut(usdcText(Math.abs(after!.collateralChangeUsd!), locale))
          : words.getCollateral(usdcText(after?.collateralChangeUsd ?? null, locale))
        : review.kind === 'protect'
          ? review.tpUsd === null && review.slUsd === null
            ? words.getLift
            : words.getLegs
          : words.getCancel

  const rows: ViewRow[] = []
  if (review.kind === 'open' || review.kind === 'reduce') {
    rows.push({ label: words.rows.type, value: review.type === 'limit' ? words.limit : words.market })
    rows.push({ label: review.type === 'limit' ? words.rows.limit : words.rows.worst, value: price(review.priceUsd) })
    if (review.slippageBps !== null)
      rows.push({ label: words.rows.slippage, value: shareText(review.slippageBps / 100, locale, 2) })
  }
  if (review.kind === 'cancel' && review.order) {
    const orderSide: PerpSide = review.order.side === 'buy' ? 'long' : 'short'
    rows.push({
      label: words.rows.order,
      value: `${orderSide === 'long' ? words.long : words.short} ${review.order.sizeUnits === null ? DASH : sizeText(review.order.sizeUnits, locale)} ${coin} · ${price(review.order.priceUsd)}`,
    })
  }
  rows.push({ label: words.rows.mark, value: price(review.markUsd) })
  if (after) {
    const units = Number(after.positionUnits)
    const flat = units === 0
    rows.push({
      label: words.rows.positionAfter,
      value: flat
        ? `0 ${coin}`
        : `${units > 0 ? words.long : words.short} ${sizeText(after.positionUnits, locale)} ${coin}`,
    })
    const leverage = after.leverage
    rows.push({
      label: words.rows.leverageAfter,
      value: leverage === null ? DASH : `${formatAmount(leverage, 2, locale)}×`,
      ...(leverage !== null && leverage >= 5 ? { tone: 'warning' as const } : {}),
    })
    const away =
      after.liquidationUsd !== null
        ? liquidationDistancePercent(units >= 0 ? 'long' : 'short', review.markUsd, after.liquidationUsd)
        : null
    rows.push({
      label: words.rows.liquidation,
      value: flat
        ? words.noLiquidation
        : after.liquidationUsd === null
          ? words.liquidationNone
          : `${review.before?.liquidationUsd != null ? `${price(review.before.liquidationUsd)} → ` : ''}${price(after.liquidationUsd)}${away === null ? '' : ` · ${words.liquidationAway(shareText(away, locale, 1))}`}`,
      ...(away !== null && away < 10 ? { tone: 'danger' as const } : {}),
    })
    rows.push({ label: words.rows.collateralAfter, value: `${usdcText(after.collateralUsd, locale)} USDC` })
    rows.push({ label: words.rows.freeAfter, value: `${usdcText(after.freeCollateralUsd, locale)} USDC` })
  }
  if (review.funding) {
    const rate = `${review.funding.ratePercent >= 0 ? '+' : '−'}${shareText(Math.abs(review.funding.ratePercent), locale)}`
    rows.push({
      label: words.rows.funding,
      value:
        review.funding.payer === 'long'
          ? words.fundingLongs(rate)
          : review.funding.payer === 'short'
            ? words.fundingShorts(rate)
            : rate,
    })
  }
  if (review.tpUsd !== null) rows.push({ label: words.rows.tp, value: price(review.tpUsd) })
  if (review.slUsd !== null) rows.push({ label: words.rows.sl, value: price(review.slUsd) })
  if (review.clearsLegs) rows.push({ label: words.rows.legsLifted, value: words.legsLiftedValue })

  const fees = review.fees
  const limitOpen = review.kind === 'open' && review.type === 'limit'
  /* An order that takes liquidity and whose fee Phoenix's schedule did not give is a dash, never «0». */
  const taker = review.kind === 'open' || review.kind === 'reduce'
  const venueUnknown = !limitOpen && taker && fees.venueUsd === null
  const phoenix = limitOpen
    ? words.costLimit(rateText(fees.makerRate, locale), rateText(fees.takerRate, locale))
    : venueUnknown
      ? DASH
      : fees.venueUsd !== null && fees.venueUsd > 0
        ? words.costTaker(usdcText(fees.venueUsd, locale), rateText(fees.takerRate, locale))
        : words.costNone
  const builderRate = shareText(fees.builderBps / 100, locale)
  const ryntra = !taker
    ? words.costNone
    : fees.builderBps > 0 && fees.builderUsd === null
      ? words.costBuilderLimit(builderRate)
      : fees.builderBps > 0 && fees.builderUsd !== null && fees.builderUsd > 0
        ? words.costTaker(usdcText(fees.builderUsd, locale), builderRate)
        : words.costNone
  const costs: ViewRow[] = [
    { label: words.costPhoenix, value: phoenix },
    { label: words.costRyntra, value: ryntra },
    { label: words.costNetwork, value: solText(review.networkFeeLamports, locale) },
    ...(review.rentLamports > 0n ? [{ label: words.costRent, value: solText(review.rentLamports, locale) }] : []),
  ]
  /* A limit's fees depend on how it fills: its total is the network's alone, its rates stand on their lines. */
  const usdc = limitOpen ? 0 : (fees.venueUsd ?? 0) + (fees.builderUsd ?? 0)
  const sol = solText(review.networkFeeLamports + review.rentLamports, locale)
  const total = words.costsTotal(venueUnknown ? DASH : usdc > 0 ? usdcText(usdc, locale) : '', sol)
  const worst = price(review.priceUsd)
  const what =
    review.kind === 'open'
      ? review.type === 'limit'
        ? words.what.openLimit(worst)
        : words.what.openMarket(worst)
      : review.kind === 'reduce'
        ? close
          ? words.what.close(worst)
          : words.what.reduce(worst)
        : review.kind === 'protect'
          ? words.what.protect
          : words.what.cancel
  return { title, pay, get, rows, costs, total, what }
}

/** The stop's slippage as the Review says it beside a stop loss. */
export const stopSlipText = (words: OrderCopy, locale: Locale) =>
  words.stopSlip(shareText(STOP_SLIPPAGE_BPS / 100, locale, 0))

export type ReceiptView = Readonly<{
  status: 'done' | 'pending' | 'failed'
  title: string
  /** The fill as Phoenix recorded it — the big line; null while there is none to say. */
  fill: string | null
  /** The fee, the realised result or the size now held. */
  line: string | null
  note: string | null
}>

export function receiptView(
  review: OrderReview,
  result: OrderResult,
  words: OrderCopy,
  locale: Locale,
  following = true,
): ReceiptView {
  const status = result.state === 'LANDED' ? 'done' : result.state === 'UNKNOWN' ? 'pending' : 'failed'
  const coin = review.symbol
  const trades = tradesNow(review)
  const summary = result.fills ? fillsSummary(result.fills) : null
  const filled = summary !== null && summary.sizeUnits > 0
  const title =
    status === 'pending'
      ? words.receipt.pending
      : status === 'failed'
        ? words.receipt.failed
        : review.kind === 'open'
          ? review.type === 'limit' && !filled
            ? words.receipt.resting
            : words.receipt.filled
          : review.kind === 'reduce'
            ? closes(review)
              ? words.receipt.closed
              : words.receipt.reduced
            : review.kind === 'protect'
              ? review.tpUsd === null && review.slUsd === null
                ? words.receipt.lift
                : words.receipt.protect
              : words.receipt.cancel
  if (status !== 'done') {
    return {
      status,
      title,
      fill: null,
      line: null,
      note:
        status === 'pending'
          ? following
            ? words.pendingLine
            : words.pendingStopped
          : result.state === 'NOT_SENT'
            ? words.notSent
            : words.nothingMoved,
    }
  }
  /* A cut fills on the other side of the position: a long is cut by selling. */
  const filledSide: PerpSide = review.kind === 'reduce' ? (review.side === 'long' ? 'short' : 'long') : review.side
  const fill = filled
    ? words.fill(
        filledSide,
        formatAmount(summary!.sizeUnits, 8, locale),
        coin,
        formatPrice(summary!.averageUsd, locale),
      )
    : null
  const fee = summary?.feeUsd != null ? words.fees(usdcText(summary.feeUsd, locale)) : null
  const pnl =
    review.kind === 'reduce' && summary?.realizedPnlUsd != null
      ? words.pnl(`${summary.realizedPnlUsd >= 0 ? '+' : '−'}${usdcText(Math.abs(summary.realizedPnlUsd), locale)}`)
      : null
  const held = review.kind === 'open' && filled ? words.held(formatAmount(summary!.sizeUnits, 8, locale), coin) : null
  const line = [pnl ?? held, fee].filter((part): part is string => part !== null).join(' · ') || null
  const note = filled ? null : trades ? words.fillPending : review.kind === 'open' ? words.noFill : null
  return { status, title, fill, line, note }
}
