/**
 * A market's budget — the money of the Fee-Funded Liquidity Ladder on the
 * markets whose partner fees Ryntra's executor claims itself — by fixed definitions, so a terminal reading
 * the same chain can repeat them:
 *
 * - **its sources** — the migration fee and the partner's share of the
 *   surplus, whole; a quarter (`BUDGET_RULE.feeShareBps`) of the partner's
 *   trading fees on the curve and of the fees of the partner's locked DAMM v2
 *   position. The other three quarters of those two are Ryntra's revenue —
 *   on the same wallet, counted apart, never the market's;
 * - **earned · deployed · reserve** — what the claims brought into the
 *   budget; what the executor put into the steps from it; what is left:
 *   earned less what was put in and less what the ladder's own pool cost;
 * - **the ladder's size** — at most 70 % of what was earned in the steps, at
 *   least 5 USDC a step, the steps 2.5 % apart from about −5 % and never below
 *   about −25 % (Micro's range) — so their number follows the budget
 *   (`budgetSteps`); a larger budget makes the steps thicker, not deeper;
 * - **the risk limits** — policies checked every pass (`budgetRisk`): the
 *   price read from two nodes apart by more than 2 % or a gap in the reads
 *   longer than five minutes — nothing done in this pass; a fall of more than
 *   30 % within an hour, a sale from the creator's wallet in the market's first
 *   week, less than 0.1 SOL on the executor — no new money into the steps; a
 *   day's top-ups at most a quarter of what was earned;
 * - **exhausted** — the steps hold none of the pair currency and the reserve
 *   is below one step: the ladder is not refilled, the market lives on its
 *   DAMM v2 pool;
 * - **Ryntra's revenue on the wallet** — above 100 USDC the operator is told,
 *   and sweeps it to the multisig by his own signature; the markets' budgets
 *   are never part of it.
 *
 * Pure and client-safe; the chain is read by `lib/launch/budget.server.ts`.
 */

/** Where a market's budget comes from. */
export const BUDGET_SOURCES = ["migration", "surplus", "curve", "lp"] as const;
export type BudgetSource = (typeof BUDGET_SOURCES)[number];

export const BUDGET_RULE = Object.freeze({
  /** Of the partner's trading fees on the curve and of the locked position's fees: the market's share, basis points. */
  feeShareBps: 2_500,
  /** The most of what was earned that stands in the steps, basis points. */
  deployMaxBps: 7_000,
  /** The least a step holds: 5 USDC (the budget's pair is USDC, six decimals). */
  minStepRaw: 5_000_000n,
  maxSteps: 45,
  /** A day's top-ups of the steps, at most this share of what was earned, basis points. */
  dailyTopUpBps: 2_500,
  dayBeforeSeconds: 86_400,
  /** A fall of the price this large within `dropWindowSeconds` stops new money into the steps. */
  dropStopBps: 3_000,
  dropWindowSeconds: 3_600,
  /** The price read from two nodes apart by more than this: nothing done in this pass. */
  divergenceBps: 200,
  /** A gap in the executor's reads longer than this: the pass only reads. */
  observationMaxAgeSeconds: 300,
  /** A sale from the creator's wallet this soon after the launch stops new money into the steps. */
  creatorSaleWindowSeconds: 7 * 86_400,
  /** Below this the executor puts no new money into the steps. */
  executorMinLamports: 100_000_000n,
  /** Ryntra's revenue on the executor's wallet above this: the operator is told. */
  revenueAlertRaw: 100_000_000n,
  /** The locked position's fees are claimed once a day at most, from 1 USDC. */
  lpClaimMinRaw: 1_000_000n,
  lpClaimEverySeconds: 86_400,
  /** A curve's fee below this is not worth a transaction's fee. */
  curveClaimMinRaw: 10_000n,
});

/** A creator's wallet first read later than this after the launch: a sale in the first week could have gone unseen. */
export const CREATOR_WATCH_GRACE_SECONDS = 15 * 60;

/**
 * Whether a person's market had its creator watched from its launch (SOL-L6): the executor's first read of the creator's
 * wallet within `CREATOR_WATCH_GRACE_SECONDS` of it. A sale in the first week stops new money for good, so a market whose
 * first week was not watched is one Ryntra does not keep a budget for — its fees wait in Meteora's pools.
 */
export function creatorWatchProven(args: Readonly<{ watchFrom: number | null | undefined; launchedAt: number }>): boolean {
  return args.watchFrom !== null && args.watchFrom !== undefined && args.watchFrom - args.launchedAt <= CREATOR_WATCH_GRACE_SECONDS;
}

