import { dateText, digits, num, type Same } from '../i18n/dict.ts';
import { linePrice, minimumUsd, modeOf, type Facts, type Plan } from './plan.ts';
import type { Entry } from './store.ts';
import type { Instruction } from './types.ts';
import { INSTRUCT } from './words.ts';

/**
 * How the card and the list say an instruction (CITY-176): one headline — what the agent will do, with the amount and
 * how often or at what price — and one line with the fee and the least. Pure: the words of the language on screen are
 * an argument, so English and Ukrainian are read the same way in the tests.
 */

type W = Same<(typeof INSTRUCT)['en']>;

/** The language the words are in: numbers, dates and the decimal mark follow the words, never the moment. */
const langOf = (w: W): 'en' | 'uk' => (w === INSTRUCT.uk ? 'uk' : 'en');

function shareWords(share: number, w: W): string {
  return share === 100 ? w.all : share === 50 ? w.half : w.share(String(share));
}

/** The condition in a few words: «at $0.70», «if it falls 10%», «if it rises to $200». */
function conditionOf(instruction: Extract<Instruction, { kind: 'order' }>, now: number | null, w: W): string {
  const trigger = instruction.trigger;
  if (!trigger) return '';
  const mode = modeOf(instruction, now);
  const falls = (instruction.side === 'buy') === (mode === 'limit');
  if (trigger.kind === 'move') return falls ? w.fallsBy(String(trigger.pct)) : w.risesBy(String(trigger.pct));
  const price = priceWords(trigger.price);
  if (mode === 'stop') return instruction.side === 'sell' ? w.fallsTo(price) : w.risesTo(price);
  return w.atPrice(price);
}

/** What the agent will do, as the card's headline. */
export function headline(instruction: Instruction, facts: Facts | null, w: W): string {
  const symbol = instruction.coin?.symbol ?? '…';
  if (instruction.kind === 'recurring') return digits(w.recurring(instruction.usd ?? '', symbol, instruction.cadence), langOf(w));
  const action =
    instruction.side === 'buy'
      ? w.buyAt(instruction.usd ?? '', symbol)
      : instruction.share !== null
        ? w.sellOf(shareWords(instruction.share, w), symbol)
        : instruction.count
          ? w.sellOf(instruction.count, symbol)
          : w.sellCoin(symbol);
  const condition = conditionOf(instruction, facts?.price ?? null, w);
  return digits(condition ? `${action} ${condition}` : action, langOf(w));
}

/** A price on screen: as the engine takes it, then the language's own decimal mark. */
export const priceWords = (price: number | string, w?: W): string => {
  const value = typeof price === 'number' ? price : Number(price);
  // Four significant digits for the eye; the engine keeps its own six.
  const text = Number.isFinite(value) && value > 0 ? value.toLocaleString('en-US', { maximumSignificantDigits: 4, useGrouping: false }) : String(price);
  return digits(text, w ? langOf(w) : undefined);
};

/** A coin's amount for the eye: up to four decimals, the language's own marks. */
const amountWords = (amount: string, w: W): string => num(Number(amount), { maximumFractionDigits: Number(amount) >= 1 ? 2 : 4 }, langOf(w));

/** The one figure under the headline: when the first purchase comes, or the price now and the line. */
export function subline(instruction: Instruction, facts: Facts | null, plan: Plan | null, w: W): string | null {
  if (instruction.kind === 'recurring') {
    if (!plan || plan.kind !== 'recurring') return null;
    return w.first(dateText(plan.firstAt, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: plan.schedule.timeZone }, langOf(w)));
  }
  const now = facts?.price ?? null;
  if (now === null) return null;
  const line = linePrice(instruction, now);
  return line && instruction.trigger?.kind === 'move' ? `${w.now(priceWords(now, w))} → $${priceWords(line, w)}` : w.now(priceWords(now, w));
}

const pctOf = (bps: number, w: W) => num(bps / 100, { maximumFractionDigits: 2 }, langOf(w));

/**
 * The fee and the least in one line — the engine's own figures: the limit's from the order the engine built when it is
 * on the card, the swap engine's fee policy otherwise. A regular purchase and a stop say who signs each trade.
 */
export function feeLine(instruction: Instruction, facts: Facts | null, review: Readonly<{ ryntraBps: number; venueBps: number }> | null, w: W): string | null {
  const now = facts?.price ?? null;
  const mode = instruction.kind === 'order' ? modeOf(instruction, now) : null;
  const bps = mode === 'limit' && review ? review.ryntraBps + review.venueBps : (facts?.feeBps ?? null);
  if (bps === null) return null;
  const least = minimumUsd(instruction.kind === 'order' ? { ...instruction, mode } : instruction);
  if (instruction.kind === 'recurring') return [w.feeEach(pctOf(bps, w)), w.min(String(least)), w.tailEach].join(' · ');
  if (mode === 'stop') return [w.feeSale(pctOf(bps, w)), w.tailStop].join(' · ');
  return [w.fee(pctOf(bps, w)), least !== null ? w.min(String(least)) : null].filter(Boolean).join(' · ');
}

/** How it runs, behind «Details». */
export function howLine(instruction: Instruction, facts: Facts | null, w: W): string {
  if (instruction.kind === 'recurring') return w.howRecurring(instruction.cadence ?? 'weekly');
  return modeOf(instruction, facts?.price ?? null) === 'stop' ? w.howStop : w.howLimit;
}

/** A line of «My instructions»: what was set, short. */
export function entryHeadline(entry: Entry, w: W): string {
  if (entry.kind === 'recurring') return digits(w.rowRecurring(entry.amount, entry.coin.symbol, entry.cadence ?? 'weekly'), langOf(w));
  const price = priceWords(entry.price ?? '', w);
  const usd = digits(entry.amount, langOf(w));
  const coins = amountWords(entry.amount, w);
  if (entry.kind === 'stop') return entry.side === 'buy' ? w.rowBuyAbove(usd, entry.coin.symbol, price) : w.rowSellBelow(coins, entry.coin.symbol, price);
  return entry.side === 'buy' ? w.rowBuy(usd, entry.coin.symbol, price) : w.rowSell(coins, entry.coin.symbol, price);
}
