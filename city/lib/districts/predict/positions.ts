import { recordOf, valueOf, type Holding, type PracticeBook } from './practice.ts';
import type { Live, OrderLine, Position, Status } from './real.ts';

/**
 * «Your positions», whichever the money, as one list the window draws in four places — the page of positions, the
 * column beside the markets, the chip on a market's card and the block on its page: what is held, what it is worth
 * now, its profit or loss, and where it stands (on its way, taken, not taken). And the history: what closed, and how.
 *
 * Practice holdings are this device's book, priced by the freshest read. Real ones are the engine's — the account's
 * positions and Ryntra's own order records, read with the account — so a buy shows from the press on, and survives a
 * reload because the engine holds it.
 */

export type Line = Readonly<{
  key: string;
  eventId: string | null;
  marketId: string | null;
  outcomeId: string | null;
  title: string;
  image: string | null;
  label: string;
  shares: number | null;
  /** The average price paid, 0–1. */
  avg: number | null;
  /** The side's price now, 0–1. */
  price: number | null;
  value: number | null;
  cost: number | null;
  pnl: number | null;
  pct: number | null;
  status: Status;
  /** Whether a tap may open its market on Sell. */
  sellable: boolean;
  /** Practice holdings: the book's own id, for a sale. */
  holdingId: string | null;
}>;

export type Past = Readonly<{
  key: string;
  eventId: string | null;
  title: string;
  image: string | null;
  label: string;
  word: 'Won' | 'Lost' | 'Sold' | 'Void' | 'Bought' | 'Not filled' | 'Paid' | 'Collecting';
  /** What came back, or what went in for an order. */
  amount: number | null;
  /** Profit or loss where it is known. */
  pnl: number | null;
  at: number;
  tone: 'up' | 'down' | 'flat';
}>;

export type PriceOf = (h: Holding) => number | null;

const cents = (v: number) => Math.round(v * 100) / 100;

export function practiceLine(h: Holding, p: number | null): Line {
  const v = p === null ? null : valueOf(h, p);
  return {
    key: h.id,
    eventId: h.eventId,
    marketId: h.marketId,
    outcomeId: h.outcomeId,
    title: h.question ? `${h.title} · ${h.question}` : h.title,
    image: h.image,
    label: h.label,
    shares: h.shares,
    avg: h.shares > 0 ? h.cost / h.shares : null,
    price: p,
    value: v?.value ?? null,
    cost: h.cost,
    pnl: v?.pnl ?? null,
    pct: v?.pct ?? null,
    status: 'accepted',
    sellable: true,
    holdingId: h.id,
  };
}

const PAST_WORD = { won: 'Won', lost: 'Lost', sold: 'Sold', void: 'Void' } as const;

/** Practice: the open holdings, then the closed ones, newest first. */
export function practiceBook(book: PracticeBook, priceOf: PriceOf): Readonly<{ open: readonly Line[]; past: readonly Past[] }> {
  const record = recordOf(book);
  const open = record.open.map((h) => practiceLine(h, priceOf(h)));
  const past = record.closed.map((h): Past => {
    const back = h.back ?? 0;
    const pnl = cents(back - h.cost);
    return {
      key: h.id,
      eventId: h.eventId,
      title: h.title,
      image: h.image,
      label: h.label,
      word: PAST_WORD[h.state as keyof typeof PAST_WORD] ?? 'Sold',
      amount: back,
      pnl,
      at: h.closedAt ?? h.openedAt,
      tone: pnl > 0.004 ? 'up' : pnl < -0.004 ? 'down' : 'flat',
    };
  });
  return { open, past };
}

export function realLine(p: Position): Line {
  return {
    key: p.key,
    eventId: p.eventId,
    marketId: p.sell?.marketId ?? null,
    outcomeId: p.sell?.outcomeId ?? null,
    title: p.title,
    image: p.image,
    label: p.label,
    shares: p.shares,
    avg: p.avg,
    price: p.price,
    value: p.value,
    cost: p.avg !== null ? cents(p.avg * p.shares) : null,
    pnl: p.pnl,
    pct: p.pct,
    status: 'accepted',
    sellable: p.sell !== null && !p.resolved,
    holdingId: null,
  };
}