/** What one claim brings: its part for the market's budget and its part for Ryntra's revenue. */
export function splitClaim(source: BudgetSource, raw: bigint): Readonly<{ budgetRaw: bigint; revenueRaw: bigint }> {
  if (raw <= 0n) return { budgetRaw: 0n, revenueRaw: 0n };
  if (source === "migration" || source === "surplus") return { budgetRaw: raw, revenueRaw: 0n };
  const budgetRaw = (raw * BigInt(BUDGET_RULE.feeShareBps)) / 10_000n;
  return { budgetRaw, revenueRaw: raw - budgetRaw };
}

/** One claim of the executor's into a market's budget, as its confirmed transaction shows it. */
export type BudgetClaim = Readonly<{
  source: BudgetSource;
  signature: string;
  at: string | null;
  /** The pair currency the executor received, raw. */
  pairRaw: string;
  /** The token it received, raw — split as the pair currency is; the budget's tokens are never sold into a fall. */
  tokensRaw: string;
  budgetRaw: string;
  revenueRaw: string;
  /** The budget's part of `tokensRaw`; absent on claims written before it — then all of them. */
  budgetTokensRaw?: string;
}>;

export type BudgetTotals = Readonly<{
  earnedRaw: bigint;
  revenueRaw: bigint;
  /** The budget's part by source. */
  bySource: Readonly<Record<BudgetSource, bigint>>;
  tokensRaw: bigint;
}>;

export function budgetTotals(claims: readonly BudgetClaim[]): BudgetTotals {
  const bySource: Record<BudgetSource, bigint> = { migration: 0n, surplus: 0n, curve: 0n, lp: 0n };
  let revenue = 0n;
  let tokens = 0n;
  const seen = new Set<string>();
  for (const claim of claims) {
    /* One transaction is counted once, whoever wrote it twice. */
    if (seen.has(claim.signature)) continue;
    seen.add(claim.signature);
    bySource[claim.source] += BigInt(claim.budgetRaw);
    revenue += BigInt(claim.revenueRaw);
    tokens += BigInt(claim.budgetTokensRaw ?? claim.tokensRaw);
  }
  const earned = BUDGET_SOURCES.reduce((total, source) => total + bySource[source], 0n);
  return { earnedRaw: earned, revenueRaw: revenue, bySource, tokensRaw: tokens };
}

/** What is left of a budget: earned less what went into the steps and what the ladder's pool cost. Never below zero. */
export function budgetReserveRaw(args: Readonly<{ earnedRaw: bigint; placedRaw: bigint; costsRaw: bigint }>): bigint {
  const left = args.earnedRaw - args.placedRaw - args.costsRaw;
  return left > 0n ? left : 0n;
}

/* ------------------------------------------------------------ the ladder's size */

/**
 * The ladder a budget pays for: steps 2.5 % apart (a DLMM pool of bin step 250, its fee 1 % in the pair currency), the
 * first two steps below the price (≈ −4.8 %), never deeper than ≈ −25.6 % — at most `maxStepsByDepth` steps.
 */
export const BUDGET_LADDER = Object.freeze({
  binStep: 250,
  topGapBins: 2,
  /** Micro's range: 2 + 11 − 1 = 12 bins below the price, 1.025⁻¹² ≈ 0.744, −25.6 %. */
  maxStepsByDepth: 11,
  /** A move up after the price held about 10 % above the steps' level. */
  raiseStepBins: 4,
});

export function budgetSteps(amountRaw: bigint): number {
  if (amountRaw < BUDGET_RULE.minStepRaw) return 0;
  const byAmount = Number(amountRaw / BUDGET_RULE.minStepRaw);
  return Math.min(byAmount, BUDGET_LADDER.maxStepsByDepth, BUDGET_RULE.maxSteps);
}

/**
 * What may go into a market's steps now: within 70 % of what was earned less what is in already, within the reserve,
 * within what the wallet holds free, and — a top-up — within a day's ceiling less the day's top-ups. A first placement is
 * nothing below one step; a top-up nothing below one step either.
 */
export function budgetPlaceableRaw(args: Readonly<{ earnedRaw: bigint; placedRaw: bigint; costsRaw: bigint; freeRaw: bigint; topUp: boolean; dayTopUpsRaw: bigint }>): bigint {
  const cap = (args.earnedRaw * BigInt(BUDGET_RULE.deployMaxBps)) / 10_000n - args.placedRaw;
  const reserve = budgetReserveRaw(args);
  let amount = cap < reserve ? cap : reserve;
  if (args.freeRaw < amount) amount = args.freeRaw;
  if (args.topUp) {
    const day = (args.earnedRaw * BigInt(BUDGET_RULE.dailyTopUpBps)) / 10_000n - args.dayTopUpsRaw;
    if (day < amount) amount = day;
  }
  return amount >= BUDGET_RULE.minStepRaw ? amount : 0n;
}

