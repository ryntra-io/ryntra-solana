/**
 * CITY-197 — the agent's honest result: what it did for the person after every fee, and beside it what plain holding
 * would have done. Pure, so the card, the daily report, the cron and the tests say the same figures.
 *
 * After every fee means:
 * - Ryntra's fee on each buy — already inside what a trade spent (`./fee.ts`: the fee is a share of the amount);
 * - Ryntra's fee on selling back — what she would pay to turn the coins into SOL now: the worth is the venue's quote
 *   without it, so it is taken off at the table's rate (`./fee-rates.ts`; the highest rate when the pair's is not read);
 * - the network — the SOL she put in for the agent's network fees when she turned it on (`./presets.ts` `agentFee`).
 *   It is spread over the trades the agent made: each trade carries its share, so the days add up to the whole.
 *
 * Plain holding is the same SOL put into the same coin at once, at the first buy's own price (its fee inside), held, and
 * sold back now with the same fee — no agent, no network top-up. The figures are the book's and the venue's; nothing is
 * forecast, nothing is promised, no rate per day is drawn. A figure that was not read is null, never zero.
 */

import { AGENT_FEE_CEILING_BPS } from "./fee-rates.ts";
import type { AgentTrade } from "./strategy.ts";

export type NetInputs = Readonly<{
  /** Every trade of the mandate, as the book keeps them. */
  trades: readonly AgentTrade[];
  /** The span the result covers, ms; the whole mandate when absent. */
  span?: Readonly<{ since: number; until: number }> | null;
  /** The coins the agent holds for her now, and those coins quoted back into SOL now (without Ryntra's fee); null — unread. */
  heldRaw: string | null;
  worthRaw: string | null;
  /** SOL her sales through the agent brought — already after their fee. Counted only for the whole mandate. */
  gotRaw?: string | null;
  /** Ryntra's fee on selling the coin back, basis points; null — not read, the highest rate the agent may carry is used. */
  exitBps?: number | null;
  /** The SOL she put in for the agent's network fees, lamports. */
  networkRaw?: string | null;
}>;

export type AgentNet = Readonly<{
  /** The trades that landed in the span. */
  trades: number;
  /** What they spent, lamports — Ryntra's buy fee inside. */
  spentRaw: string;
  /** After every fee: worth − exit fee + sales − spent − network share, lamports; null when the worth was not read. */
  netRaw: string | null;
  /** Plain holding of the same SOL, after the same fees, lamports; null when it cannot be priced. */
  holdRaw: string | null;
  /** The fees taken off on top of what the trades spent: the exit fee and the network share, lamports; null with the worth. */
  feesRaw: string | null;
}>;

const digitsOnly = (value: string | null | undefined): value is string => typeof value === "string" && /^\d{1,30}$/u.test(value);

/** The rate the exit is counted at: the pair's when read and within the table, else the highest the agent may carry. */
export function exitRate(bps: number | null | undefined): number {
  return typeof bps === "number" && Number.isInteger(bps) && bps >= 0 && bps <= AGENT_FEE_CEILING_BPS ? bps : AGENT_FEE_CEILING_BPS;
}

/** What selling `worth` back would leave after Ryntra's fee, rounded down. */
const afterExit = (worth: bigint, bps: number) => worth - (worth * BigInt(bps) + 9_999n) / 10_000n;

/**
 * The result of a span — or of the whole mandate — after every fee, and plain holding beside it. The span's coins are
 * priced as their share of what the agent holds at the venue's price now, as the daily report prices them (`./report.ts`).
 */
export function netOf(input: NetInputs): AgentNet {
  const span = input.span ?? null;
  const all = input.trades.filter((trade) => trade.status === "ok");
  const inSpan = span ? input.trades.filter((trade) => trade.at >= span.since && trade.at <= span.until) : input.trades;
  const done = inSpan.filter((trade) => trade.status === "ok");
  const spent = done.reduce((sum, trade) => sum + BigInt(trade.spentRaw), 0n);
  const unread = done.some((trade) => !digitsOnly(trade.receivedRaw)) || inSpan.some((trade) => trade.unsettledRaw !== undefined);
  const bought = done.reduce((sum, trade) => sum + (digitsOnly(trade.receivedRaw) ? BigInt(trade.receivedRaw) : 0n), 0n);
  const base = { trades: done.length, spentRaw: spent.toString() };
  if (done.length === 0) return { ...base, netRaw: "0", holdRaw: "0", feesRaw: "0" };
  if (unread || !digitsOnly(input.heldRaw) || !digitsOnly(input.worthRaw)) return { ...base, netRaw: null, holdRaw: null, feesRaw: null };

  const held = BigInt(input.heldRaw);
  const worthAll = BigInt(input.worthRaw);
  const bps = exitRate(input.exitBps);
  /* The whole mandate: what it holds now, and what her sales brought. A span: its own coins' share of the holding. */
  const whole = span === null;
  let worth: bigint;
  if (whole) worth = worthAll;
  else if (held > 0n) worth = (bought * worthAll) / held;
  else worth = 0n;
  const got = whole && digitsOnly(input.gotRaw) ? BigInt(input.gotRaw) : 0n;
  const kept = afterExit(worth, bps);
  /* The network SOL she put in, carried by the trades the agent made: this span's share of it. */
  const network = digitsOnly(input.networkRaw) ? BigInt(input.networkRaw) : 0n;
  const networkShare = all.length > 0 ? (network * BigInt(done.length) + BigInt(all.length) - 1n) / BigInt(all.length) : 0n;
  const net = kept + got - spent - networkShare;

  /* Plain holding: the span's SOL into the coin at once, at the span's first buy's price, sold back now. */
  let hold: bigint | null = null;
  const first = done[0]!;
  const firstSpent = BigInt(first.spentRaw);
  if (held > 0n && firstSpent > 0n) {
    const coins = (spent * BigInt(first.receivedRaw!)) / firstSpent;
    hold = afterExit((coins * worthAll) / held, bps) - spent;
  }
  return { ...base, netRaw: net.toString(), holdRaw: hold === null ? null : hold.toString(), feesRaw: (worth - kept + networkShare).toString() };
}
