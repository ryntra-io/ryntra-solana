import { rangePrices } from '../../../city/lib/earn/pier.ts';
import { digits } from '../../../city/lib/i18n/dict.ts';
import type { Lang } from '../../../city/lib/i18n/langs.ts';
import { pctText, type GapView, type RangeView, type ShapeId } from './model.ts';

/**
 * The facts a person reads before adding to a pool, as rows of names and figures under the range's two
 * prices (the editor's edges stand right above them): its bins and shape, what goes in of each coin and whether a part is swapped first, what the accounts take and give back,
 * Ryntra's fee in and out, and about what the range would have been paid in a day. Each figure is handed in by the
 * ticket from the engine's own; a figure nobody has yet leaves its row out.
 *
 * Pure: words in, rows out.
 */

/** The words the rows are said in (`./words.ts`, one language of it). */
export type FactWords = Readonly<{
  bins: string;
  steps: string;
  about: (text: string) => string;
  binsOf: (count: string) => string;
  stepsOf: (count: string) => string;
  spot: string;
  curve: string;
  bidAsk: string;
  goesIn: string;
  swap: string;
  swapNone: string;
  rateOf: (rate: string, unit: string) => string;
  rent: string;
  rentOf: (pay: string, back: string) => string;
  rentAll: (pay: string) => string;
  ryntra: string;
  feeIn: (pct: string) => string;
  feeInNone: string;
  feeInGuest: string;
  feeOut: string;
  day: string;
  dayOf: (usd: string) => string;
  dayPool: (usd: string) => string;
  gapDear: (pct: string) => string;
  gapCheap: (pct: string) => string;
}>;

export const SHAPE_WORD: Readonly<Record<ShapeId, 'spot' | 'curve' | 'bidAsk'>> = { spot: 'spot', curve: 'curve', bid_ask: 'bidAsk' };

export type FactsInput = Readonly<{
  range: RangeView;
  /** What a step is called on this pool: a DLMM bin, or a step of DLMM Pro's spacing. */
  steps: 'bins' | 'steps';
  shape: ShapeId;
  /** «0.5 SOL + 71.4 USDC», the English way; null — not known yet. */
  goesIn: string | null;
  /** Whether `goesIn` is the Review's own figure; before it, the figure is «about». */
  exact: boolean;
  /** The swap of the part the other coin needs: what goes in, the least it brings, and the rate; 'none' — nothing is swapped. */
  swap: Readonly<{ from: string; to: string; rate: string | null; unit: string }> | 'none' | null;
  /** What the accounts take and what of it comes back, SOL. */
  rent: Readonly<{ pay: string; back: string; all: boolean; exact: boolean }> | null;
  /** Ryntra's fee on the way in: a rate of the swap, null for none; the whole thing null before a Review says. */
  fee: Readonly<{ inPct: string | null }> | null;
  /** «$1.24», the language's own way already, and what it is a share of. */
  day: Readonly<{ usd: string; basis: 'range' | 'pool' }> | null;
}>;

export type FactRow = readonly [name: string, value: string | null];

export function factRows(w: FactWords, lang: Lang, input: FactsInput): FactRow[] {
  const { range } = input;
  const count = input.steps === 'bins' ? w.binsOf(String(range.steps)) : w.stepsOf(String(range.steps));
  const swap = input.swap === null ? null : input.swap === 'none' ? w.swapNone : digits(`${input.swap.from} → ${input.swap.to}${input.swap.rate ? ` · ${w.rateOf(input.swap.rate, input.swap.unit)}` : ''}`, lang);
  const rentSaid = input.rent ? digits(input.rent.all ? w.rentAll(input.rent.pay) : w.rentOf(input.rent.pay, input.rent.back), lang) : null;
  // Before a Review the accounts' cost is the pool's own facts: the wallet's own missing accounts are the Review's to add.
  const rent = rentSaid && input.rent && !input.rent.exact ? w.about(rentSaid) : rentSaid;
  const feeIn = input.fee === null ? w.feeInGuest : input.fee.inPct ? w.feeIn(digits(input.fee.inPct, lang)) : w.feeInNone;
  return [
    [input.steps === 'bins' ? w.bins : w.steps, `${digits(count, lang)} · ${w[SHAPE_WORD[input.shape]]}`],
    [w.goesIn, input.goesIn ? (input.exact ? digits(input.goesIn, lang) : w.about(digits(input.goesIn, lang))) : null],
    [w.swap, swap],
    [w.rent, rent],
    [w.ryntra, `${feeIn} · ${w.feeOut}`],
    [w.day, input.day ? (input.day.basis === 'range' ? w.dayOf(input.day.usd) : w.dayPool(input.day.usd)) : null],
  ];
}

/** The range as one line under the width: «141.06 – 144.95 USDC · 69 bins». */
export function rangeLine(w: Pick<FactWords, 'binsOf' | 'stepsOf'>, lang: Lang, range: RangeView, unit: string, steps: 'bins' | 'steps'): string {
  const prices = rangePrices(range.low, range.high);
  const count = steps === 'bins' ? w.binsOf(String(range.steps)) : w.stepsOf(String(range.steps));
  return digits(`${prices.low} – ${prices.high} ${unit} · ${count}`, lang);
}

/** The one line said when the pool's price stands far from the market's; null when it does not. */
export function gapLine(w: Pick<FactWords, 'gapDear' | 'gapCheap'>, lang: Lang, gap: GapView | null): string | null {
  if (!gap || !gap.far) return null;
  const pct = digits(pctText(gap.pct), lang);
  return gap.dearer ? w.gapDear(pct) : w.gapCheap(pct);
}
