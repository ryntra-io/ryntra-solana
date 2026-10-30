import { wordsNow } from '../../i18n/dict.ts';
import { isDelayed, type Market } from './markets.ts';
import type { SettleMarket } from './detail.ts';
import { PREDICT_TEXT } from './words.ts';

/**
 * Practice: the same markets with practice dollars, for anyone without money in Predictions. A buy is taken at the
 * venue's own price of the side when the window read it: the dollars buy `spend ÷ price` shares, and a share pays one
 * practice dollar when the venue resolves the market that way. A holding can be sold back at the side's price of a
 * fresh read. Nothing here touches a wallet, signs, or reaches a real account: the book is the city's, on this device.
 *
 * The paper Oracle's book (`ryntra.city.oracle.v1`, 28.10) carries over once: its points become practice dollars and
 * its open calls become holdings — a call of `stake` at `p` is `stake ÷ p` shares.
 */

export const START_USD = 1_000;
/** The amount tiles, dollars. */
export const AMOUNT_TILES = [10, 25, 50, 100] as const;
/** The sell tiles: a share of the holding. */
export const SELL_TILES = [0.25, 0.5, 1] as const;
/** Holdings open at once, at most. */
export const MAX_OPEN = 20;
/** Closed holdings kept on the device: the newest. */
export const KEEP_CLOSED = 100;
/** A side priced outside this band is all but decided: no buy on it. */
export const MIN_P = 0.02;
export const MAX_P = 0.98;
/** No new buy on a market this close to its close. */
export const CLOSE_GUARD_MS = 5 * 60_000;
/** A market that still names no winner this long after its close is void: the dollars come back. */
export const VOID_AFTER_MS = 14 * 24 * 3_600_000;
/** The most one practice buy may spend. */
export const MAX_BUY_USD = 10_000;

export const STORAGE_KEY = 'ryntra.city.predict.practice.v1';
/** The paper Oracle's book, read once to carry it over. */
export const ORACLE_KEY = 'ryntra.city.oracle.v1';

export type HoldingState = 'open' | 'won' | 'lost' | 'void' | 'sold';

export type Holding = Readonly<{
  id: string;
  eventId: string;
  marketId: string;
  outcomeId: string;
  title: string;
  question: string | null;
  image: string | null;
  /** The side, as the venue labels it. */
  label: string;
  shares: number;
  /** Practice dollars put in. */
  cost: number;
  openedAt: number;
  closes: string | null;
  /** What came back when it closed: the sale, the win, or the cost of a void market. */
  back: number | null;
  state: HoldingState;
  closedAt: number | null;
}>;

export type PracticeBook = Readonly<{ v: 1; cash: number; holdings: readonly Holding[]; resets: number; carried: boolean }>;

export function emptyBook(): PracticeBook {
  return { v: 1, cash: START_USD, holdings: [], resets: 0, carried: false };
}

const cents = (v: number) => Math.round(v * 100) / 100;
const share = (v: number) => Math.round(v * 1e6) / 1e6;

export type Refusal = 'amount' | 'cash' | 'delayed' | 'closing' | 'side' | 'price' | 'full' | 'holding' | 'closed';

type Said = (typeof PREDICT_TEXT)['en'];

/**
 * The same table, read in the language of the moment: each entry is a getter, so `table[key]` and `Object.values(table)`
 * give the words on screen now.
 */
export function saidNow<K extends string>(say: Readonly<Record<K, (w: Said) => string>>): Readonly<Record<K, string>> {
  const table = {} as Record<K, string>;
  for (const key of Object.keys(say) as K[]) Object.defineProperty(table, key, { enumerable: true, get: () => say[key](wordsNow(PREDICT_TEXT)) });
  return table;
}

/** Why a practice act is not taken, in the city's words. */
export const REFUSAL: Readonly<Record<Refusal, string>> = saidNow<Refusal>({
  amount: (w) => w.enterAmount,
  cash: (w) => w.practiceCash,
  delayed: (w) => w.pricesDelayed,
  closing: (w) => w.closing,
  side: (w) => w.pickSide,
  price: (w) => w.decided,
  full: (w) => w.full(MAX_OPEN),
  holding: (w) => w.nothingHere,
  closed: (w) => w.marketClosed,
});

