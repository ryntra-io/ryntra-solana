/**
 * A market's budget as Ryntra keeps it — the ledger of the executor's claims
 * on the markets whose partner fees it claims itself (Micro and the demo
 * market), the risk limits the executor read last, and how a market's budget
 * is said in «Здоров'я ринку», «Лаунчі на Ryntra» and the API:
 *
 * - `COUNTED` — a market Ryntra launched itself, its fees claimed by the
 *   executor: earned (by source), placed into the steps, the reserve, and the
 *   part that still waits in Meteora's pools;
 * - `IN_POOL` — a market with no ladder (people's markets in phase 0): Ryntra
 *   claims nothing there; what it earned waits in Meteora's pools, read from
 *   the programs' own counters;
 * - `NOT_COUNTED` — a market whose partner fees go to the partner's multisig
 *   (Classic, Protected, «Спільнота»): no budget is kept for it.
 *
 * What stands in Ryntra's steps is read from their position on the chain
 * wherever the steps are placed; a position there and not read now is
 * `UNREAD`, never hidden. Whatever was not read is null — never a zero.
 */

import type { LaunchMarketBudgetView } from "../api/v1/contract.ts";
import {
  BUDGET_SOURCES,
  budgetExhausted,
  budgetReserveRaw,
  budgetTotals,
  type BudgetClaim,
  type BudgetRisk,
  type BudgetSource,
  type BudgetTotals,
  type PriceSeen,
} from "../core/launch/budget.ts";
import { launchPreset } from "../core/venues/meteora-dbc/presets.ts";
import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";

/** Ryntra's steps on a market: none, placed with what they hold now, or placed and not read now. */
export type LadderRead =
  | Readonly<{ state: "NONE" }>
  | Readonly<{
      state: "PLACED";
      pool: string;
      position: string;
      pairRaw: string;
      tokensRaw: string;
      /** Each step: its price in the pair currency per token, and the pair currency it holds. */
      bins: readonly Readonly<{ price: number; pairRaw: string }>[];
      lowerPrice: number;
      upperPrice: number;
    }>
  | Readonly<{ state: "UNREAD"; pool: string; position: string | null }>;

/** Whether a preset's partner fees are claimed by Ryntra's executor itself — Micro and the demo market. */
export function executorClaimsPreset(preset: string): boolean {
  return launchPreset(preset)?.feeClaimer === "executor";
}

/* ------------------------------------------------------------ the record the executor keeps per market */

const BUDGETS = "launchBudgets";
const REVENUE = "launchRevenue";
const key = (cluster: string, token: string) => `solana:${cluster}:${token}`;

/** A claim the executor sent and the chain has not answered yet — written before the send. */
export type BudgetPending = Readonly<{ source: BudgetSource; signature: string; validUntil: number; sentAt: string }>;

export type MarketBudgetRecord = Readonly<{
  version: number;
  cluster: string;
  token: string;
  pairMint: string;
  /** Every claim that landed, the oldest first — the ledger's truth. */
  claims: readonly BudgetClaim[];
  pending: BudgetPending | null;
  /** When the locked position's fees were last claimed, unix seconds. */
  lpClaimedAt: number | null;
  /** The steps' top-ups of the last day: when, how much from the budget, and the transaction — each counted once. */
  topUps: readonly Readonly<{ at: number; raw: string; signature?: string }>[];
  /** The executor's reads of the price for the risk limits — an hour of them. */
  seen: readonly PriceSeen[];
  /** The most of the token the creator's wallet held, as the executor read it; null before the first read. */
  creatorHighRaw: string | null;
  /**
   * When the executor first read the creator's wallet, unix seconds (SOL-L6); absent on records from before. A watch that
   * began well after the launch cannot know of an earlier sale.
   */
  creatorWatchFrom?: number | null;
  /** A sale (or a move out) from the creator's wallet in the market's first week, unix seconds; null when none. */
  creatorSoldAt: number | null;
  /** The limits that held at the executor's last read, and since when. */
  risks: readonly BudgetRisk[];
  riskAt: number | null;
  /** The pair currency the steps held at the last read; null before. */
  stepsPairRaw: string | null;
  /** When the budget was found exhausted; null while it is not. */
  exhaustedAt: string | null;
  updatedAt: string;
}>;

export function emptyBudgetRecord(cluster: string, token: string, pairMint: string, now: Date): MarketBudgetRecord {
  return {
    version: -1,
    cluster,
    token,
    pairMint,
    claims: [],
    pending: null,
    lpClaimedAt: null,
    topUps: [],
    seen: [],
    creatorHighRaw: null,
    creatorSoldAt: null,
    risks: [],
    riskAt: null,
    stepsPairRaw: null,
    exhaustedAt: null,
    updatedAt: now.toISOString(),
  };
}

export async function readBudgetRecord(store: GuardStore, cluster: string, token: string): Promise<MarketBudgetRecord | null> {
  return (await store.versioned<MarketBudgetRecord>(BUDGETS).get(key(cluster, token))) ?? null;
}

export async function readBudgetRecords(store: GuardStore, cluster: string): Promise<readonly MarketBudgetRecord[]> {
  return (await store.versioned<MarketBudgetRecord>(BUDGETS).valuesWithPrefix(`solana:${cluster}:`)).filter((row) => row.cluster === cluster);
}

