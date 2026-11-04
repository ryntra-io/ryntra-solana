import { bandOf, levelsOf, smartParts, type BotDraft, type ExitPolicy } from './draft.ts';
import { timeLegBuyUsd } from '../../../lib/bots/ladder/smart.ts';
import { ticksOf, type Bar } from './path.ts';

/**
 * A draft played on paper over a price path: every fill it would make, its value hour by hour, and how it compares
 * with simply holding. Orders fill at their own level (as a limit order or a DLMM bin does); fees and pool income are
 * not counted, so a live result differs — the window says so beside the figure. Pure and deterministic.
 */

export type FillNote = 'setup' | 'level' | 'tap' | 'exit' | 'rebuild';

export type Fill = Readonly<{
  t: number;
  side: 'buy' | 'sell';
  price: number;
  /** Base token. */
  qty: number;
  usd: number;
  /** `tap` — a reminder the person answered (on paper: answered at once); `setup` — the start's own buy. */
  note: FillNote;
}>;

export type Alert = Readonly<{ t: number; price: number }>;

export type RunState = 'running' | 'stopped' | 'waiting' | 'done';

export type Run = Readonly<{
  fills: readonly Fill[];
  alerts: readonly Alert[];
  /** Value hour by hour, USD. */
  equity: readonly Readonly<{ t: number; v: number }>[];
  startPrice: number;
  endPrice: number;
  startUsd: number;
  endUsd: number;
  /** What the same money would be worth held as the start left it. */
  holdUsd: number;
  pnlUsd: number;
  holdPnlUsd: number;
  /** Deepest fall of the value from a high, percent (positive). */
  maxDrawdownPct: number;
  /** Where the price left the band first, if it did. */
  left: Readonly<{ t: number; side: 'below' | 'above' }> | null;
  state: RunState;
  /** Base and USDC held at the end. */
  base: number;
  quote: number;
}>;

export type SimOptions = Readonly<{
  /** Only bars for which this is true count; a paused bot skips the rest and carries on where it stopped. */
  active?: (t: number) => boolean;
}>;

type Book = { base: number; quote: number; fills: Fill[] };

function trade(book: Book, t: number, side: 'buy' | 'sell', price: number, qty: number, note: FillNote): void {
  if (!(qty > 0) || !(price > 0)) return;
  if (side === 'buy') {
    const usd = Math.min(book.quote, qty * price);
    if (usd <= 1e-9) return;
    book.quote -= usd;
    book.base += usd / price;
    book.fills.push({ t, side, price, qty: usd / price, usd, note });
  } else {
    const q = Math.min(book.base, qty);
    if (q <= 1e-12) return;
    book.base -= q;
    book.quote += q * price;
    book.fills.push({ t, side, price, qty: q, usd: q * price, note });
  }
}

/** One cell of a grid between two levels: holding base to sell at the top, or USDC to buy at the bottom. */
type Cell = { lo: number; hi: number; budget: number; qty: number };

function gridCells(levels: readonly number[], price: number, budget: number, book: Book, t: number): Cell[] {
  const cells: Cell[] = [];
  const each = budget / Math.max(1, levels.length - 1);
  for (let i = 0; i + 1 < levels.length; i += 1) cells.push({ lo: levels[i]!, hi: levels[i + 1]!, budget: each, qty: 0 });
  // Cells wholly above the price start with base bought now, to sell on the way up; the rest wait to buy.
  const above = cells.filter((c) => c.lo >= price);
  const spend = above.reduce((a, c) => a + c.budget, 0);
  if (spend > 0) {
    const before = book.base;
    trade(book, t, 'buy', price, spend / price, 'setup');
    const got = book.base - before;
    for (const c of above) c.qty = (got * c.budget) / spend;
  }
  return cells;
}

/** The value of the book at a price. */
const valueAt = (book: Book, price: number) => book.quote + book.base * price;