export type BuyInput = Readonly<{ market: Market; sideId: string; spendUsd: number; readAt: string | null }>;

/** Whether a buy can be taken now; the reason when not. */
export function buyRefusal(book: PracticeBook, input: BuyInput, nowMs: number = Date.now()): Refusal | null {
  if (!(cents(input.spendUsd) >= 0.01) || !Number.isFinite(input.spendUsd) || input.spendUsd > MAX_BUY_USD) return 'amount';
  if (isDelayed(input.readAt, nowMs)) return 'delayed';
  if (input.market.closes && !(Date.parse(input.market.closes) - nowMs > CLOSE_GUARD_MS)) return 'closing';
  const side = input.market.sides.find((s) => s.id === input.sideId);
  if (!side) return 'side';
  if (side.p < MIN_P || side.p > MAX_P) return 'price';
  const open = book.holdings.filter((h) => h.state === 'open');
  if (!open.some((h) => h.outcomeId === side.id && h.marketId === input.market.marketId) && open.length >= MAX_OPEN) return 'full';
  if (cents(input.spendUsd) > book.cash + 1e-9) return 'cash';
  return null;
}

/** Buy a side: the dollars leave the practice cash; a second buy of the same side adds to its holding. */
export function buy(book: PracticeBook, input: BuyInput, nowMs: number = Date.now()): Readonly<{ ok: true; book: PracticeBook; holding: Holding }> | Readonly<{ ok: false; why: Refusal }> {
  const why = buyRefusal(book, input, nowMs);
  if (why) return { ok: false, why };
  const { market } = input;
  const side = market.sides.find((s) => s.id === input.sideId)!;
  const spend = cents(input.spendUsd);
  const shares = share(spend / side.p);
  const held = book.holdings.find((h) => h.state === 'open' && h.marketId === market.marketId && h.outcomeId === side.id);
  const holding: Holding = held
    ? { ...held, shares: share(held.shares + shares), cost: cents(held.cost + spend), image: held.image ?? market.image }
    : {
        id: `${market.marketId}:${side.id}:${nowMs}`,
        eventId: market.eventId,
        marketId: market.marketId,
        outcomeId: side.id,
        title: market.title,
        question: market.question,
        image: market.image,
        label: side.label,
        shares,
        cost: spend,
        openedAt: nowMs,
        closes: market.closes,
        back: null,
        state: 'open',
        closedAt: null,
      };
  const holdings = held ? book.holdings.map((h) => (h.id === held.id ? holding : h)) : [holding, ...book.holdings];
  return { ok: true, book: trimBook({ ...book, cash: cents(book.cash - spend), holdings }), holding };
}

/** What a holding is worth at a side's price `p`, and its profit or loss against what went in. */
export function valueOf(holding: Pick<Holding, 'shares' | 'cost'>, p: number): Readonly<{ value: number; pnl: number; pct: number | null }> {
  const value = cents(holding.shares * p);
  const pnl = cents(value - holding.cost);
  return { value, pnl, pct: holding.cost > 0 ? Math.round((pnl / holding.cost) * 1000) / 10 : null };
}

export type SellInput = Readonly<{ holdingId: string; fraction: number; p: number | null; readAt: string | null }>;

export function sellRefusal(book: PracticeBook, input: SellInput, nowMs: number = Date.now()): Refusal | null {
  const holding = book.holdings.find((h) => h.id === input.holdingId);
  if (!holding || holding.state !== 'open' || !(holding.shares > 0)) return 'holding';
  if (!(input.fraction > 0 && input.fraction <= 1)) return 'amount';
  if (input.p === null || !Number.isFinite(input.p) || input.p < 0 || input.p > 1) return 'price';
  if (isDelayed(input.readAt, nowMs)) return 'delayed';
  if (holding.closes && Date.parse(holding.closes) <= nowMs) return 'closed';
  return null;
}

