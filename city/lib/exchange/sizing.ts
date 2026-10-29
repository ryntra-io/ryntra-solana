import type { FuturesMarket } from '../../../lib/phoenix/market-data.ts';
import { notionalMicroOf } from '../../../lib/phoenix/orders-model.ts';
import { clampLeverage, leverageSteps, unitsOf } from './markets.ts';
import { countTicksOf, SHARES, sizeLotsOf, type Draft } from './ticket.ts';

/**
 * How the ticket's two dials read and move: the leverage on one slider, and the size — chips of the free collateral, a
 * slider of the same share and the dollars in the field — as one figure seen three ways (the card of trade 2, CITY-74).
 * Nothing here is a figure of the city's own: the share is of the engine's most at this leverage (`maxLots`, Phoenix's
 * SDK — the free collateral at the leverage, its fees out), and a share's dollars are the engine's own notional
 * (`notionalMicroOf`) at the price the order is counted at. Pure.
 */

/** The slider's travel: whole steps of a thousand, so a phone's thumb lands where it means to. */
export const SLIDER_STEPS = 1000;

const topOf = (max: number | null): number => (max !== null && max >= 1 ? Math.floor(max) : 1);

/**
 * The leverage at a place on the slider, 0 to 1: on a log scale, so the careful two and three are not crushed against
 * the one when a market allows a hundred; always a whole number within the market's range.
 */
export function leverageAt(at: number, max: number | null): number {
  const top = topOf(max);
  const place = Number.isFinite(at) ? Math.min(1, Math.max(0, at)) : 0;
  return clampLeverage(Math.exp(place * Math.log(top)), max);
}

/** Where a leverage stands on the slider, 0 to 1: the inverse of `leverageAt`. */
export function placeOfLeverage(leverage: number, max: number | null): number {
  const top = topOf(max);
  if (top <= 1) return 0;
  return Math.log(clampLeverage(leverage, max)) / Math.log(top);
}

/** How near two marks under the slider may stand, of its width: a phone's thumb tells them apart. */
export const MARK_GAP = 0.1;

/**
 * The usual steps under the slider, each where it stands on it: a tap on one sets it. A step too near the last one
 * kept is left out, and the market's highest always stays — it takes the place of a step crowding it.
 */
export function leverageMarks(max: number | null): readonly Readonly<{ step: number; at: number }>[] {
  const marks: Array<Readonly<{ step: number; at: number }>> = [];
  const steps = leverageSteps(max);
  steps.forEach((step, index) => {
    const mark = { step, at: placeOfLeverage(step, max) };
    const last = marks.at(-1);
    if (!last || mark.at - last.at >= MARK_GAP) marks.push(mark);
    else if (index === steps.length - 1 && marks.length > 1) marks[marks.length - 1] = mark;
  });
  return marks;
}

export type SizeView = Readonly<{
  /** What the field shows: the dollars typed, or the dollars a share comes to — empty while the most is unknown. */
  text: string;
  /** Where the slider stands, per cent of the most; null while the engine's most is not read. */
  percent: number | null;
  /** The chip that is on: only the share the person picked, never one a typed sum happens to come near. */
  chip: (typeof SHARES)[number] | null;
}>;

/** Micro-dollars as the field takes them back: plain digits and two places, rounded down — never more than it is. */
export function fieldDollars(micro: bigint): string {
  const cents = micro / 10_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

/**
 * The size as the field, the slider and the chips show it, all from the one draft. A typed sum moves the slider to its
 * part of the most; a share — a chip or the slider — writes its dollars into the field.
 */
export function sizeView(draft: Draft, market: FuturesMarket, maxLots: string | null): SizeView {
  const units = unitsOf(market);
  const most = maxLots !== null && /^\d{1,20}$/.test(maxLots) ? BigInt(maxLots) : null;
  const lots = sizeLotsOf(draft, market, maxLots);
  if (draft.size.kind === 'share') {
    const ticks = units ? countTicksOf(draft, market, units) : null;
    const text = units && lots !== null && ticks !== null && ticks > 0n ? fieldDollars(notionalMicroOf(lots, ticks, units)) : '';
    const percent = Math.min(100, Math.max(0, Math.round(draft.size.percent)));
    const chip = (SHARES as readonly number[]).includes(percent) ? (percent as SizeView['chip']) : null;
    return { text, percent, chip };
  }
  // A sum too small for a whole per cent still stands off the start: a size is never shown as none.
  const percent = most === null || most === 0n ? null : lots === null ? 0 : Math.min(100, Math.max(1, Number((lots * 100n) / most)));
  return { text: draft.size.text, percent, chip: null };
}
