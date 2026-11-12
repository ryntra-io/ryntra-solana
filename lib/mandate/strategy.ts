/**
 * CITY-175 — what the agent does with the budget a person gave it, on its own, tick after tick. Pure: the service
 * (`./tick.server.ts`) reads the chain and the agent's book, asks here, and does what this says.
 *
 * The rhythm is the steady strategy's: the day's budget is spread into equal
 * buys of the trade cap across the day, the first one at once, so the person sees the agent at work in minutes. Every
 * buy is inside the policy the person signed; the chain holds the same caps again and refuses what breaks them. The other
 * strategies (CITY-193, `./plans.ts`) ride on the same rhythm: a buy it allows they may hold back, never add one.
 *
 * The agent stops on its own when it should: the mandate ended or was taken back, the budget is spent, the last trades
 * failed in a row (the chain or the pool keeps saying no — it does not keep paying fees to hear it), or — CITY-179. 5 — what it bought is losing (`autostop`). The chain knows nothing of this pause: it is the agent keeping its
 * own hands off; what the chain holds is the caps.
 */

import { PLAN_IDS, type PlanId } from "./plans.ts";

export const STRATEGIES = PLAN_IDS;
export type StrategyId = PlanId;
export const isStrategy = (value: unknown): value is StrategyId => typeof value === "string" && (STRATEGIES as readonly string[]).includes(value);

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Every threshold of the agent's own pause, in one place. A new agent starts with small caps and these stay tight for
 * them: a person who said a sentence and walked away is told by a pause, not by an empty budget.
 */
export const AUTOSTOP = Object.freeze({
  /** Everything it bought is worth this much less than it paid (15 %). */
  maxLossBps: 1_500,
  /** This many buys in a row, each worth at least `losingTradeBps` less than it cost. */
  losingInARow: 3,
  /** A buy this far under its cost is a losing one (3 %): a pool's fee and the way back alone do not count. */
  losingTradeBps: 300,
  /** This many failed trades in a row. */
  failuresInARow: 3,
  /** A figure it needs stayed unread this long: it pauses rather than waits unseen. */
  unreadMs: 6 * HOUR_MS,
  /** A sent trade the chain answers it does not have, this many blocks past its blockhash's end, never landed. */
  settledBlocks: 150,
});

/** After this many failed trades in a row the agent pauses that mandate. */
export const FAILURES_TO_PAUSE = AUTOSTOP.failuresInARow;

/** One trade the agent made, as its book keeps it: public facts only. */
export type AgentTrade = Readonly<{
  at: number;
  /** The chain's answer: done; refused by the chain or its simulation; refused by the agent's own signer before the chain. */
  status: "ok" | "failed" | "refused";
  signature: string | null;
  /** The budget it spent, base units of the budget's token (lamports for SOL). */
  spentRaw: string;
  /** What landed in the person's wallet, base units of the coin bought; null when not read. */
  receivedRaw: string | null;
  /** The least the trade itself demanded for the person, base units of the coin bought. */
  minOutRaw?: string;
  /** Sent, its fate not read yet: the budget it may have spent. Cleared once the chain has answered. */
  unsettledRaw?: string;
  /** Such a trade's blockhash ends at this block height: it cannot land after. */
  validUntilHeight?: number;
  /** The chain's refusal, named (`./ssa.ts` `REFUSAL`), or the signer's reason. */
  reason: string | null;
  /** The day's budget was spent by the chain's own count: a wait, never a failure. */
  allowance?: boolean;
  /** A grid's buy: the level it bought (CITY-193). */
  level?: number;
}>;

/**
 * Why the agent paused itself. CITY-193: `take` and `stop` — the person's own exit was reached; `late` — an early plan's
 * launch is past its first hours. None of them sells anything: the agent stops buying and holds.
 * CITY-204: `market` and `balance` — the money autopilot's care (`lib/pilot/care.ts`): SOL fell sharply, or the trade's
 * part outgrew its share. Only that care lifts them; the tick never does.
 * CITY-70: `mismatch` — the vault holds less than the agent's book can explain (`./mission.ts` `reconcile`): it spends
 * nothing more; nothing lifts it, her withdraw takes what is there.
 */