/** Sell part or all of a holding at the side's price of a fresh read: the shares sold come back as practice dollars. */
export function sell(book: PracticeBook, input: SellInput, nowMs: number = Date.now()): Readonly<{ ok: true; book: PracticeBook; back: number }> | Readonly<{ ok: false; why: Refusal }> {
  const why = sellRefusal(book, input, nowMs);
  if (why) return { ok: false, why };
  const holding = book.holdings.find((h) => h.id === input.holdingId)!;
  const all = input.fraction >= 1;
  const shares = all ? holding.shares : share(holding.shares * input.fraction);
  const back = cents(shares * input.p!);
  const cost = all ? holding.cost : cents(holding.cost * input.fraction);
  const holdings: Holding[] = [];
  for (const h of book.holdings) {
    if (h.id !== holding.id) holdings.push(h);
    else if (all) holdings.push({ ...h, state: 'sold', back, closedAt: nowMs });
    else {
      holdings.push({ ...h, shares: share(h.shares - shares), cost: cents(h.cost - cost) });
      holdings.push({ ...h, id: `${h.id}:sold:${nowMs}`, shares, cost, state: 'sold', back, closedAt: nowMs });
    }
  }
  return { ok: true, book: trimBook({ ...book, cash: cents(book.cash + back), holdings }), back };
}

export type Verdict = 'pending' | 'won' | 'lost' | 'void';

/** The venue's answer that it no longer has the event at all (Predictions answers NOT_FOUND). */
export const GONE = 'gone';

/**
 * What the venue's word means for a holding: won or lost once it names a winner, whenever that comes; void when it
 * still names none long after the close, or when the venue no longer has the event; pending until then.
 */
export function verdictOf(holding: Holding, market: SettleMarket | typeof GONE | null, nowMs: number = Date.now()): Verdict {
  const read = market && market !== GONE && market.id === holding.marketId ? market : null;
  if (read) {
    const winners = read.outcomes.filter((o) => o.winner === true);
    if (winners.length) return winners.some((o) => o.id === holding.outcomeId) ? 'won' : 'lost';
  }
  const close = holding.closes ? Date.parse(holding.closes) : NaN;
  if (Number.isFinite(close)) return nowMs - close > VOID_AFTER_MS ? 'void' : 'pending';
  if (market === GONE) return 'void';
  const ended = read !== null && (read.status === 'resolved' || read.status === 'closed');
  return ended && nowMs - holding.openedAt > VOID_AFTER_MS ? 'void' : 'pending';
}

/** Settle one open holding: a win pays a dollar a share, a loss keeps nothing, void gives the cost back. */
export function settle(book: PracticeBook, holdingId: string, verdict: Verdict, nowMs: number = Date.now()): PracticeBook {
  if (verdict === 'pending') return book;
  const holding = book.holdings.find((h) => h.id === holdingId);
  if (!holding || holding.state !== 'open') return book;
  // A win pays what «To win» said: a dollar a share, rounded down to the cent.
  const back = verdict === 'won' ? Math.floor(holding.shares * 100 + 1e-7) / 100 : verdict === 'void' ? holding.cost : 0;
  return trimBook({
    ...book,
    cash: cents(book.cash + back),
    holdings: book.holdings.map((h) => (h.id === holdingId ? { ...h, state: verdict, back, closedAt: nowMs } : h)),
  });
}

export type PracticeRecord = Readonly<{
  cash: number;
  open: readonly Holding[];
  /** Closed holdings, the newest first. */
  closed: readonly Holding[];
  /** What the open holdings cost. */
  invested: number;
  /** Out of cash with nothing open: the practice dollars may start again. */
  canReset: boolean;
}>;

export function recordOf(book: PracticeBook): PracticeRecord {
  const open = book.holdings.filter((h) => h.state === 'open').sort((a, b) => b.openedAt - a.openedAt);
  const closed = book.holdings.filter((h) => h.state !== 'open').sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  return { cash: book.cash, open, closed, invested: cents(open.reduce((sum, h) => sum + h.cost, 0)), canReset: book.cash < AMOUNT_TILES[0] && open.length === 0 };
}

/** Start the practice dollars again once they are spent; the history stays. */
export function resetCash(book: PracticeBook): PracticeBook {
  return recordOf(book).canReset ? { ...book, cash: START_USD, resets: book.resets + 1 } : book;
}

