import { create } from 'zustand';
import { MANDATE_NET, useMandate, type MandateCoin } from '../bots/mandate.ts';
import { AUTOPILOT_NET } from '../autopilot/flag.ts';
import { readRun } from '../autopilot/runs.ts';
import { calmPlan, type StrategyPlan } from '../../../lib/mandate/plans.ts';
import { DEFAULT_RULES, planData, splitOf, type PilotPlanData, type PilotSplit } from '../../../lib/pilot/plan.ts';
import type { PilotView } from '../../../lib/pilot/view.ts';
import type { Who } from '../bots/mandate-sign.ts';
import type { PilotAsk } from './read.ts';

/**
 * The money autopilot's card (CITY-204): the sentence read into one plan for the whole budget, its parts as one bar,
 * «Practice first» — the trade's rules on the coin's history and the savings at today's rate — and «Go live · sign once»
 * (`./sign.ts`, loaded on the tap). After that, what the agent did with it, read from the autopilot's book while the card
 * shows it (`/api/bots/pilot`): what it earned this week, the shares now, its last holds. «Stop» is the mandate's own stop
 * — one signature; the savings and the pier stay hers, where they are.
 *
 * The switch: `NEXT_PUBLIC_RYNTRA_CITY_PILOT=open`, over the agent's (`NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT`) and the
 * mandate's network. Shut by default.
 */

export const PILOT_OPEN = process.env.NEXT_PUBLIC_RYNTRA_CITY_PILOT?.trim() === 'open' && AUTOPILOT_NET !== null && MANDATE_NET !== null;
export const PILOT_NET: 'devnet' | 'mainnet' = MANDATE_NET ?? 'devnet';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** The practice: the trade's rules on its coin's history, the savings at today's rate over the same days. USD; null — not read. */
export type PilotPaper = Readonly<{ days: number; tradeUsd: number | null; saveUsd: number | null; totalUsd: number | null }>;

export type PilotNote = Readonly<{ kind: 'on' | 'partial' | 'stopped' | 'walletNo' | 'refused' | 'unreachable'; at: number }> | null;

type PilotState = {
  open: boolean;
  ask: PilotAsk | null;
  /** The coin the trade buys: the first named, or the city's pick. */
  coin: MandateCoin | null;
  split: PilotSplit | null;
  plan: PilotPlanData | null;
  solUsd: number | null;
  phase: 'propose' | 'paper' | 'signing' | 'live' | 'stopping';
  paper: PilotPaper | null;
  view: PilotView | null;
  note: PilotNote;
  show: (ask: PilotAsk, solUsd: number | null, fallbackCoin: MandateCoin | null) => void;
  /** The card for the wallet's plan, from «Mine» or on return. */
  showLive: () => void;
  close: () => void;
  setView: (view: PilotView | null) => void;
  reprice: (solUsd: number | null) => void;
};

const wantsOf = (ask: PilotAsk) => ({ solRaw: ask.solRaw ? BigInt(ask.solRaw) : 0n, usdcRaw: ask.usdcRaw ? BigInt(ask.usdcRaw) : 0n, named: ask.named });

function planned(ask: PilotAsk, solUsd: number | null): Pick<PilotState, 'split' | 'plan'> {
  const split = splitOf(wantsOf(ask), PILOT_NET, solUsd);
  return { split, plan: split ? planData(split, DEFAULT_RULES) : null };
}

export const usePilot = create<PilotState>((set, get) => ({
  open: false,
  ask: null,
  coin: null,
  split: null,
  plan: null,
  solUsd: null,
  phase: 'propose',
  paper: null,
  view: null,
  note: null,
  show: (ask, solUsd, fallbackCoin) => {
    const named = ask.coins[0];
    const coin = named ? { mint: named.mint, symbol: named.symbol, icon: named.icon } : fallbackCoin;
    set({ open: true, ask, coin, solUsd, ...planned(ask, solUsd), phase: 'propose', paper: null, note: null });
    if (coin) useMandate.getState().setCoin(coin);
  },
  showLive: () => set({ open: true, phase: 'live', note: null }),
  close: () => set({ open: false }),
  setView: (view) => set({ view, ...(view && view.status === 'working' && get().phase !== 'stopping' ? { phase: 'live' as const } : {}) }),
  reprice: (solUsd) => {
    const ask = get().ask;
    if (!ask || get().phase !== 'propose' || solUsd === get().solUsd) return;
    set({ solUsd, ...planned(ask, solUsd) });
  },
}));

/** The trade's strategy: the one said, at the city's calm pace (CITY-197), or the steady one. */
export const tradePlanOf = (ask: PilotAsk | null): StrategyPlan => calmPlan(ask?.plan ?? { id: 'steady', exit: null });

