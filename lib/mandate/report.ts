/**
 * CITY-194 — the agent's day: what it did for the person in a span of time, from its own trades in the book. Every
 * figure is the book's or the venue's: the trades that landed, the budget they spent, the coins they brought, and what
 * those coins are worth at the price the venue answers now. Nothing is estimated forward and nothing is promised; a
 * figure that was not read is null, never zero. Pure, so the tests read it and the city, the cron and the route agree.
 */

import type { AgentTrade } from "./strategy.ts";

/** A span the report covers — «today» is the last day; «while you were away» is since the person last looked. */
export const DAY_MS = 86_400_000;

export type AgentDay = Readonly<{
  /** The span, ms. */
  since: number;
  until: number;
  /** The trades that landed in it. */
  trades: number;
  /** The budget they spent, lamports. */
  spentRaw: string;
  /** The coins they brought, base units of the coin. */
  boughtRaw: string;
  /** Those coins at the venue's price now, lamports; null when a trade's coins or the price were not read. */
  worthRaw: string | null;
  /** worth − spent, lamports; null with the worth. */
  earnedRaw: string | null;
  /** CITY-197: after every fee — the exit's and the network's share too (`./net.ts`); null — not read; absent — not counted. */
  netRaw?: string | null;
  /** CITY-197: plain holding of the same SOL, after the same fees; null — cannot be priced. */
  holdRaw?: string | null;
}>;

/** What the coins the agent holds for her are worth now: the holding and its worth, as `agentResult` read them. */
export type Holding = Readonly<{ heldRaw: string; worthRaw: string | null }>;

const digitsOnly = (value: string | null | undefined): value is string => typeof value === "string" && /^\d{1,30}$/u.test(value);

/**
 * The agent's trades between `since` and `until`, priced now. The worth of the span's coins is their share of what the
 * agent holds at the venue's price — the same price, the same coins; with a trade whose coins were not read yet, a
 * trade still in flight, or no price, the worth is null.
 */
export function dayOf(trades: readonly AgentTrade[], span: Readonly<{ since: number; until: number }>, holding: Holding | null): AgentDay {
  const inSpan = trades.filter((trade) => trade.at >= span.since && trade.at <= span.until);
  const done = inSpan.filter((trade) => trade.status === "ok");
  const spent = done.reduce((sum, trade) => sum + BigInt(trade.spentRaw), 0n);
  const unread = done.some((trade) => !digitsOnly(trade.receivedRaw)) || inSpan.some((trade) => trade.unsettledRaw !== undefined);
  const bought = done.reduce((sum, trade) => sum + (digitsOnly(trade.receivedRaw) ? BigInt(trade.receivedRaw) : 0n), 0n);
  let worth: bigint | null = null;
  if (!unread && holding && digitsOnly(holding.heldRaw) && digitsOnly(holding.worthRaw)) {
    const held = BigInt(holding.heldRaw);
    /* Priced per coin, rounded down: the span's coins never read as worth more than the venue's price says. */
    if (held > 0n) worth = (bought * BigInt(holding.worthRaw)) / held;
    else if (bought === 0n) worth = 0n;
  }
  if (done.length === 0) worth = 0n;
  return {
    since: span.since,
    until: span.until,
    trades: done.length,
    spentRaw: spent.toString(),
    boughtRaw: bought.toString(),
    worthRaw: worth === null ? null : worth.toString(),
    earnedRaw: worth === null ? null : (worth - spent).toString(),
  };
}

/** The last day, ending now. */
export const lastDay = (trades: readonly AgentTrade[], now: number, holding: Holding | null): AgentDay => dayOf(trades, { since: now - DAY_MS, until: now }, holding);

/** Lamports in dollars at a SOL price, rounded toward zero to the cent; null without a price. */
export function usdOf(lamports: string | null, solUsd: number | null): number | null {
  if (lamports === null || solUsd === null || !Number.isFinite(solUsd) || solUsd <= 0) return null;
  const micros = BigInt(Math.round(solUsd * 1_000_000));
  const cents = (BigInt(lamports) * micros) / 10_000_000_000_000n;
  return Number(cents) / 100;
}
