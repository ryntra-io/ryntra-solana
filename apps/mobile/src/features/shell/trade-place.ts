/**
 * «Торгівля» as a value — pure (NEW-LOOK §3): its segments in order. The phone is Solana only: Ринки, Обмін, Ф'ючерси and Прогнози, all in
 * Ryntra on Solana — Ф'ючерси are Phoenix's perpetuals (decision 56, C4); Прогнози the markets on outcomes on AGG, entered
 * with the Solana wallet (decisions 57 and 58, M12). The futures terminal on another network is not a segment of the
 * phone, nor is Predictions a door to another product. Прогнози are drawn only where the build shows them
 * (`PREDICTIONS_LIVE`, the second release); until then «Торгівля» is Ринки · Обмін · Ф'ючерси.
 */

import { askedPlaceChip } from '../markets/screener.ts'
import { PREDICTIONS_LIVE } from './places.ts'
import type { TradeSegment } from '../trade/sheet-copy.ts'

const ALL_TRADE_SEGMENTS: readonly TradeSegment[] = ['markets', 'swap', 'futures', 'predictions']

/** «Торгівля»'s segments in a build that shows Прогнози or not. */
export function tradeSegments(predictions: boolean = PREDICTIONS_LIVE): readonly TradeSegment[] {
  return predictions ? ALL_TRADE_SEGMENTS : ALL_TRADE_SEGMENTS.filter((segment) => segment !== 'predictions')
}

export const TRADE_SEGMENTS: readonly TradeSegment[] = tradeSegments()

/** The segment `?seg=` names; null for anything else, a segment this build does not draw among them. */
export function segmentOf(value: unknown, segments: readonly TradeSegment[] = TRADE_SEGMENTS): TradeSegment | null {
  const one = Array.isArray(value) ? value[0] : value
  return typeof one === 'string' && (segments as readonly string[]).includes(one) ? (one as TradeSegment) : null
}

/**
 * The segment an address opens: the one `?seg=` names, else Ринки when it names a chip of Ринки (`?tab=`, `?kind=`,
 * `?mode=` — Home's «Обране», an older list's link), so a chip asked for is never lost behind Обмін; null for none.
 */
export function tradeSegmentAsked(
  params: Readonly<Record<string, string | readonly string[] | null | undefined>>,
): TradeSegment | null {
  return segmentOf(params.seg) ?? (askedPlaceChip(params) === null ? null : 'markets')
}