/** The market's budget record changed by `change` — read again and changed again when another write came first. */
export async function updateBudgetRecord(
  store: GuardStore,
  args: Readonly<{ cluster: string; token: string; pairMint: string; now: Date }>,
  change: (current: MarketBudgetRecord) => Omit<MarketBudgetRecord, "version" | "updatedAt">,
): Promise<MarketBudgetRecord> {
  const rows = store.versioned<MarketBudgetRecord>(BUDGETS);
  const at = key(args.cluster, args.token);
  return withBoundedCasRetry(async () => {
    const current = (await rows.get(at)) ?? emptyBudgetRecord(args.cluster, args.token, args.pairMint, args.now);
    const next: MarketBudgetRecord = { ...change(current), version: current.version + 1, updatedAt: args.now.toISOString() };
    return (await rows.compareAndSet(at, current.version < 0 ? null : current.version, next)) ? next : false;
  });
}

/* ------------------------------------------------------------ figures */

export type BudgetFigures = Readonly<{
  totals: BudgetTotals;
  /** What went into the steps from the budget. */
  placedRaw: bigint;
  /** What the ladder's own pool cost from the budget (the cent's proof). */
  costsRaw: bigint;
  reserveRaw: bigint;
}>;

export function budgetFigures(args: Readonly<{ record: MarketBudgetRecord | null; placedRaw: bigint; costsRaw: bigint }>): BudgetFigures {
  const totals = budgetTotals(args.record?.claims ?? []);
  return { totals, placedRaw: args.placedRaw, costsRaw: args.costsRaw, reserveRaw: budgetReserveRaw({ earnedRaw: totals.earnedRaw, placedRaw: args.placedRaw, costsRaw: args.costsRaw }) };
}

/**
 * How a market's budget is read for the answers. `claims` (SOL-L6): Ryntra's executor claims this market's budget — a
 * market Ryntra launched, or a person's Micro market while the operator's switch of people's markets is open.
 */
export type BudgetRead =
  | Readonly<{ kind: "NOT_COUNTED" }>
  /** Not claimed yet: what the partner earned waits in Meteora's pools — the budget's part of it; null when not read. */
  | Readonly<{ kind: "IN_POOL"; inPool: Readonly<{ budgetRaw: bigint; bySource: Readonly<Record<BudgetSource, bigint>> }> | null; claims?: boolean }>
  | Readonly<{ kind: "COUNTED"; figures: BudgetFigures; inPoolRaw: bigint | null; exhausted: boolean; claims?: boolean }>;

const raw = (value: bigint | null) => (value === null ? null : value.toString());
const sources = (bySource: Readonly<Record<BudgetSource, bigint>>) => Object.fromEntries(BUDGET_SOURCES.map((source) => [source, bySource[source].toString()])) as Record<BudgetSource, string>;

/** The budget as the API says it. */
export function marketBudget(ladder: LadderRead, budget: BudgetRead = { kind: "NOT_COUNTED" }): LaunchMarketBudgetView {
  const deployed = ladder.state === "PLACED" ? { pairRaw: ladder.pairRaw, tokensRaw: ladder.tokensRaw } : null;
  if (budget.kind === "IN_POOL") {
    return {
      state: "IN_POOL",
      earnedRaw: budget.inPool ? budget.inPool.budgetRaw.toString() : null,
      reserveRaw: null,
      ladder: ladder.state,
      deployed,
      sources: budget.inPool ? sources(budget.inPool.bySource) : null,
      placedRaw: null,
      revenueRaw: null,
      inPoolRaw: budget.inPool ? budget.inPool.budgetRaw.toString() : null,
      exhausted: false,
      /* Not known (the switch not read): not said. */
      ...(budget.claims !== undefined ? { claims: budget.claims } : {}),
    };
  }
  if (budget.kind === "COUNTED") {
    const { figures } = budget;
    return {
      state: "COUNTED",
      earnedRaw: figures.totals.earnedRaw.toString(),
      reserveRaw: figures.reserveRaw.toString(),
      ladder: ladder.state,
      deployed,
      sources: sources(figures.totals.bySource),
      placedRaw: figures.placedRaw.toString(),
      revenueRaw: figures.totals.revenueRaw.toString(),
      inPoolRaw: raw(budget.inPoolRaw),
      exhausted: budget.exhausted,
      ...(budget.claims !== undefined ? { claims: budget.claims } : {}),
    };
  }
  return { state: "NOT_COUNTED", earnedRaw: null, reserveRaw: null, ladder: ladder.state, deployed };
}

/** Whether a budget is exhausted now, from what its steps held at the executor's last read. */
export function exhaustedNow(record: MarketBudgetRecord | null, figures: BudgetFigures): boolean {
  return budgetExhausted({ placedRaw: figures.placedRaw, stepsPairRaw: record?.stepsPairRaw ? BigInt(record.stepsPairRaw) : null, reserveRaw: figures.reserveRaw });
}

/* ------------------------------------------------------------ Ryntra's revenue on the wallet */

export type RevenueRecord = Readonly<{
  cluster: string;
  executor: string;
  pairMint: string;
  /** Every revenue part the claims brought. */
  claimedRaw: string;
  /** What of it is still on the executor's wallet now — what was left, plus new revenue, less what the operator swept. */
  onWalletRaw: string;
  /** What the markets' budgets keep on the wallet. */
  reservesRaw: string;
  /** The operator was told at this amount, at this time; null once it stood below the threshold again. */
  alertedRaw: string | null;
  alertedAt: string | null;
  /** Whether the word reached the operator's Telegram; null when none was sent. */
  delivered: boolean | null;
  /** The last try to tell the operator that did not reach them; an undelivered word is tried again an hour later. */
  attemptAt?: string | null;
  at: string;
}>;

export async function readRevenue(store: GuardStore, cluster: string): Promise<RevenueRecord | null> {
  return (await store.collection<RevenueRecord>(REVENUE).get(`solana:${cluster}`).catch(() => null)) ?? null;
}

export async function writeRevenue(store: GuardStore, row: RevenueRecord): Promise<void> {
  await store.collection<RevenueRecord>(REVENUE).set(`solana:${row.cluster}`, row);
}
