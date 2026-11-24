/**
 * The Scout on paper, with live prices: what it would have bought, when it would have left, and with what result — no
 * money, no signature, no transaction. A paper trade pays what a real one would: Ryntra's fee on each side and the
 * market's slippage (`SCOUT_PAPER.slippageBps`), so a paper result is never better than the market would have given.
 *
 * - **Open** — at the market's price of the pass, the size the risk engine set.
 * - **Marks** — each pass reads the price, the hour's and the six hours' volume of every open position and applies the
 *   exits (`SCOUT_EXIT`): a stop that sells everything, half once at twice the entry, a close when the volume fades, a
 *   close by time, and a close at the last price when the price has not been read for too long. Between two passes the
 *   price is not seen: a stop is taken at the price of the pass that saw it, as a real sale would be.
 * - **One desk for everyone, each person's own numbers.** The shared desk runs on a reference budget; a person's budget
 *   replays it (`paperFor`): the same coins at the same moments, each trade sized by the person's own limits, the day's
 *   budget and loss pause counted on the person's numbers. Results scale with the size; the per cent is the coin's.
 *
 * Pure and client-safe. Lamports travel as strings, so a desk is plain JSON.
 */

import { dayLossLimit, dayOf, liquidityLamports, type ScoutBudget } from "./risk.ts";
import { SCOUT_EXIT, SCOUT_PAPER, SCOUT_RISK } from "./rules.ts";
import type { ForCode, Invalidation, Shape } from "./thesis.ts";

export type ExitReason = "stop" | "half" | "fade" | "time" | "unread";

export type PaperSale = Readonly<{ at: number; price: number; solUsd: number; tokens: number; receivedLamports: string; reason: ExitReason }>;

export type PaperPosition = Readonly<{
  mint: string;
  symbol: string;
  icon: string | null;
  openedAt: number;
  /** The market's price at the pass that opened it, USD per token. */
  entryPrice: number;
  solUsdAtOpen: number;
  spentLamports: string;
  /** The pool at the open, USD — what the size was measured against. */
  liquidityUsd: number;
  feeBps: number;
  /** Tokens bought, after the fee and the slippage. */
  tokens: number;
  /** Tokens still held. */
  held: number;
  /** Why it was taken: the thesis's codes. */
  why: readonly ForCode[];
  shape: Shape;
  invalidation: Invalidation | null;
  last: Readonly<{ at: number; price: number; solUsd: number }>;
  peak: number;
  sales: readonly PaperSale[];
  /** Set once nothing is held. */
  closedAt: number | null;
}>;

export type PaperMark = Readonly<{
  at: number;
  /** The market's price now; null — not read. */
  price: number | null;
  volumeH1Usd: number | null;
  volumeH6Usd: number | null;
  solUsd: number | null;
}>;

export type ExitRules = typeof SCOUT_EXIT;

const LAMPORTS = 1e9;

/** Lamports a sale of `tokens` at `price` brings after slippage and the fee. */
export function saleLamports(tokens: number, price: number, solUsd: number, feeBps: number, slippageBps: number = SCOUT_PAPER.slippageBps): bigint {
  if (!(tokens > 0) || !(price > 0) || !(solUsd > 0)) return 0n;
  const usd = tokens * price * (1 - slippageBps / 10_000) * (1 - feeBps / 10_000);
  return BigInt(Math.max(0, Math.floor((usd / solUsd) * LAMPORTS)));
}

export type OpenInput = Readonly<{
  mint: string;
  symbol: string;
  icon: string | null;
  at: number;
  price: number;
  solUsd: number;
  lamports: bigint;
  liquidityUsd: number;
  feeBps: number;
  why: readonly ForCode[];
  shape: Shape;
  invalidation: Invalidation | null;
}>;

/** A paper buy: the fee and the slippage paid, the tokens it would have brought. */
export function openPosition(input: OpenInput, slippageBps: number = SCOUT_PAPER.slippageBps): PaperPosition {
  const usd = (Number(input.lamports) / LAMPORTS) * input.solUsd * (1 - input.feeBps / 10_000);
  const tokens = usd / (input.price * (1 + slippageBps / 10_000));
  return {
    mint: input.mint,
    symbol: input.symbol,
    icon: input.icon,
    openedAt: input.at,
    entryPrice: input.price,
    solUsdAtOpen: input.solUsd,
    spentLamports: input.lamports.toString(),
    liquidityUsd: input.liquidityUsd,
    feeBps: input.feeBps,
    tokens,
    held: tokens,
    why: input.why,
    shape: input.shape,
    invalidation: input.invalidation,
    last: { at: input.at, price: input.price, solUsd: input.solUsd },
    peak: input.price,
    sales: [],
    closedAt: null,
  };
}

function sell(position: PaperPosition, tokens: number, at: number, price: number, solUsd: number, reason: ExitReason): PaperPosition {
  const amount = Math.min(tokens, position.held);
  const received = saleLamports(amount, price, solUsd, position.feeBps);
  const held = position.held - amount;
  const sale: PaperSale = { at, price, solUsd, tokens: amount, receivedLamports: received.toString(), reason };
  return { ...position, held: held > position.tokens * 1e-9 ? held : 0, sales: [...position.sales, sale], closedAt: held > position.tokens * 1e-9 ? null : at };
}

