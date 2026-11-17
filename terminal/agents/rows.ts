import type { EngineMandate } from '../../city/lib/bots/agents.ts';
import type { MandateRecord, MandateStatus } from '../../city/lib/bots/mandate.ts';
import { agentSymbol, resultRaw } from '../../city/lib/autopilot/report.ts';
import type { AgentView } from '../../city/lib/autopilot/store.ts';
import type { Role } from '../../city/lib/crew/read.ts';
import type { CareRow } from '../../city/lib/earn/care.ts';
import type { PilotView } from '../../lib/pilot/view.ts';
import { daysLeft } from './figures.ts';

/**
 * «My agents»: the agents at work for the connected wallet, each one row, from what the engine answers — every trader's
 * mandate and its book, the autopilot's plan, the pools the keeper looks after. A row says only what was read; nothing
 * is filled in for a figure the engine did not give. Each row carries what its «Stop» needs: the mandate it takes back,
 * or the pool. Pure.
 */

export type RowState = 'working' | 'paused' | 'frozen' | 'confirming' | 'done' | 'stopped';

export type MineRow = Readonly<{
  key: string;
  role: Exclude<Role, 'launcher'>;
  /** The trader's coin; null — not named by the book yet, or the row has none. */
  coin: Readonly<{ mint: string; symbol: string }> | null;
  /** The keeper's pool today: earning in its range, or being moved back around the price. */
  pool: 'earning' | 'moving' | null;
  /** Days the mandate has left; null — no end date. */
  daysLeft: number | null;
  state: RowState;
  /** The day's budget and what the last day spent of it; null — the agent has no budget of its own. */
  budget: Readonly<{ perDayRaw: string; spentRaw: string | null }> | null;
  /** Trades of the last day; null — not counted for this agent. */
  trades: number | null;
  /** The result: lamports (the trader's whole mandate, the keeper's day) or dollars (the autopilot's week). */
  result: Readonly<{ raw: string }> | Readonly<{ usd: number }> | null;
  span: 'all' | 'week' | 'day';
  /** The last day's own result in lamports, for «Today» over the screen; null — not read or no trade. */
  dayRaw: string | null;
  /** What «Stop» takes back: the mandate (the trader's, the autopilot's), or the keeper's pool; null — nothing from here. */
  stop: Readonly<{ record: MandateRecord }> | Readonly<{ care: string }> | null;
}>;

/** The mandate still stands on chain: «Stop» still means something (the city's own rule for its card). */
export function mandateLive(record: MandateRecord | null, status: MandateStatus | undefined, view: Pick<AgentView, 'status'> | null): boolean {
  return Boolean(record && (status?.active ?? true) && view?.status !== 'stopped');
}

/** The trader's state in one word, from the engine's mission; an engine of before — from the book's state. */
export function traderState(view: Pick<AgentView, 'status' | 'mission' | 'frozen'> | null): RowState {
  if (!view) return 'working';
  const mission = view.mission?.state;
  if (mission === 'confirming') return 'confirming';
  if (mission === 'frozen' || view.frozen === true) return 'frozen';
  if (mission === 'paused' || (!mission && view.status === 'paused')) return 'paused';
  if (mission === 'stopped' || (!mission && view.status === 'stopped')) return 'stopped';
  if (mission === 'done' || (!mission && view.status !== 'working')) return 'done';
  return 'working';
}

/** One trader's row from its mandate, its standing and its book; null when the mandate no longer stands. */
export function traderRow(record: MandateRecord, status: MandateStatus | undefined, view: AgentView | null, now: number): MineRow | null {
  if (!mandateLive(record, status, view)) return null;
  const traded = view !== null && view.result.trades > 0;
  const whole = view === null || !traded ? null : view.net ? view.net.netRaw : view.result.earnedRaw;
  const day = view?.day ?? null;
  return {
    key: `trader:${record.policy}`,
    role: 'trader',
    coin: view ? { mint: view.receiveMint, symbol: agentSymbol(view) } : null,
    pool: null,
    daysLeft: daysLeft(record.expiresAt, now),
    state: traderState(view),
    budget: { perDayRaw: record.perDay, spentRaw: day ? day.spentRaw : null },
    trades: day ? day.trades : null,
    result: whole === null ? null : { raw: whole },
    span: 'all',
    dayRaw: day && day.trades > 0 ? resultRaw(day) : null,
    stop: { record },
  };
}