/** The savings' rates now, per cent a year, from the engine's Earn read; null — not read. */
async function readRates(fetcher: Fetcher): Promise<Readonly<{ usdc: number | null; sol: number | null }>> {
  try {
    const response = await fetcher('/api/solana/earn', { cache: 'no-store' });
    if (!response.ok) return { usdc: null, sol: null };
    const body = (await response.json()) as { providers?: Array<{ provider?: string; ok?: boolean; markets?: Array<{ asset?: { symbol?: string }; rateAnnualPercent?: number | null }> }> };
    const jupiter = body.providers?.find((p) => p.provider === 'jupiter' && p.ok);
    const rate = (symbol: string) => {
      const value = jupiter?.markets?.find((m) => m.asset?.symbol === symbol || (symbol === 'SOL' && m.asset?.symbol === 'WSOL'))?.rateAnnualPercent;
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    };
    return { usdc: rate('USDC'), sol: rate('SOL') };
  } catch {
    return { usdc: null, sol: null };
  }
}

/** «Practice first»: no wallet, no money — the trade's rules on the coin's history, the savings at today's rate over the same days. */
export async function startPaper(fetcher: Fetcher = (url, init) => fetch(url, init)): Promise<void> {
  const st = usePilot.getState();
  if (!st.split || !st.ask) return;
  usePilot.setState({ phase: 'paper', paper: null });
  const price = st.solUsd;
  const trade = st.split.preset && st.coin ? await readRun({ coin: st.coin.mint, plan: tradePlanOf(st.ask), preset: st.split.preset }, fetcher) : null;
  const days = trade ? Math.max(1, Math.round((trade.toMs - trade.fromMs) / 86_400_000)) : 7;
  const rates = await readRates(fetcher);
  const legs = st.split.legs;
  const tradeUsd = st.split.preset === null ? 0 : trade && price !== null ? (trade.heldSol + trade.gotSol - trade.spentSol) * price : null;
  const usdcUsd = Number(legs.save.usdcRaw) / 1e6;
  const solUsd = price === null ? null : (Number(legs.save.solRaw) / 1e9) * price;
  const saveUsd =
    usdcUsd === 0 && (solUsd ?? 0) === 0 ? 0 : rates.usdc === null || solUsd === null || (solUsd > 0 && rates.sol === null) ? null : (usdcUsd * rates.usdc + solUsd * (rates.sol ?? 0)) / 100 * (days / 365);
  const totalUsd = tradeUsd === null || saveUsd === null ? null : Math.round((tradeUsd + saveUsd) * 100) / 100;
  if (usePilot.getState().ask === st.ask) usePilot.setState({ paper: { days, tradeUsd, saveUsd, totalUsd } });
}

/** «Go live · sign once». */
export async function goLive(who: Who): Promise<void> {
  const st = usePilot.getState();
  if (!st.split || !st.plan || !st.ask || st.phase === 'signing') return;
  if (st.plan.preset && PILOT_NET === 'mainnet' && !st.coin) return usePilot.setState({ note: { kind: 'refused', at: Date.now() } });
  usePilot.setState({ phase: 'signing', note: null });
  const sign = await import('./sign.ts');
  const result = await sign.goLive(who, { split: st.split, plan: st.plan, coin: st.coin, tradePlan: tradePlanOf(st.ask), said: st.ask.said, network: PILOT_NET }).catch(() => ({ kind: 'unreachable' as const }));
  if (result.kind === 'on') {
    usePilot.setState({ phase: 'live', note: { kind: result.partial ? 'partial' : 'on', at: Date.now() } });
    await readPilot(who.owner);
  } else usePilot.setState({ phase: 'paper', note: { kind: result.kind, at: Date.now() } });
}

/** «Stop»: the trade's mandate taken back, one signature; the savings and the pier stay hers. */
export async function stopPilot(who: Who): Promise<void> {
  const record = useMandate.getState().records[who.owner];
  const view = usePilot.getState().view;
  if (!record || (view?.policy && view.policy !== record.policy)) return usePilot.setState({ note: { kind: 'refused', at: Date.now() } });
  usePilot.setState({ phase: 'stopping', note: null });
  const { tapStop } = await import('../bots/mandate-sign.ts');
  await tapStop(who, record);
  const said = useMandate.getState().note;
  const stopped = said?.kind === 'stopped';
  usePilot.setState({ phase: 'live', note: { kind: stopped ? 'stopped' : (said?.kind ?? 'refused'), at: Date.now() }, ...(stopped && view ? { view: { ...view, status: 'stopped' as const } } : {}) });
}

/** The wallet's plan from the autopilot's book; null — none, or not read. */
export async function readPilot(owner: string, fetcher: Fetcher = (url, init) => fetch(url, init)): Promise<PilotView | null> {
  try {
    const response = await fetcher(`/api/bots/pilot?owner=${owner}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const value = (await response.json()) as PilotView;
    if (typeof value?.status !== 'string' || typeof value.plan !== 'object') return null;
    usePilot.getState().setView(value);
    return value;
  } catch {
    return null;
  }
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __pilot: usePilot });
