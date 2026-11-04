import { earlyPick, launchFactsFrom, planText, type StrategyPlan } from '../../../lib/mandate/plans.ts';
import type { BudgetPresetId } from '../../../lib/mandate/presets.ts';
import type { RunResult } from '../../../lib/mandate/backtest.ts';

/**
 * CITY-193 — the card's two reads for a strategy: its run on the coin's history or on paper since a moment
 * (`GET /api/bots/mandate/test`), and an early plan's launch picked from the city's Pulse through the same filter the
 * agent's book checks again on the server. Pure but for the fetcher handed in.
 */

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const isRun = (value: unknown): value is RunResult => typeof value === 'object' && value !== null && typeof (value as RunResult).bars === 'number' && typeof (value as RunResult).buys === 'number';

/** The plan run on the coin's candles — on history, or since `since` on paper; null when the coin has none the city reads. */
export async function readRun(input: Readonly<{ coin: string; plan: StrategyPlan; preset: BudgetPresetId; since?: number | null; bornAt?: number | null }>, fetcher: Fetcher = (url, init) => fetch(url, init)): Promise<RunResult | null> {
  const query = new URLSearchParams({ coin: input.coin, plan: planText(input.plan), preset: input.preset });
  if (input.since) query.set('since', String(input.since));
  if (input.bornAt) query.set('born', String(input.bornAt));
  try {
    const response = await fetcher(`/api/bots/mandate/test?${query}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as { result?: unknown };
    return isRun(body.result) ? body.result : null;
  } catch {
    return null;
  }
}

/** An early plan's launch: the new ones the city's Pulse reads, through the same filter the agent's book checks again. */
export async function pickLaunch(maxAgeH: number, fetcher: Fetcher = (url, init) => fetch(url, init), now: number = Date.now()): Promise<Readonly<{ mint: string; symbol: string; icon: string | null; bornAt: number }> | null> {
  try {
    const response = await fetcher('/api/spot/pulse?feed=new&mode=meme&window=h1', { cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as { rows?: unknown };
    const rows = Array.isArray(body.rows) ? body.rows.filter((row): row is Parameters<typeof launchFactsFrom>[0] & { icon?: string | null } => typeof row === 'object' && row !== null && typeof (row as { mint?: unknown }).mint === 'string') : [];
    const picked = earlyPick(rows.map((row) => ({ ...launchFactsFrom(row), icon: typeof row.icon === 'string' ? row.icon : null })), now, maxAgeH);
    return picked ? { mint: picked.mint, symbol: picked.symbol, icon: picked.icon, bornAt: Date.parse(picked.firstPoolAt!) } : null;
  } catch {
    return null;
  }
}