/** A day's top-ups, from the record of each: the ones within the day before `now` (unix seconds). */
export function dayTopUpsRaw(topUps: readonly Readonly<{ at: number; raw: string }>[], now: number): bigint {
  return topUps.filter((row) => row.at > now - BUDGET_RULE.dayBeforeSeconds).reduce((total, row) => total + BigInt(row.raw), 0n);
}

/* ------------------------------------------------------------ the risk limits */

export const BUDGET_RISKS = ["DROP", "CREATOR_SOLD", "LOW_SOL"] as const;
/** Why a pass does nothing on a budget's ladder: the two nodes' prices apart, no second node to check against, a gap in the reads. */
export type BudgetDataProblem = "DIVERGED" | "NO_SECOND_NODE" | "STALE";
export type BudgetRisk = (typeof BUDGET_RISKS)[number];

/** One read of the price by the executor, unix seconds: the pair currency per token. */
export type PriceSeen = Readonly<{ at: number; price: number }>;

export type RiskRead = Readonly<{
  /** The data are good enough to act on in this pass. */
  act: boolean;
  /** Why not: the two nodes' prices apart, no second node, or a gap in the reads. */
  data: BudgetDataProblem | null;
  /** The limits that hold now and stop new money into the steps; empty when none. */
  risks: readonly BudgetRisk[];
}>;

/**
 * The risk limits on a market's budget now. `price` and `second` — the price read now from the executor's
 * node and from a second one (null when the second gave none: the price cannot be checked, nothing is done);
 * `seen` — the executor's earlier reads; `creatorSoldAt` — a sale from the creator's wallet, unix seconds.
 */
export function budgetRisk(args: Readonly<{
  price: number;
  second: number | null;
  seen: readonly PriceSeen[];
  now: number;
  launchedAt: number;
  creatorSoldAt: number | null;
  lamports: bigint;
}>): RiskRead {
  const risks: BudgetRisk[] = [];
  if (args.creatorSoldAt !== null && args.creatorSoldAt - args.launchedAt <= BUDGET_RULE.creatorSaleWindowSeconds) risks.push("CREATOR_SOLD");
  if (args.lamports < BUDGET_RULE.executorMinLamports) risks.push("LOW_SOL");
  const hour = args.seen.filter((row) => row.at >= args.now - BUDGET_RULE.dropWindowSeconds && row.at <= args.now);
  const high = Math.max(args.price, ...hour.map((row) => row.price));
  if (high > 0 && args.price < high * (1 - BUDGET_RULE.dropStopBps / 10_000)) risks.push("DROP");
  if (args.second === null) return { act: false, data: "NO_SECOND_NODE", risks };
  if (!(args.second > 0) || !(args.price > 0)) return { act: false, data: "DIVERGED", risks };
  const apart = Math.abs(args.price - args.second) / Math.min(args.price, args.second);
  if (apart > BUDGET_RULE.divergenceBps / 10_000) return { act: false, data: "DIVERGED", risks };
  const last = args.seen.filter((row) => row.at < args.now).at(-1);
  if (last && args.now - last.at > BUDGET_RULE.observationMaxAgeSeconds) return { act: false, data: "STALE", risks };
  return { act: true, data: null, risks };
}

/** The reads kept for the risk limits: an hour of them, at most one a minute apart is not needed — the newest 90. */
export function addPriceSeen(seen: readonly PriceSeen[], at: number, price: number): PriceSeen[] {
  return [...seen.filter((row) => row.at >= at - BUDGET_RULE.dropWindowSeconds && row.at < at), { at, price }].slice(-90);
}

/** Whether the budget is exhausted: placed once, the steps hold none of the pair currency, and the reserve is below a step. */
export function budgetExhausted(args: Readonly<{ placedRaw: bigint; stepsPairRaw: bigint | null; reserveRaw: bigint }>): boolean {
  return args.placedRaw > 0n && args.stepsPairRaw !== null && args.stepsPairRaw <= 1_000n && args.reserveRaw < BUDGET_RULE.minStepRaw;
}

/* ------------------------------------------------------------ Ryntra's revenue on the wallet */