/** One pass's mark on a position: the exits it meets, in order — the stop first, then half, the fade and the time. */
export function markPosition(position: PaperPosition, mark: PaperMark, rules: ExitRules = SCOUT_EXIT): PaperPosition {
  if (position.closedAt !== null) return position;
  if (mark.price === null || !(mark.price > 0) || mark.solUsd === null || !(mark.solUsd > 0)) {
    if (mark.at - position.last.at >= rules.unreadMs) return sell(position, position.held, mark.at, position.last.price, position.last.solUsd, "unread");
    return position;
  }
  const price = mark.price;
  let next: PaperPosition = { ...position, last: { at: mark.at, price, solUsd: mark.solUsd }, peak: Math.max(position.peak, price) };
  const age = mark.at - position.openedAt;
  if (price <= position.entryPrice * (1 - rules.stopBps / 10_000)) return sell(next, next.held, mark.at, price, mark.solUsd, "stop");
  if (!next.sales.some((sale) => sale.reason === "half") && price >= position.entryPrice * rules.halfAt) next = sell(next, next.tokens / 2, mark.at, price, mark.solUsd, "half");
  if (next.closedAt !== null) return next;
  const fading = age >= rules.fadeAfterMs && mark.volumeH1Usd !== null && mark.volumeH6Usd !== null && mark.volumeH6Usd > 0 && mark.volumeH1Usd < (rules.fadeShare * mark.volumeH6Usd) / 6;
  if (fading) return sell(next, next.held, mark.at, price, mark.solUsd, "fade");
  if (age >= rules.maxHoldMs) return sell(next, next.held, mark.at, price, mark.solUsd, "time");
  return next;
}

export type PaperResult = Readonly<{
  spentLamports: bigint;
  /** Received from sales plus what is still held, at the last price read. */
  worthLamports: bigint;
  resultLamports: bigint;
  /** Per cent of what was spent. */
  resultPct: number;
}>;

/** What a position is worth now against what it cost, on the last price read. */
export function resultOf(position: PaperPosition): PaperResult {
  const spent = BigInt(position.spentLamports);
  const received = position.sales.reduce((total, sale) => total + BigInt(sale.receivedLamports), 0n);
  const heldWorth = saleLamports(position.held, position.last.price, position.last.solUsd, position.feeBps);
  const worth = received + heldWorth;
  const result = worth - spent;
  return { spentLamports: spent, worthLamports: worth, resultLamports: result, resultPct: spent > 0n ? (Number(result) / Number(spent)) * 100 : 0 };
}

/** The reason a position closed: its last sale's, unless that was the half (then it is still open). */
export function closeReason(position: PaperPosition): ExitReason | null {
  if (position.closedAt === null) return null;
  return position.sales.at(-1)?.reason ?? null;
}

/* ------------------------------------------------------------ a person's own numbers */

export type PersonPosition = Readonly<{ position: PaperPosition; spentLamports: bigint; resultLamports: bigint; resultPct: number }>;

export type PersonPaper = Readonly<{
  positions: readonly PersonPosition[];
  spentLamports: bigint;
  resultLamports: bigint;
  /** Per cent of everything spent. */
  resultPct: number;
  wins: number;
  losses: number;
  /** Trades the shared desk made that the person's budget would not have: the day spent, the day's loss paused, too small. */
  skipped: number;
}>;

/**
 * The shared desk replayed on a person's own numbers: the same coins at the same moments, oldest first, each sized by the
 * person's trade limit, the pool's share and what is left of the person's day; a day whose closed trades lost the
 * person's pause share stops there. Results scale with the size — the per cent is the coin's.
 */
export function paperFor(budget: ScoutBudget, positions: readonly PaperPosition[], rules: typeof SCOUT_RISK = SCOUT_RISK): PersonPaper {
  const ordered = [...positions].sort((a, b) => a.openedAt - b.openedAt || a.mint.localeCompare(b.mint));
  const spentByDay = new Map<string, bigint>();
  const out: PersonPosition[] = [];
  let skipped = 0;
  for (const position of ordered) {
    const day = dayOf(position.openedAt);
    const spentToday = spentByDay.get(day) ?? 0n;
    /* Only losses the person would already have seen close before this open pause the day. */
    const closedLoss = out
      .filter((row) => dayOf(row.position.openedAt) === day && row.position.closedAt !== null && row.position.closedAt <= position.openedAt && row.resultLamports < 0n)
      .reduce((total, row) => total - row.resultLamports, 0n);
    if (budget.perDayLamports <= 0n || budget.perTradeLamports <= 0n || (closedLoss > 0n && closedLoss >= dayLossLimit(budget, rules))) {
      skipped += 1;
      continue;
    }
    const pool = liquidityLamports(position.liquidityUsd, position.solUsdAtOpen, rules);
    let size = budget.perTradeLamports;
    if (pool !== null && pool < size) size = pool;
    const left = budget.perDayLamports - spentToday;
    if (left < size) size = left;
    if (size < rules.minTradeLamports) {
      skipped += 1;
      continue;
    }
    spentByDay.set(day, spentToday + size);
    const reference = resultOf(position);
    const scale = reference.spentLamports > 0n ? Number(size) / Number(reference.spentLamports) : 0;
    const result = BigInt(Math.round(Number(reference.resultLamports) * scale));
    out.push({ position, spentLamports: size, resultLamports: result, resultPct: reference.resultPct });
  }
  const spent = out.reduce((total, row) => total + row.spentLamports, 0n);
  const result = out.reduce((total, row) => total + row.resultLamports, 0n);
  const closed = out.filter((row) => row.position.closedAt !== null);
  return {
    positions: out.reverse(),
    spentLamports: spent,
    resultLamports: result,
    resultPct: spent > 0n ? (Number(result) / Number(spent)) * 100 : 0,
    wins: closed.filter((row) => row.resultLamports > 0n).length,
    losses: closed.filter((row) => row.resultLamports < 0n).length,
    skipped,
  };
}