function orderLine(o: OrderLine, image: string | null): Line {
  return {
    key: `order:${o.quoteId}`,
    eventId: o.eventId,
    marketId: o.marketId,
    outcomeId: o.outcomeId,
    title: o.title,
    image,
    label: o.label,
    shares: o.shares,
    avg: o.price,
    price: null,
    value: o.side === 'buy' ? o.totalUsd : null,
    cost: o.totalUsd,
    pnl: null,
    pct: null,
    status: o.status,
    sellable: false,
    holdingId: null,
  };
}

/**
 * Real: an order on its way first (and one this visit placed that was not taken, until the account is read again),
 * then the account's positions. A taken order is its position: it is not listed twice.
 */
export function realBook(live: Live | null, orders: readonly OrderLine[], recentQuotes: ReadonlySet<string> = new Set()): Readonly<{ open: readonly Line[]; past: readonly Past[] }> {
  const positions = (live?.positions ?? []).map(realLine);
  const imageOf = (eventId: string | null) => positions.find((p) => p.eventId === eventId && p.image)?.image ?? null;
  const waiting = orders.filter((o) => o.status === 'pending' || (o.status === 'failed' && recentQuotes.has(o.quoteId))).map((o) => orderLine(o, imageOf(o.eventId)));
  const past: Past[] = [];
  for (const o of orders) {
    if (o.status === 'pending') continue;
    const at = Date.parse(o.at);
    past.push({
      key: `order:${o.quoteId}`,
      eventId: o.eventId,
      title: o.title,
      image: imageOf(o.eventId),
      label: o.side === 'sell' ? `Sold ${o.label}` : o.label,
      word: o.status === 'accepted' ? (o.side === 'sell' ? 'Sold' : 'Bought') : 'Not filled',
      amount: o.totalUsd,
      pnl: null,
      at: Number.isFinite(at) ? at : 0,
      tone: 'flat',
    });
  }
  for (const r of live?.receipts ?? []) {
    const at = Date.parse(r.at);
    past.push({
      key: `receipt:${r.id}`,
      eventId: null,
      title: r.lines[0]?.title ?? 'Winnings',
      image: null,
      label: r.lines.length > 1 ? `${r.lines.length} wins` : (r.lines[0]?.label ?? ''),
      word: r.paid ? 'Paid' : 'Collecting',
      amount: r.totalUsd,
      pnl: null,
      at: Number.isFinite(at) ? at : 0,
      tone: 'up',
    });
  }
  past.sort((a, b) => b.at - a.at);
  return { open: [...waiting, ...positions], past };
}

export type Summary = Readonly<{ value: number; cost: number; pnl: number | null; pct: number | null; count: number; pending: number }>;

/** What the open lines come to: their value now, what they cost, and the move between. A line no read prices counts at its cost. */
export function summaryOf(lines: readonly Line[]): Summary {
  let value = 0;
  let cost = 0;
  let priced = 0;
  let pending = 0;
  for (const l of lines) {
    if (l.status === 'pending') pending++;
    if (l.status !== 'accepted') continue;
    value += l.value ?? l.cost ?? 0;
    if (l.cost !== null) {
      cost += l.cost;
      if (l.value !== null) priced++;
    }
  }
  const pnl = priced ? cents(value - cost) : null;
  return { value: cents(value), cost: cents(cost), pnl, pct: pnl !== null && cost > 0 ? Math.round((pnl / cost) * 1000) / 10 : null, count: lines.filter((l) => l.status === 'accepted').length, pending };
}

/** The lines held on one event — for its card and its page. */
export function linesOn(lines: readonly Line[], eventId: string): readonly Line[] {
  return lines.filter((l) => l.eventId === eventId);
}

/** How a line's state reads, in one word; null for a position simply held. */
export function statusWord(status: Status): string | null {
  return status === 'pending' ? 'On its way' : status === 'failed' ? 'Not filled' : null;
}