/**
 * Ryntra's revenue still on the executor's wallet, carried from pass to pass: what was left at the last pass, plus the
 * revenue the claims brought since; when the wallet beyond the markets' reserves and the money owed back to steps being
 * moved holds less than that, the difference left the wallet — the operator's sweep — and the revenue is what remains.
 * Money the operator puts on the wallet for a Classic ladder never becomes revenue, and the budgets are never part of it.
 */
export function revenueLeftRaw(args: Readonly<{ prevLeftRaw: bigint; prevClaimedRaw: bigint; claimedRaw: bigint; walletPairRaw: bigint; reservesRaw: bigint; owedRaw: bigint }>): bigint {
  const grown = args.claimedRaw > args.prevClaimedRaw ? args.claimedRaw - args.prevClaimedRaw : 0n;
  const left = args.prevLeftRaw + grown;
  const beyond = args.walletPairRaw - args.reservesRaw - args.owedRaw;
  const bound = beyond > 0n ? beyond : 0n;
  return left < bound ? left : bound;
}

/**
 * What of the executor's wallet a ladder may put into its steps: the wallet less the other budget markets' reserves,
 * the money owed back to every market's steps being moved and Ryntra's revenue still on it — a budget market's own
 * reserve stays its own (`ownReserveRaw`); the operator's Classic ladder passes 0 and so never touches a budget.
 */
export function walletFreeRaw(args: Readonly<{ walletPairRaw: bigint; reservesRaw: bigint; ownReserveRaw: bigint; owedRaw: bigint; revenueLeftRaw: bigint }>): bigint {
  const free = args.walletPairRaw - (args.reservesRaw - args.ownReserveRaw) - args.owedRaw - args.revenueLeftRaw;
  return free > 0n ? free : 0n;
}

/**
 * Whether to tell the operator now: above the alert's threshold, and either never told since it last stood below it or
 * grown by another threshold since the last word.
 */
export function revenueAlertDue(args: Readonly<{ onWalletRaw: bigint; lastAlertRaw: bigint | null }>): boolean {
  if (args.onWalletRaw <= BUDGET_RULE.revenueAlertRaw) return false;
  return args.lastAlertRaw === null || args.onWalletRaw >= args.lastAlertRaw + BUDGET_RULE.revenueAlertRaw;
}

/* ------------------------------------------------------------ what waits in Meteora's pools */

/** The partner's fees on one launch that wait unclaimed in Meteora's programs, raw in the pair currency. */
export type PartnerInPool = Readonly<{
  curveRaw: bigint;
  /** The partner's migration fee while not withdrawn; 0 once withdrawn or before the curve graduates. */
  migrationRaw: bigint;
  /** The partner's share of the surplus by Meteora's formula while not withdrawn; 0 when none. */
  surplusRaw: bigint;
  /** The locked position's fees in the pair currency; null when the position was not read. */
  lpRaw: bigint | null;
}>;

/** The budget's part of what waits in the pools — as the claims would split it. */
export function inPoolBudget(read: PartnerInPool): Readonly<{ budgetRaw: bigint; bySource: Readonly<Record<BudgetSource, bigint>> }> {
  const bySource: Record<BudgetSource, bigint> = {
    migration: splitClaim("migration", read.migrationRaw).budgetRaw,
    surplus: splitClaim("surplus", read.surplusRaw).budgetRaw,
    curve: splitClaim("curve", read.curveRaw).budgetRaw,
    lp: splitClaim("lp", read.lpRaw ?? 0n).budgetRaw,
  };
  return { budgetRaw: BUDGET_SOURCES.reduce((total, source) => total + bySource[source], 0n), bySource };
}

/** Meteora's surplus formula: the reserve above the threshold, 80 % to partner and creator, the creator's share of it by its trading percentage. */
export function partnerSurplusRaw(args: Readonly<{ reserveRaw: bigint; thresholdRaw: bigint; creatorPct: number }>): bigint {
  const total = args.reserveRaw - args.thresholdRaw;
  if (total <= 0n) return 0n;
  const both = (total * 80n) / 100n;
  return both - (both * BigInt(args.creatorPct)) / 100n;
}

/** Meteora's migration fee for the partner: the threshold less the pool's amount (rounded up), less the creator's part. */
export function partnerMigrationFeeRaw(args: Readonly<{ thresholdRaw: bigint; feePct: number; creatorPct: number }>): bigint {
  const kept = (args.thresholdRaw * BigInt(100 - args.feePct) + 99n) / 100n;
  const fee = args.thresholdRaw - kept;
  return fee - (fee * BigInt(args.creatorPct)) / 100n;
}
