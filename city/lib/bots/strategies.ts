import type { ExperimentLineage } from '../../../lib/strategy-lab/lineage.ts';
import type { BotDraft } from './draft.ts';

/**
 * «Стратегії» — a bot's settings kept as a strategy with versions and a family tree, on Strategy Lab's lineage
 * (`lib/strategy-lab/lineage.ts`: a root is iteration 1, every change is a child that names its parent, what changed
 * and why — `lineage.ts`, loaded only when a strategy is saved). Nothing here executes: a strategy only fills a draft
 * (Strategy Lab's `execution: false`).
 *
 * A strategy keeps its record whatever it did: closed and losing strategies stay listed, with their drawdown, so the
 * list never shows only the winners. Copying another's settings waits for enough history.
 */

export type StrategyVersion = Readonly<{
  id: string;
  at: number;
  draft: BotDraft;
  lineage: ExperimentLineage;
  /** Why this version: what the person said changed. */
  note: string;
}>;

export type StrategyRecord = Readonly<{
  /** Since the first version, percent. */
  returnPct: number;
  maxDrawdownPct: number;
  /** Days of history the record covers. */
  days: number;
  trades: number;
}>;

export type Strategy = Readonly<{
  id: string;
  name: string;
  owner: 'me' | 'shared';
  /** Who shared it, as they chose to be named. */
  author: string | null;
  createdAt: number;
  closedAt: number | null;
  versions: readonly StrategyVersion[];
  /** Forked from another strategy's version. */
  forkOf: Readonly<{ strategyId: string; versionId: string; name: string }> | null;
  /** The record as its owner's bots ran it; null until it has run. */
  record: StrategyRecord | null;
  /** When its paper twin started: the same settings, run on paper from that day. */
  twinFrom: number | null;
}>;

/** At least this much history before someone else's settings can be copied: one lucky week is not a strategy. */
export const COPY_MIN_DAYS = 14;

export const AGE_BUCKETS = ['week', 'month', 'quarter', 'older'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

const DAY_MS = 86_400_000;

export const ageDays = (strategy: Pick<Strategy, 'createdAt'>, now: number): number => Math.max(0, (now - strategy.createdAt) / DAY_MS);

export function ageBucket(days: number): AgeBucket {
  return days < 7 ? 'week' : days < 30 ? 'month' : days < 90 ? 'quarter' : 'older';
}

export const latest = (strategy: Strategy): StrategyVersion => strategy.versions[strategy.versions.length - 1]!;

/** Days of history counted for copying: the record's own days, never more than the strategy's age. */
export const historyDays = (strategy: Strategy, now: number): number => Math.min(strategy.record?.days ?? 0, ageDays(strategy, now));

export type CopyGate = Readonly<{ ok: true }> | Readonly<{ ok: false; daysLeft: number }>;

/** Your own strategy copies any time; another's once it has `COPY_MIN_DAYS` of history. */
export function copyGate(strategy: Strategy, now: number): CopyGate {
  if (strategy.owner === 'me') return { ok: true };
  const have = historyDays(strategy, now);
  return have >= COPY_MIN_DAYS ? { ok: true } : { ok: false, daysLeft: Math.max(1, Math.ceil(COPY_MIN_DAYS - have)) };
}

/**
 * Oldest bucket first — the most history on top — and inside a bucket by drawdown, smallest first, then by return.
 * Closed strategies stay in their bucket, after the open ones.
 */
export function sortStrategies(list: readonly Strategy[], now: number): Strategy[] {
  const rank = (s: Strategy) => AGE_BUCKETS.length - AGE_BUCKETS.indexOf(ageBucket(ageDays(s, now)));
  return [...list].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Number(a.closedAt !== null) - Number(b.closedAt !== null) ||
      (a.record?.maxDrawdownPct ?? Infinity) - (b.record?.maxDrawdownPct ?? Infinity) ||
      (b.record?.returnPct ?? -Infinity) - (a.record?.returnPct ?? -Infinity) ||
      a.id.localeCompare(b.id),
  );
}

export function groupByAge(list: readonly Strategy[], now: number): Readonly<{ bucket: AgeBucket; strategies: Strategy[] }>[] {
  const sorted = sortStrategies(list, now);
  return [...AGE_BUCKETS]
    .reverse()
    .map((bucket) => ({ bucket, strategies: sorted.filter((s) => ageBucket(ageDays(s, now)) === bucket) }))
    .filter((g) => g.strategies.length);
}

/** Copy settings: a draft of the strategy's latest version that remembers where it came from. */
export function copyDraft(strategy: Strategy): BotDraft {
  const from = latest(strategy);
  return { ...from.draft, copiedFrom: { strategyId: strategy.id, versionId: from.id } };
}

/** Close a strategy of your own: it stays, with its record, marked closed. */
export function closeStrategy(strategy: Strategy, now: number): Strategy {
  return strategy.owner === 'me' && strategy.closedAt === null ? { ...strategy, closedAt: now } : strategy;
}