export type TradersInput = Readonly<{
  /** The mandate this browser keeps for the wallet, and what the chain said of it. */
  local: Readonly<{ record: MandateRecord; status: MandateStatus | undefined }> | null;
  /** The wallet's mandates on this network as the engine answered; null — not answered. */
  engine: readonly Pick<EngineMandate, 'record' | 'active' | 'live' | 'pilot' | 'budgetLamports'>[] | null;
  /** The autopilot's mandate: never a trader's row. */
  pilotPolicy: string | null;
  /** Each trader's book, by its policy. */
  views: Readonly<Record<string, AgentView>>;
}>;

/** The mandates that are traders: still standing, not the autopilot's — from the engine, and this browser's own beside it. */
export function traderRecords(input: Omit<TradersInput, 'views'>): Array<Readonly<{ record: MandateRecord; status: MandateStatus | undefined }>> {
  const pilotOf = (policy: string) => policy === input.pilotPolicy || (input.engine ?? []).some((m) => m.pilot && m.record.policy === policy);
  const out: Array<Readonly<{ record: MandateRecord; status: MandateStatus | undefined }>> = (input.engine ?? [])
    .filter((m) => !m.pilot && m.record.policy !== input.pilotPolicy && (m.active || m.live === true))
    .map((m) => ({ record: m.record, status: { active: true, budgetLamports: m.budgetLamports } }));
  // A mandate signed here that has not reached the engine's book yet still stands on chain: its row stays.
  const local = input.local;
  if (local && !pilotOf(local.record.policy) && !(input.engine ?? []).some((m) => m.record.policy === local.record.policy)) out.push(local);
  return out;
}

export function traderRows(input: TradersInput, now: number): MineRow[] {
  return traderRecords(input)
    .map((one) => traderRow(one.record, one.status, input.views[one.record.policy] ?? null, now))
    .filter((row): row is MineRow => row !== null);
}

/** The autopilot's row while its plan is at work: its week in dollars, as its own book counts it; «Stop» — its mandate. */
export function pilotRow(view: Pick<PilotView, 'status' | 'held' | 'care' | 'policy'> | null, record: MandateRecord | null): MineRow | null {
  if (!view || view.status !== 'working') return null;
  const week = view.care?.weekUsd;
  return {
    key: 'pilot',
    role: 'pilot',
    coin: null,
    pool: null,
    daysLeft: null,
    state: view.held ? 'paused' : 'working',
    budget: null,
    trades: null,
    result: typeof week === 'number' && Number.isFinite(week) ? { usd: week } : null,
    span: 'week',
    dayRaw: null,
    stop: record && view.policy && record.policy === view.policy ? { record } : null,
  };
}

/** The autopilot's mandate: the engine's for its policy, else this browser's when it is the same. */
export function pilotRecord(policy: string | null, engine: readonly Pick<EngineMandate, 'record'>[] | null, local: MandateRecord | null): MandateRecord | null {
  if (!policy) return null;
  return (engine ?? []).find((m) => m.record.policy === policy)?.record ?? (local?.policy === policy ? local : null);
}