export function simulate(draft: BotDraft, bars: readonly Bar[], options: SimOptions = {}): Run | null {
  const active = options.active ?? (() => true);
  const live = bars.filter((b) => active(b.t));
  if (!live.length) return null;
  const first = live[0]!;
  const p0 = first.o;
  const book: Book = { base: 0, quote: draft.amountUsd, fills: [] };
  const alerts: Alert[] = [];
  const equity: { t: number; v: number }[] = [];
  let state = 'running' as RunState;
  let left: Run['left'] = null;
  let holdBase = draft.amountUsd / p0;
  let holdQuote = 0;

  // Per-kind state.
  let cells: Cell[] = [];
  let band = bandOf(draft, p0);
  let ladder: { level: number; budget: number; done: boolean }[] = [];
  let outside = false;

  const setUpRanged = (price: number, t: number, rebuilt: boolean) => {
    if (draft.kind === 'grid' || draft.kind === 'lpRange') {
      const ratio = draft.upper / draft.lower;
      const shifted = rebuilt ? { ...draft, lower: price / Math.sqrt(ratio), upper: price * Math.sqrt(ratio) } : draft;
      band = { lower: shifted.lower, upper: shifted.upper };
      cells = gridCells(levelsOf(shifted, price), price, valueAt(book, price), book, t);
    } else if (draft.kind === 'buyLadder') {
      const levels = levelsOf(draft, price);
      band = bandOf(draft, price);
      const each = book.quote / levels.length;
      ladder = levels.map((level) => ({ level, budget: each, done: false }));
    } else if (draft.kind === 'smartDca') {
      // The ladder's share of what is left waits in its steps; the rest stays for the reminders.
      const levels = levelsOf(draft, price);
      band = bandOf(draft, price);
      const share = smartParts(draft).ladderPct / 100;
      const budget = rebuilt ? book.quote * share : Math.min(book.quote, draft.amountUsd * share);
      const each = levels.length ? budget / levels.length : 0;
      ladder = levels.map((level) => ({ level, budget: each, done: false }));
    } else if (draft.kind === 'exitLadder') {
      if (!rebuilt) trade(book, t, 'buy', price, book.quote / price, 'setup');
      const levels = levelsOf(draft, price);
      band = bandOf(draft, price);
      const each = book.base / levels.length;
      ladder = levels.map((level) => ({ level, budget: each, done: false }));
    }
  };

  if (draft.kind === 'rebalancer') {
    trade(book, first.t, 'buy', p0, (draft.amountUsd * draft.targetPct) / 100 / p0, 'setup');
    holdBase = book.base;
    holdQuote = book.quote;
  } else if (draft.kind === 'priceAlert') {
    trade(book, first.t, 'buy', p0, draft.amountUsd / p0, 'setup');
  } else {
    setUpRanged(p0, first.t, false);
  }

  // Reminders and signals: the next time a tap is due, and what a signal saw last.
  let due = first.t;
  let buysDone = 0;
  let spent = 0;
  let closes: number[] = [];
  let fastEma: number | null = null;
  let slowEma: number | null = null;
  let armed = true;
  const alertLevel = draft.kind === 'priceAlert' ? p0 * (1 + draft.movePct / 100) : 0;

  const applyExit = (policy: ExitPolicy, price: number, t: number, side: 'below' | 'above') => {
    if (!left) left = { t, side };
    if (policy === 'wait') {
      state = 'waiting';
      outside = true;
      return;
    }
    if (policy === 'stop') {
      state = 'stopped';
      return;
    }
    if (policy === 'sellAll') {
      trade(book, t, 'sell', price, book.base, 'exit');
      state = 'stopped';
      return;
    }
    // Rebuild: the same shape around the new price. A grid goes back to USDC first; a ladder keeps what it bought or
    // still holds and places the rest again.
    if (draft.kind === 'exitLadder' || draft.kind === 'buyLadder') {
      setUpRanged(price, t, true);
    } else {
      trade(book, t, 'sell', price, book.base, 'rebuild');
      setUpRanged(price, t, true);
    }
    state = 'running';
  };

  for (const bar of live) {
    for (const price of ticksOf(bar)) {
      if (state === 'stopped' || state === 'done') break;
      if (band) {
        const out = price < band.lower ? 'below' : price > band.upper ? 'above' : null;
        if (out && !outside) {
          applyExit(draft.exit, price, bar.t, out);
          if ((state as RunState) !== 'running') continue;
        } else if (!out && outside) {
          outside = false;
          state = 'running';
        }
        if (outside) continue;
      }
      switch (draft.kind) {
        case 'grid':
        case 'lpRange':
          for (const c of cells) {
            if (c.qty === 0 && price <= c.lo) {
              const before = book.base;
              trade(book, bar.t, 'buy', c.lo, c.budget / c.lo, 'level');
              c.qty = book.base - before;
            } else if (c.qty > 0 && price >= c.hi) {
              trade(book, bar.t, 'sell', c.hi, c.qty, 'level');
              c.qty = 0;
            }
          }
          break;
        case 'buyLadder':
        case 'smartDca':
          for (const step of ladder) {
            if (!step.done && price <= step.level) {
              trade(book, bar.t, 'buy', step.level, step.budget / step.level, 'level');
              step.done = true;
            }
          }
          break;
        case 'exitLadder':
          for (const step of ladder) {
            if (!step.done && price >= step.level) {
              trade(book, bar.t, 'sell', step.level, step.budget, 'level');
              step.done = true;
            }
          }
          if (ladder.length && ladder.every((s) => s.done)) state = 'done';
          break;
        case 'priceAlert': {
          const crossed = draft.movePct < 0 ? price <= alertLevel : price >= alertLevel;
          if (armed && crossed) {
            alerts.push({ t: bar.t, price });
            armed = false;
          } else if (!armed && (draft.movePct < 0 ? price >= alertLevel * 1.02 : price <= alertLevel / 1.02)) {
            armed = true;
          }
          break;
        }
        default:
          break;
      }
    }
    if (state !== 'stopped' && state !== 'done') {
      const price = bar.c;
      if (draft.kind === 'recurring') {
        closes.push(price);
        if (closes.length > 168) closes = closes.slice(-168);
        if (bar.t >= due && buysDone < draft.buys) {
          const usd = Math.min(draft.amountUsd / draft.buys, draft.amountUsd - spent);
          trade(book, bar.t, 'buy', price, usd / price, 'tap');
          spent += usd;
          buysDone += 1;
          due = bar.t + draft.everyHours * 3_600_000;
          if (buysDone >= draft.buys || spent >= draft.amountUsd - 1e-9) state = 'done';
        }
      } else if (draft.kind === 'smartDca') {
        // The reminders' part: leaning into dips, none over the ceiling (`lib/bots/ladder/smart.ts`).
        closes.push(price);
        if (closes.length > 168) closes = closes.slice(-168);
        const parts = smartParts(draft);
        const timeUsd = draft.amountUsd * (1 - parts.ladderPct / 100);
        if (bar.t >= due && buysDone < draft.buys) {
          const average = closes.reduce((a, b) => a + b, 0) / closes.length;
          const usd = timeLegBuyUsd({ perBuyUsd: timeUsd / draft.buys, price, average, startPrice: p0, ceilingPct: parts.ceilingPct, leftUsd: Math.min(timeUsd - spent, book.quote) });
          if (usd > 0) {
            trade(book, bar.t, 'buy', price, usd / price, 'tap');
            spent += usd;
          }
          buysDone += 1;
          due = bar.t + draft.everyHours * 3_600_000;
          const ladderDone = ladder.every((step) => step.done);
          if ((buysDone >= draft.buys || spent >= timeUsd - 1e-9) && ladderDone) state = 'done';
        }
      } else if (draft.kind === 'rebalancer') {
        const total = valueAt(book, price);
        const share = total > 0 ? ((book.base * price) / total) * 100 : 0;
        if (Math.abs(share - draft.targetPct) > draft.driftPct) {
          const want = (total * draft.targetPct) / 100 / price;
          if (want > book.base) trade(book, bar.t, 'buy', price, want - book.base, 'tap');
          else trade(book, bar.t, 'sell', price, book.base - want, 'tap');
        }
      } else if (draft.kind === 'signal') {
        const kf = 2 / (draft.fast + 1);
        const ks = 2 / (draft.slow + 1);
        const wasAbove = fastEma !== null && slowEma !== null ? fastEma > slowEma : null;
        fastEma = fastEma === null ? price : fastEma + kf * (price - fastEma);
        slowEma = slowEma === null ? price : slowEma + ks * (price - slowEma);
        const isAbove = fastEma > slowEma;
        if (wasAbove !== null && isAbove !== wasAbove) {
          if (isAbove) trade(book, bar.t, 'buy', price, book.quote / price, 'tap');
          else trade(book, bar.t, 'sell', price, book.base, 'tap');
        }
      }
    }
    equity.push({ t: bar.t, v: valueAt(book, bar.c) });
  }

  const last = live[live.length - 1]!;
  const endPrice = last.c;
  const endUsd = valueAt(book, endPrice);
  const holdUsd = holdQuote + holdBase * endPrice;
  let peak = -Infinity;
  let drawdown = 0;
  for (const point of equity) {
    peak = Math.max(peak, point.v);
    if (peak > 0) drawdown = Math.max(drawdown, (1 - point.v / peak) * 100);
  }
  return {
    fills: book.fills,
    alerts,
    equity,
    startPrice: p0,
    endPrice,
    startUsd: draft.amountUsd,
    endUsd,
    holdUsd,
    pnlUsd: endUsd - draft.amountUsd,
    holdPnlUsd: holdUsd - draft.amountUsd,
    maxDrawdownPct: drawdown,
    left,
    state,
    base: book.base,
    quote: book.quote,
  };
}

/** The fills that are trades the bot made by itself, without the start's own buy. */
export const tradesOf = (run: Run): readonly Fill[] => run.fills.filter((f) => f.note !== 'setup');
