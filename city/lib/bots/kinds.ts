/**
 * The bots of the hub (B4, the bots hub of 29.10): what each bot is, which goal it answers, where its money sits and
 * whether it keeps working when Ryntra is away. Words live in `words.ts`; this file is the facts only.
 *
 * In this task every bot runs on paper: nothing signs, nothing moves money. «Where the money sits» is what the live bot
 * will do, said before anyone starts one, so the card reads the same on paper and live. Jupiter's Trigger V2 (Privy's
 * custodial vault) is out by the spec: no bot here ever puts money where the person's own wallet cannot take it back.
 */

/** Stage A: the bots a person can start (on paper now). */
export const BOT_KINDS = ['grid', 'buyLadder', 'exitLadder', 'lpRange', 'recurring', 'smartDca', 'rebalancer', 'priceAlert', 'signal', 'copy'] as const;
export type BotKind = (typeof BOT_KINDS)[number];

/** The bots after stage A, shown as «Next» with a way to hear when they open — never «Soon». */
export const NEXT_KINDS = ['flipGrid', 'stocksFunding'] as const;
export type NextKind = (typeof NEXT_KINDS)[number];

/** What a person wants; each goal has one bot it recommends first. */
export const GOALS = ['swings', 'accumulate', 'profit', 'balance'] as const;
export type Goal = (typeof GOALS)[number];

/**
 * Where a live bot's money sits.
 * - `position` — a liquidity position of the person's own on Meteora DLMM: only their wallet can take it out.
 * - `order` — limit orders on the chain: DLMM limit bins first, Jupiter Trigger V1's per-order escrow as the fallback
 *   (`lib/solana/limits/model.ts`: both non-custodial); only the person's signature cancels them and takes the rest back.
 * - `wallet` — the person's wallet; every trade waits for their one tap.
 */
export type Custody = 'position' | 'order' | 'wallet';

/** How a bot trades: by itself on the chain once placed, by asking the person each time, or both (Smart DCA: its ladder by itself, its reminders by a tap). */
export type Drive = 'chain' | 'tap' | 'both';

export type KindFacts = Readonly<{
  goal: Goal;
  custody: Custody;
  drive: Drive;
  /** Keeps working with Ryntra closed: its orders or position live on the chain. */
  standalone: boolean;
  /** Has a price range, so an exit policy for leaving it. */
  ranged: boolean;
  /** Signatures a live start takes. */
  startSignatures: number;
}>;

export const KIND_FACTS: Readonly<Record<BotKind, KindFacts>> = {
  grid: { goal: 'swings', custody: 'position', drive: 'chain', standalone: true, ranged: true, startSignatures: 1 },
  lpRange: { goal: 'swings', custody: 'position', drive: 'chain', standalone: true, ranged: true, startSignatures: 1 },
  signal: { goal: 'swings', custody: 'wallet', drive: 'tap', standalone: false, ranged: false, startSignatures: 0 },
  buyLadder: { goal: 'accumulate', custody: 'order', drive: 'chain', standalone: true, ranged: true, startSignatures: 1 },
  recurring: { goal: 'accumulate', custody: 'wallet', drive: 'tap', standalone: false, ranged: false, startSignatures: 0 },
  smartDca: { goal: 'accumulate', custody: 'order', drive: 'both', standalone: false, ranged: true, startSignatures: 1 },
  exitLadder: { goal: 'profit', custody: 'order', drive: 'chain', standalone: true, ranged: true, startSignatures: 1 },
  priceAlert: { goal: 'profit', custody: 'wallet', drive: 'tap', standalone: false, ranged: false, startSignatures: 0 },
  rebalancer: { goal: 'balance', custody: 'wallet', drive: 'tap', standalone: false, ranged: false, startSignatures: 0 },
  copy: { goal: 'swings', custody: 'position', drive: 'chain', standalone: true, ranged: true, startSignatures: 1 },
};

/** The bots each goal shows, the recommended one first. */
export const GOAL_KINDS: Readonly<Record<Goal, readonly BotKind[]>> = {
  swings: ['grid', 'lpRange', 'signal'],
  accumulate: ['recurring', 'buyLadder', 'smartDca'],
  profit: ['exitLadder', 'priceAlert'],
  balance: ['rebalancer'],
};

/** The order of the catalogue: the four goals' first bots, then the rest; «Copy» lives with the strategies. */
export const CATALOGUE: readonly BotKind[] = ['grid', 'recurring', 'buyLadder', 'exitLadder', 'rebalancer', 'lpRange', 'smartDca', 'priceAlert', 'signal', 'copy'];

export const isBotKind = (value: unknown): value is BotKind => typeof value === 'string' && (BOT_KINDS as readonly string[]).includes(value);
export const isGoal = (value: unknown): value is Goal => typeof value === 'string' && (GOALS as readonly string[]).includes(value);
export const isNextKind = (value: unknown): value is NextKind => typeof value === 'string' && (NEXT_KINDS as readonly string[]).includes(value);