export type PauseReason = "failing" | "loss" | "losses" | "short" | "unread" | "take" | "stop" | "late" | "market" | "balance" | "mismatch";

export type StrategyInput = Readonly<{
  strategy: StrategyId;
  perTrade: bigint;
  perDay: bigint;
  /** Unix seconds. */
  expiresAt: bigint;
  trades: readonly AgentTrade[];
  /** What the vault still holds of the budget, base units; null when not read. */
  budgetLeft: bigint | null;
  now: number;
  /** CITY-197: the plan's pace — buys a day at most (`./plans.ts`); absent — the caps' rhythm. */
  pace?: number | null;
}>;

export type Decision =
  | Readonly<{ action: "buy"; amount: bigint }>
  | Readonly<{ action: "wait"; until: number; reason: "interval" | "day-spent" }>
  | Readonly<{ action: "end"; reason: "ended" | "spent" | "failing" }>;

/** How many buys a day the steady strategy makes, and how far apart. */
export function steadyRhythm(perTrade: bigint, perDay: bigint, pace?: number | null): Readonly<{ buys: number; everyMs: number }> {
  const allowed = Math.max(1, perTrade > 0n ? Number(perDay / perTrade) : 0);
  /* CITY-197: the plan's pace is a ceiling under the caps' rhythm, never over it. */
  const buys = typeof pace === "number" && Number.isInteger(pace) && pace >= 1 ? Math.min(allowed, pace) : allowed;
  return { buys, everyMs: Math.floor(DAY_MS / buys) };
}

/** The agent's next move on this tick. */
export function decide(input: StrategyInput): Decision {
  const { perTrade, perDay, now } = input;
  if (BigInt(Math.floor(now / 1000)) >= input.expiresAt) return { action: "end", reason: "ended" };
  if (input.budgetLeft !== null && input.budgetLeft < perTrade) return { action: "end", reason: "spent" };
  let failures = 0;
  for (const trade of [...input.trades].reverse()) {
    /* CITY-70: a trade whose fate is unknown is no failure — it is read again by its signature before anything is bought. */
    if (trade.unsettledRaw !== undefined) continue;
    if (trade.status === "ok" || trade.allowance) break;
    failures += 1;
  }
  if (failures >= AUTOSTOP.failuresInARow) return { action: "end", reason: "failing" };

  const { buys, everyMs } = steadyRhythm(perTrade, perDay, input.pace);
  const done = input.trades.filter((trade) => trade.status === "ok");
  const today = done.filter((trade) => now - trade.at < DAY_MS);
  const spentToday = today.reduce((sum, trade) => sum + BigInt(trade.spentRaw), 0n);
  if (today.length >= buys || spentToday + perTrade > perDay) {
    const oldest = Math.min(...today.map((trade) => trade.at));
    return { action: "wait", until: oldest + DAY_MS, reason: "day-spent" };
  }
  /* The chain said the day is spent: wait out a whole rhythm step before asking again. */
  const lastAllowance = [...input.trades].reverse().find((trade) => trade.allowance);
  if (lastAllowance && now - lastAllowance.at < everyMs) return { action: "wait", until: lastAllowance.at + everyMs, reason: "day-spent" };
  const last = done.at(-1);
  if (last && now - last.at < everyMs) return { action: "wait", until: last.at + everyMs, reason: "interval" };
  return { action: "buy", amount: perTrade };
}

/** How what the agent bought stands at the price now, from its own trades: its loss overall, and its last buys in a row under water. */
export type TrackRecord = Readonly<{ spent: bigint; bought: bigint; lossBps: number; losingInARow: number }>;

export function trackRecord(trades: readonly AgentTrade[], worth: bigint): TrackRecord {
  const done = trades.filter((trade) => trade.status === "ok");
  const spent = done.reduce((sum, trade) => sum + BigInt(trade.spentRaw), 0n);
  const bought = done.reduce((sum, trade) => sum + BigInt(trade.receivedRaw ?? "0"), 0n);
  const lossBps = spent > 0n && worth < spent ? Number(((spent - worth) * 10_000n) / spent) : 0;
  let losingInARow = 0;
  for (const trade of [...done].reverse()) {
    /* Its share of the one quote: the coins it brought, at what all the coins fetch now. */
    const share = bought > 0n ? (BigInt(trade.receivedRaw ?? "0") * worth) / bought : 0n;
    if (share * 10_000n > BigInt(trade.spentRaw) * BigInt(10_000 - AUTOSTOP.losingTradeBps)) break;
    losingInARow += 1;
  }
  return { spent, bought, lossBps, losingInARow };
}

