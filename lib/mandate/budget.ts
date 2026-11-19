/**
 * The agent's budget is the person's own: how much a day, how much a trade,
 * for how many days — any numbers she writes; no ceiling of Ryntra's. The 0.1 SOL a day of decision 103 and the starter
 * caps of decision 95 (a) are gone. What stands under «the keys stay yours» stands as it was: the policy lets the agent
 * call only Jupiter, everything it buys lands only in her wallet, and she stops it whenever she likes (`./terms.ts`).
 *
 * What one signature moves:
 * - into her own vault — what the agent can spend at most: so many buys a day of the trade's size, for the days she
 *   wrote (`budgetFund`); the chain holds the day's cap she wrote and the trade's;
 * - to the agent — SOL for its network fees, 0.01 SOL, as every budget gave before (`agentNetworkOf`): one sum for any
 *   budget, so a long or busy one never pays more up front for fees a stop would not give back.
 *
 * The bounds below are technical, never a ceiling on money: a trade the network's fee outweighs is not made, an agent's
 * pass comes every few minutes, and a term is written in whole days. Pure — the window, the server and the agent's book
 * share it.
 */

export const LAMPORTS_PER_SOL = 1_000_000_000n;

/** The person's numbers, lamports and whole days. */
export type AgentBudget = Readonly<{ perDay: bigint; perTrade: bigint; days: number }>;

/** The least a trade is: below it the network's fee is more than the trade (0.001 SOL — under a dollar). */
export const TRADE_MIN_LAMPORTS = 1_000_000n;
/** At most this many buys a day: the agent's pass comes every few minutes (`./plans.ts` `PLAN_BOUNDS.pace`). */
export const BUYS_A_DAY_MAX = 24;
/** The longest term, in days: ten years — a bound on the date the chain keeps, not on money. */
export const DAYS_MAX = 3650;
/** The term a budget starts at when the wallet holds enough (`defaultDays`). */
export const DAYS_DEFAULT = 30;
/** The trade a budget starts at: half the day — two buys a day. */
export const TRADE_SHARE_DEFAULT = 2n;
/** SOL the signature gives the agent for its network fees, whatever the budget (what every budget gave before). */
export const AGENT_NETWORK_MIN = 10_000_000n;
/**
 * SOL a wallet needs beside the budget for what the signature opens and pays: the smart account's settings and the
 * policy (its rent comes back on «Stop»), the vault's and her own token accounts, the network's fees — about 0.015 SOL,
 * counted as 0.02.
 */
export const OPENING_LAMPORTS = 20_000_000n;

const U64_MAX = 2n ** 64n - 1n;

/** The buys a day the numbers allow: the day over the trade, at most `BUYS_A_DAY_MAX`; at least one. */
export function buysADay(budget: Pick<AgentBudget, "perDay" | "perTrade">): number {
  if (budget.perTrade <= 0n) return 1;
  const fit = budget.perDay / budget.perTrade;
  return Number(fit < 1n ? 1n : fit > BigInt(BUYS_A_DAY_MAX) ? BigInt(BUYS_A_DAY_MAX) : fit);
}

/** What the agent can spend in a day: its buys of the trade's size — never more than the day she wrote. */
export const daySpend = (budget: Pick<AgentBudget, "perDay" | "perTrade">): bigint => {
  const spend = budget.perTrade * BigInt(buysADay(budget));
  return spend > budget.perDay ? budget.perDay : spend;
};

/** What the signature moves into her vault: the day's spend for each day of the term. */
export const budgetFund = (budget: AgentBudget): bigint => daySpend(budget) * BigInt(budget.days);

/** SOL for the agent's network fees: one sum for every budget. */
export const agentNetworkOf = (_budget: AgentBudget): bigint => AGENT_NETWORK_MIN;

/** All the signature takes from her wallet for the budget: the vault's part and the agent's fees. */
export const budgetTotal = (budget: AgentBudget): bigint => budgetFund(budget) + agentNetworkOf(budget);

/** What is wrong with a budget, as the card says it under its field. */
export type BudgetIssue = "zero" | "tradeMin" | "tradeOverDay" | "buys" | "term" | "tooLarge";

/** The first thing wrong with these numbers; null when the agent takes them. Technical bounds only — no ceiling. */
export function budgetIssue(budget: AgentBudget): BudgetIssue | null {
  const { perDay, perTrade, days } = budget;
  if (perDay <= 0n || perTrade <= 0n) return "zero";
  if (perTrade < TRADE_MIN_LAMPORTS) return "tradeMin";
  if (perTrade > perDay) return "tradeOverDay";
  if (perDay > perTrade * BigInt(BUYS_A_DAY_MAX)) return "buys";
  if (!Number.isInteger(days) || days < 1 || days > DAYS_MAX) return "term";
  /* Each number is a u64 on chain: none may wrap. */
  if (perDay > U64_MAX || budgetTotal(budget) > U64_MAX) return "tooLarge";
  return null;
}

const ISSUES: Readonly<Record<BudgetIssue, string>> = {
  zero: "the day and the trade are above zero",
  tradeMin: "a trade is at least 0.001 SOL",
  tradeOverDay: "a trade is at most the day",
  buys: `the agent makes at most ${BUYS_A_DAY_MAX} buys a day`,
  term: `the term is 1 to ${DAYS_MAX} days`,
  tooLarge: "the budget is more than a token account holds",
};