/** The pools the keeper looks after now: what each claimed and put back today, in SOL. */
export function keeperRows(cares: readonly CareRow[] | null): MineRow[] {
  return (cares ?? [])
    .filter((care) => care.status === 'working')
    .map((care) => {
      const sol = care.day.claimedInY + care.day.reinvestedInY;
      const raw = Number.isFinite(sol) && sol > 0 ? BigInt(Math.floor(sol * 1e9)).toString() : null;
      return {
        key: `keeper:${care.key}`,
        role: 'keeper' as const,
        coin: null,
        pool: care.inRange === false ? ('moving' as const) : ('earning' as const),
        daysLeft: null,
        state: 'working' as const,
        budget: null,
        trades: null,
        result: raw === null ? null : { raw },
        span: 'day' as const,
        dayRaw: raw,
        stop: { care: care.key },
      };
    });
}

/** «Today» over the screen: the trades of the last day and their result in lamports — each null when no row read it. */
export function todayOf(rows: readonly MineRow[]): Readonly<{ trades: number | null; raw: string | null }> {
  const counted = rows.map((row) => row.trades).filter((n): n is number => n !== null);
  const read = rows.map((row) => row.dayRaw).filter((raw): raw is string => raw !== null);
  return { trades: counted.length ? counted.reduce((sum, n) => sum + n, 0) : null, raw: read.length ? read.reduce((sum, raw) => sum + BigInt(raw), 0n).toString() : null };
}

/** The roles with an agent at work, for the cards' state. */
export function workingRoles(rows: readonly MineRow[]): Readonly<Record<Role, boolean>> {
  const at = (role: Role) => rows.some((row) => row.role === role);
  return { trader: at('trader'), pilot: at('pilot'), keeper: at('keeper'), launcher: false };
}

export type CardState = 'hire' | 'chosen' | 'working' | 'soon';

/**
 * What an agent's card says: at work for this wallet; shut on this deployment or waiting for its shelf — «coming»; the
 * one the new agent's panel shows — «chosen»; else «hire».
 */
export function cardState(role: Role, open: Readonly<Record<Role, boolean>>, working: Readonly<Record<Role, boolean>>, chosen: Role | null): CardState {
  if (working[role]) return 'working';
  if (!open[role]) return 'soon';
  return chosen === role ? 'chosen' : 'hire';
}

/* ---------------------------------------------------------------- history */

export type HistoryRow = Readonly<{ key: string; at: number; what: 'bought' | 'confirming' | 'failed' | 'skipped' | 'held'; spentRaw: string | null; signature: string | null }>;

/** The traders' last trades as their books keep them, newest first: each by what it really is. */
export function tradeHistory(views: readonly (Pick<AgentView, 'last'> | null)[]): HistoryRow[] {
  return views
    .flatMap((view, at) => (view?.last ?? []).map((trade, index) => ({ trade, key: `${at}:${trade.at}:${index}` })))
    .sort((a, b) => b.trade.at - a.trade.at)
    .map(({ trade, key }) => {
      const state = trade.state ?? (trade.ok ? 'ok' : 'failed');
      const what = state === 'ok' ? 'bought' : state === 'unknown' ? 'confirming' : state === 'refused' ? 'skipped' : state === 'held' ? 'held' : 'failed';
      return { key, at: trade.at, what, spentRaw: what === 'bought' && trade.spentRaw !== '0' ? trade.spentRaw : null, signature: trade.signature };
    });
}

export type PastRow = Readonly<{ key: string; createdAt: number; trades: number; state: RowState }>;

/** The wallet's trader mandates that are over — stopped, ended or spent, standing no more — newest first. */
export function pastAgents(mandates: readonly Pick<EngineMandate, 'record' | 'status' | 'trades' | 'createdAt' | 'pilot' | 'active' | 'live'>[]): PastRow[] {
  return mandates
    .filter((mandate) => !mandate.pilot && !mandate.active && mandate.live !== true && (mandate.status === 'stopped' || mandate.status === 'ended' || mandate.status === 'spent'))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((mandate) => ({ key: mandate.record.policy, createdAt: mandate.createdAt, trades: mandate.trades, state: mandate.status === 'stopped' ? ('stopped' as const) : ('done' as const) }));
}