export type AutostopInput = Readonly<{
  trades: readonly AgentTrade[];
  /** Exactly the coins bought so far, quoted back at the pool's price now; null when not read. Zero when nothing was bought. */
  worthRaw: bigint | null;
  /** What the vault still holds of the budget, base units; null when not read. */
  budgetLeft: bigint | null;
  /** Since when a figure stays unread, ms; null when all were read last time. */
  unreadSince: number | null;
  now: number;
}>;

export type Autostop = Readonly<{ action: "go" }> | Readonly<{ action: "wait" }> | Readonly<{ action: "pause"; reason: PauseReason }>;

/**
 * Whether the agent may buy now, asked just before each buy. Only the chain's own figures count: what each trade spent
 * and received, what the vault holds, and the pool's quote for exactly the coins bought. A figure it could not read
 * means no buy this time — never a guess — and if it stays unread, a pause.
 */
export function autostop(input: AutostopInput): Autostop {
  const done = input.trades.filter((trade) => trade.status === "ok");
  /* A trade that landed under the minimum it demanded: the rule in the trade did not hold, nothing more is bought. */
  if (done.some((trade) => trade.minOutRaw !== undefined && trade.receivedRaw !== null && BigInt(trade.receivedRaw) < BigInt(trade.minOutRaw))) return { action: "pause", reason: "short" };
  const unread =
    input.budgetLeft === null ||
    input.trades.some((trade) => trade.unsettledRaw !== undefined) ||
    done.some((trade) => trade.receivedRaw === null) ||
    (done.length > 0 && input.worthRaw === null);
  if (unread) return input.unreadSince !== null && input.now - input.unreadSince >= AUTOSTOP.unreadMs ? { action: "pause", reason: "unread" } : { action: "wait" };
  if (done.length === 0) return { action: "go" };
  const record = trackRecord(input.trades, input.worthRaw!);
  if (record.lossBps >= AUTOSTOP.maxLossBps) return { action: "pause", reason: "loss" };
  if (record.losingInARow >= AUTOSTOP.losingInARow) return { action: "pause", reason: "losses" };
  return { action: "go" };
}

/**
 * What the agent did for the person so far, from its own trades and the price now: what it spent, what it bought, what
 * that is worth at the pool's price now (quoted for exactly the coins bought), and the difference. Nothing is estimated
 * beyond the one quote; a trade whose output or fate was not read leaves the result unread rather than guessed.
 */
export type AgentResult = Readonly<{
  trades: number;
  spentRaw: string;
  boughtRaw: string;
  /** The coins bought, sold back at the price now, in the budget's token; null when not quoted. */
  worthRaw: string | null;
  /** worth − spent; null when not quoted. */
  earnedRaw: string | null;
  /** worth ÷ spent; null when not quoted or nothing was spent. */
  multiple: number | null;
}>;

export function resultOf(trades: readonly AgentTrade[], worthRaw: bigint | null): AgentResult {
  const done = trades.filter((trade) => trade.status === "ok");
  const spent = done.reduce((sum, trade) => sum + BigInt(trade.spentRaw), 0n);
  const unread = done.some((trade) => trade.receivedRaw === null) || trades.some((trade) => trade.unsettledRaw !== undefined);
  const bought = done.reduce((sum, trade) => sum + BigInt(trade.receivedRaw ?? "0"), 0n);
  const worth = unread ? null : worthRaw;
  return {
    trades: done.length,
    spentRaw: spent.toString(),
    boughtRaw: bought.toString(),
    worthRaw: worth === null ? null : worth.toString(),
    earnedRaw: worth === null ? null : (worth - spent).toString(),
    multiple: worth === null || spent === 0n ? null : Number((worth * 1_000_000n) / spent) / 1_000_000,
  };
}