/** Why these numbers are not a budget the agent takes, in the engine's words; null when they are. */
export function budgetRefusal(budget: AgentBudget): string | null {
  const issue = budgetIssue(budget);
  return issue ? ISSUES[issue] : null;
}

/** The least trade a day allows: the day over `BUYS_A_DAY_MAX`, rounded up, and never under the least trade. */
export function leastTradeOf(perDay: bigint): bigint {
  const share = (perDay + BigInt(BUYS_A_DAY_MAX) - 1n) / BigInt(BUYS_A_DAY_MAX);
  return share > TRADE_MIN_LAMPORTS ? share : TRADE_MIN_LAMPORTS;
}

/** The trade a day's budget starts at: half the day, and never under the least trade — or the whole day when it is less. */
export function defaultTrade(perDay: bigint): bigint {
  const half = perDay / TRADE_SHARE_DEFAULT;
  if (half >= TRADE_MIN_LAMPORTS) return half;
  return perDay;
}

/**
 * The term the budget starts at: `DAYS_DEFAULT`, or fewer when her spendable SOL holds less — the term never asks for
 * more than the wallet holds. Unknown balance — the default; a wallet short even of one day — one day (the card says so).
 */
export function defaultDays(day: Pick<AgentBudget, "perDay" | "perTrade">, spendableRaw: bigint | null): number {
  if (spendableRaw === null) return DAYS_DEFAULT;
  const spend = daySpend(day);
  if (spend <= 0n) return DAYS_DEFAULT;
  for (let days = DAYS_DEFAULT; days > 1; days -= 1) {
    const budget = { ...day, days };
    if (budgetTotal(budget) + OPENING_LAMPORTS <= spendableRaw) return days;
  }
  return 1;
}

/** The person's day with the trade and the term it starts at. */
export function budgetFrom(perDay: bigint, spendableRaw: bigint | null = null): AgentBudget {
  const perTrade = defaultTrade(perDay);
  return { perDay, perTrade, days: defaultDays({ perDay, perTrade }, spendableRaw) };
}

/**
 * The largest budget a sum holds whole — the vault's part and the agent's fees — over `days` or fewer, at the default
 * trade; null when even a day of the least trade does not fit (the money autopilot's trading part).
 */
export function budgetWithin(total: bigint, days: number = DAYS_DEFAULT): AgentBudget | null {
  const room = total - AGENT_NETWORK_MIN;
  if (room <= 0n) return null;
  /* A shorter term leaves a larger day: the first term whose day is a trade the agent makes. */
  for (let term = Math.max(1, Math.min(DAYS_MAX, Math.floor(days))); term >= 1; term -= 1) {
    let perDay = room / BigInt(term);
    /* The network's part grows with the buys: step the day down until the whole fits. */
    for (let tries = 0; tries < 8 && perDay > 0n; tries += 1) {
      const budget = { perDay, perTrade: defaultTrade(perDay), days: term };
      const over = budgetTotal(budget) - total;
      if (over <= 0n) {
        if (budgetRefusal(budget) === null) return budget;
        break;
      }
      perDay -= over / BigInt(term) + 1n;
    }
  }
  return null;
}

/** The days a mandate's end stands from a moment, rounded: a budget's term read back from the chain's date. */
export function termOf(expiresAtSeconds: bigint, nowMs: number): number {
  return Math.max(1, Math.round((Number(expiresAtSeconds) * 1000 - nowMs) / 86_400_000));
}

/** Lamports cut down to two significant digits: 0.0331666 SOL → 0.033 — a day a person reads at a glance. */
export function roundDay(lamports: bigint): bigint {
  if (lamports < 100n) return lamports;
  let step = 1n;
  while (lamports / step >= 100n) step *= 10n;
  return (lamports / step) * step;
}

/** Lamports counted up to two significant digits: 0.666666667 SOL → 0.67 — a least the eye reads, never under the least. */
export function roundUp(lamports: bigint): bigint {
  const down = roundDay(lamports);
  if (down === lamports) return lamports;
  let step = 1n;
  while (lamports / step >= 100n) step *= 10n;
  return down + step;
}

/** The handy shares of the wallet a card offers beside its field — never a sum of Ryntra's. */
export const HANDY_SHARES = [10, 25, 50, 100] as const;
export type HandyShare = (typeof HANDY_SHARES)[number];

/**
 * The budget a share of her spendable SOL makes over the default term: the day rounded for the eye, the trade and the
 * term that follow. Null when that share does not hold a day of the least trade.
 */
export function handyBudget(spendableRaw: bigint, share: HandyShare): AgentBudget | null {
  const room = ((spendableRaw > OPENING_LAMPORTS ? spendableRaw - OPENING_LAMPORTS : 0n) * BigInt(share)) / 100n;
  const fit = budgetWithin(room, DAYS_DEFAULT);
  if (!fit) return null;
  const perDay = roundDay(fit.perDay);
  const budget = { perDay, perTrade: defaultTrade(perDay), days: fit.days };
  return budgetIssue(budget) === null && budgetTotal(budget) <= room ? budget : null;
}