/** Every open holding, and the newest closed ones. */
export function trimBook(book: PracticeBook): PracticeBook {
  const closed = book.holdings.filter((h) => h.state !== 'open');
  if (closed.length <= KEEP_CLOSED) return book;
  const keep = new Set(
    [...closed]
      .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
      .slice(0, KEEP_CLOSED)
      .map((h) => h.id),
  );
  return { ...book, holdings: book.holdings.filter((h) => h.state === 'open' || keep.has(h.id)) };
}

const STATES: ReadonlySet<string> = new Set(['open', 'won', 'lost', 'void', 'sold']);
const text = (v: unknown, max = 600): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const amount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e9;
const stamp = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const IMAGE = /^https:\/\/[^\s"'<>]+$/;

function readHolding(raw: unknown): Holding | null {
  if (!raw || typeof raw !== 'object') return null;
  const h = raw as Record<string, unknown>;
  if (!text(h.id) || !text(h.eventId, 64) || !text(h.marketId, 128) || !text(h.outcomeId, 128) || !text(h.title) || !text(h.label, 200)) return null;
  if (!amount(h.shares) || !amount(h.cost) || !stamp(h.openedAt) || typeof h.state !== 'string' || !STATES.has(h.state)) return null;
  if (h.question !== null && !text(h.question)) return null;
  if (h.image !== null && !(typeof h.image === 'string' && IMAGE.test(h.image) && h.image.length <= 2048)) return null;
  if (h.closes !== null && !text(h.closes, 64)) return null;
  if (h.back !== null && !amount(h.back)) return null;
  if (h.closedAt !== null && !stamp(h.closedAt)) return null;
  return {
    id: h.id,
    eventId: h.eventId,
    marketId: h.marketId,
    outcomeId: h.outcomeId,
    title: h.title,
    question: h.question as string | null,
    image: h.image as string | null,
    label: h.label,
    shares: h.shares,
    cost: h.cost,
    openedAt: h.openedAt,
    closes: h.closes as string | null,
    back: h.back as number | null,
    state: h.state as HoldingState,
    closedAt: h.closedAt as number | null,
  };
}

/**
 * The book saved on this device, when it reads as one; null otherwise (a fresh book then). A holding that does not
 * read — or repeats an id already read — is dropped alone: the rest of the book stays.
 */
export function parseBook(raw: unknown): PracticeBook | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (b.v !== 1 || !amount(b.cash) || !stamp(b.resets) || !Array.isArray(b.holdings)) return null;
  const seen = new Set<string>();
  const holdings: Holding[] = [];
  for (const entry of b.holdings) {
    const holding = readHolding(entry);
    if (!holding || seen.has(holding.id)) continue;
    seen.add(holding.id);
    holdings.push(holding);
  }
  return trimBook({ v: 1, cash: cents(b.cash), resets: b.resets, holdings, carried: b.carried === true });
}

/**
 * The paper Oracle's book carried over: its points as practice dollars, each open call as a holding of
 * `stake ÷ price` shares. Its settled calls stay behind. Null when there is no Oracle book to carry.
 */
export function carryOracle(raw: unknown): PracticeBook | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (b.v !== 1 || !stamp(b.points) || !Array.isArray(b.calls)) return null;
  const holdings: Holding[] = [];
  const seen = new Set<string>();
  for (const entry of b.calls) {
    const c = (entry ?? {}) as Record<string, unknown>;
    if (c.state !== 'open' || !text(c.id) || seen.has(c.id)) continue;
    if (!text(c.eventId, 64) || !text(c.marketId, 128) || !text(c.outcomeId, 128) || !text(c.question) || !text(c.side, 200)) continue;
    if (typeof c.p !== 'number' || !(c.p > 0 && c.p < 1) || !stamp(c.stake) || !stamp(c.at)) continue;
    seen.add(c.id);
    holdings.push({
      id: `oracle:${c.id}`,
      eventId: c.eventId,
      marketId: c.marketId,
      outcomeId: c.outcomeId,
      title: c.question,
      question: text(c.market) ? c.market : null,
      image: null,
      label: c.side,
      shares: share(c.stake / c.p),
      cost: c.stake,
      openedAt: c.at,
      closes: text(c.closes, 64) ? c.closes : null,
      back: null,
      state: 'open',
      closedAt: null,
    });
  }
  return trimBook({ v: 1, cash: cents(b.points), holdings, resets: 0, carried: true });
}
