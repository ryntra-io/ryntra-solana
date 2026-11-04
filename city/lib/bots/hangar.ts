import { KIND_FACTS } from './kinds.ts';
import { draftIssues, type BotDraft } from './draft.ts';
import type { Bar } from './path.ts';
import { simulate, tradesOf, type Fill, type Run } from './sim.ts';

/**
 * The person's practice bots: their settings, when each started and when it was paused, kept in this browser; what one
 * did is its paper run over the market since its start. The bots a wallet really runs are the engine's Hangar
 * (`lib/bots/hangar/**`, read in `chain.ts`); these never touch it.
 */

export type Span = readonly [start: number, end: number | null];

export type PaperBot = Readonly<{
  id: string;
  draft: BotDraft;
  createdAt: number;
  /** Running spans; empty for a bot whose setup was not finished. */
  spans: readonly Span[];
  /** Stopped by the person: kept, with its record. */
  stoppedAt: number | null;
  /** The saved strategy it runs, if any. */
  strategyId: string | null;
  mode: 'paper';
}>;

/**
 * - `running`, `paused`, `stopped` — as the person left it;
 * - `incomplete` — kept but never started, or its settings no longer pass (a start left half-way);
 * - `orphaned` — its coin left the city, or the strategy it runs was deleted: nothing new to run on.
 */
export type BotStatus = 'running' | 'paused' | 'stopped' | 'incomplete' | 'orphaned';

export const startedAt = (bot: PaperBot): number | null => bot.spans[0]?.[0] ?? null;

export const isActiveAt = (bot: PaperBot, t: number): boolean => bot.spans.some(([start, end]) => t >= start && (end === null || t < end));

export function statusOf(bot: PaperBot, context: Readonly<{ mints: ReadonlySet<string> | null; strategies: ReadonlySet<string> }>): BotStatus {
  if (bot.stoppedAt !== null) return 'stopped';
  if (!bot.spans.length || draftIssues(bot.draft).length) return 'incomplete';
  if ((context.mints && !context.mints.has(bot.draft.pair.mint)) || (bot.strategyId !== null && !context.strategies.has(bot.strategyId))) return 'orphaned';
  const last = bot.spans[bot.spans.length - 1]!;
  return last[1] === null ? 'running' : 'paused';
}

export function start(bot: PaperBot, now: number): PaperBot {
  if (bot.stoppedAt !== null || draftIssues(bot.draft).length) return bot;
  const last = bot.spans[bot.spans.length - 1];
  if (last && last[1] === null) return bot;
  return { ...bot, spans: [...bot.spans, [now, null]] };
}

export function pause(bot: PaperBot, now: number): PaperBot {
  const last = bot.spans[bot.spans.length - 1];
  if (!last || last[1] !== null) return bot;
  return { ...bot, spans: [...bot.spans.slice(0, -1), [last[0], Math.max(last[0], now)]] };
}

export function stop(bot: PaperBot, now: number): PaperBot {
  if (bot.stoppedAt !== null) return bot;
  return { ...pause(bot, now), stoppedAt: now };
}

/** What the bot did on the bars since it started, paused hours left out. */
export function runOf(bot: PaperBot, bars: readonly Bar[]): Run | null {
  const from = startedAt(bot);
  if (from === null) return null;
  return simulate(
    bot.draft,
    bars.filter((b) => b.t >= from - 3_600_000),
    { active: (t) => bot.spans.some(([s, e]) => t >= s - 3_600_000 && (e === null || t < e)) },
  );
}

export const lastFill = (run: Run | null): Fill | null => {
  const trades = run ? tradesOf(run) : [];
  return trades.length ? trades[trades.length - 1]! : null;
};

/** The bot's controls, and whether each works now. On paper no money sits anywhere: cancel and withdraw say so. */
export type Control = 'pause' | 'resume' | 'cancelOrders' | 'withdrawAll' | 'finish' | 'stop';

export function controlsOf(bot: PaperBot, status: BotStatus): readonly Readonly<{ id: Control; enabled: boolean }>[] {
  const money = bot.mode !== 'paper';
  const chain = KIND_FACTS[bot.draft.kind].drive !== 'tap';
  if (status === 'stopped') return [];
  if (status === 'incomplete') return [{ id: 'finish', enabled: true }, { id: 'stop', enabled: true }];
  return [
    status === 'paused' ? { id: 'resume', enabled: status === 'paused' } : { id: 'pause', enabled: status === 'running' },
    ...(chain ? [{ id: 'cancelOrders' as const, enabled: money }] : []),
    { id: 'withdrawAll', enabled: money },
    { id: 'stop', enabled: true },
  ];
}

/** Bots in the order the hangar lists them: the ones that need the person first, then running, paused, stopped. */
const ORDER: Readonly<Record<BotStatus, number>> = { orphaned: 0, incomplete: 1, running: 2, paused: 3, stopped: 4 };

export function sortBots<T extends Readonly<{ bot: PaperBot; status: BotStatus }>>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.bot.createdAt - a.bot.createdAt);
}
