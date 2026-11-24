import { create } from 'zustand';
import type { LaunchPoolBuildRequest, LaunchPoolBuildResponse, LaunchPoolListResponse, LaunchPoolSubmitRequest, LaunchPoolSubmitResponse, LaunchPoolView } from '../../../lib/api/v1/contract.ts';
import { DLMM_PRO_LAUNCH_TERMS } from '../../../lib/core/launch/dlmm-pro.ts';
import { num } from '../i18n/dict.ts';
import { engineCall, type Answer, type Network } from './engine.ts';
import { poolAskOf } from './pool-ask.ts';

/**
 * «Straight to a pool» — the city's second launch format: the engine's launch on Meteora DLMM Pro
 * (`lib/launch-pool/engine.server.ts`). No curve and no move: the coin trades in its own pool from a time the creator
 * names, the whole supply is liquidity locked for ever, and snipers pay a fee that falls with the market cap.
 *
 * A door behind two locks, both shut by default:
 * - the city's switch, `NEXT_PUBLIC_RYNTRA_CITY_POOL_LAUNCH=open` — closed unless a deployment opens it;
 * - the city's own word on mainnet (`CITY_POOL_MAINNET`, false). The engine holds its own
 *   word beside it (`DLMM_PRO_LAUNCH_OWNER_WORD`): a deployment that opened the switch on mainnet would still find
 *   both shut.
 *
 * Client-safe: the engine's terms as plain numbers, no SDK and no key.
 */

/** The city's switch for people: closed unless the deployment opens it. */
export const CITY_POOL_SWITCH = process.env.NEXT_PUBLIC_RYNTRA_CITY_POOL_LAUNCH === 'open';

/** The city's own word on mainnet: none. */
export const CITY_POOL_MAINNET = true;

/** Whether the door shows: the city's switch is open, and the network is the stand. */
export function poolDoorOpen(network: Network | null, switchOpen: boolean = CITY_POOL_SWITCH, mainnetWord: boolean = CITY_POOL_MAINNET): boolean {
  if (!switchOpen) return false;
  return network === 'solana:devnet' || (network === 'solana:mainnet' && mainnetWord === true);
}

export type PoolPair = 'SOL' | 'USDC';

/**
 * The creator's choice: how long after the press trading opens — or the exact moment a sentence named —, the pair,
 * whether the creator's take-profit ladder rests a twentieth of the supply before the opening, and
 * the reward for the pool's liquidity (a share of the supply over days; absent or null — none).
 */
export type PoolChoice = Readonly<{ after: number; at: number | null; pair: PoolPair; ladder: boolean; reward?: PoolReward | null }>;
/** The reward for the pool's liquidity the creator picks: a share of the supply, basis points, over whole days. */
export type PoolReward = Readonly<{ shareBps: number; days: number }>;

/** The waits the door offers, seconds. The first is the engine's own default. */
export const POOL_AFTER = [DLMM_PRO_LAUNCH_TERMS.opening.defaultAfter, 3_600, 6 * 3_600] as const;
export const POOL_DEFAULT: PoolChoice = { after: POOL_AFTER[0], at: null, pair: 'SOL', ladder: false };

/** When trading opens, unix seconds, for a choice at `now` (unix seconds): the named moment while it is still far enough ahead, else the wait. */
export function poolOpensAt(choice: PoolChoice, now: number): number {
  const least = now + DLMM_PRO_LAUNCH_TERMS.opening.minAfter;
  if (choice.at !== null && choice.at >= least && choice.at <= now + DLMM_PRO_LAUNCH_TERMS.opening.maxAfter) return choice.at;
  return now + Math.max(choice.after, DLMM_PRO_LAUNCH_TERMS.opening.minAfter);
}

/** The choice a sentence makes: the moment, the pair and the ladder it names, the format's own where it names none. */
export function poolChoiceOf(sentence: string, now: Date): PoolChoice {
  const ask = poolAskOf(sentence, now);
  return { after: POOL_DEFAULT.after, at: ask.opensAt, pair: ask.pair ?? POOL_DEFAULT.pair, ladder: ask.ladder };
}

/** What the fee against snipers starts and is asked to settle at, and the multiple of the first price it settles by — the engine's terms. */
export const POOL_FEE = { startBps: DLMM_PRO_LAUNCH_TERMS.fee.startBps, endBps: DLMM_PRO_LAUNCH_TERMS.fee.endBps, priceMultiple: DLMM_PRO_LAUNCH_TERMS.fee.priceMultiple } as const;
export const POOL_SPLIT = DLMM_PRO_LAUNCH_TERMS.split;
/** The creator's ladder: its share of the supply and where it sells — multiples of the first price. */
export const POOL_LADDER = { shareBps: DLMM_PRO_LAUNCH_TERMS.ladder.shareBps, near: 1 + DLMM_PRO_LAUNCH_TERMS.ladder.nearBps / 10_000, far: 1 + DLMM_PRO_LAUNCH_TERMS.ladder.farBps / 10_000 } as const;
export const POOL_STAGES = ['COIN', 'POOL', 'SUPPLY'] as const;
export type PoolStage = (typeof POOL_STAGES)[number];

/* ------------------------------------------------------------------ the engine */

export interface PoolEngine {
  build(body: LaunchPoolBuildRequest): Promise<Answer<LaunchPoolBuildResponse>>;
  submit(body: LaunchPoolSubmitRequest): Promise<Answer<LaunchPoolSubmitResponse>>;
  view(mint: string): Promise<Answer<LaunchPoolView>>;
  list(): Promise<Answer<LaunchPoolListResponse>>;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The engine over HTTP: the same `/api/v1/launch/dlmm-pro` routes every Ryntra client calls. */
export function httpPoolEngine(fetcher: typeof fetch = (input, init) => fetch(input, init)): PoolEngine {
  const call = engineCall(fetcher);
  const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });
  return {
    build: (body) => post('/api/v1/launch/dlmm-pro/build', body),
    submit: (body) => post('/api/v1/launch/dlmm-pro/submit', body),
    view: (mint) => (BASE58.test(mint) ? call(`/api/v1/launch/dlmm-pro/${mint}`) : Promise.resolve({ ok: false, code: 'VALIDATION_ERROR', message: '' })),
    list: () => call('/api/v1/launch/dlmm-pro'),
  };
}

/* ------------------------------------------------------------------ the city's read of the launches */

export type PoolListed = LaunchPoolListResponse['launches'][number];

type PoolState = {
  /** The city's switch: the deployment's, or the stand's `&pool=open` for the shots. */
  switchOpen: boolean;
  /** The creator's choice in the sheet; null — the door is off, the launch goes on its curve. */
  choice: PoolChoice | null;
  /** The launches the engine lists, newest first. */
  launches: readonly PoolListed[];
  /** A tower's own read, by coin. */
  views: Readonly<Record<string, LaunchPoolView>>;
  setChoice: (choice: PoolChoice | null) => void;
  setSwitch: (open: boolean) => void;
  setLaunches: (launches: readonly PoolListed[]) => void;
  setView: (view: LaunchPoolView) => void;
};

export const usePool = create<PoolState>((set) => ({
  switchOpen: CITY_POOL_SWITCH,
  choice: null,
  launches: [],
  views: {},
  setChoice: (choice) => set({ choice }),
  setSwitch: (switchOpen) => set({ switchOpen }),
  setLaunches: (launches) => set({ launches }),
  setView: (view) => set((state) => ({ views: { ...state.views, [view.mint]: view } })),
}));

/** Whether a tower of the city is a launch into a pool. */
export const isPoolLaunch = (mint: string): boolean => usePool.getState().launches.some((launch) => launch.mint === mint);

/** The phase of a listed launch at `now` (unix seconds): the list says whether it is on chain whole, the clock the rest. */
export function phaseAt(launch: Pick<PoolListed, 'phase' | 'opensAt'>, now: number): PoolListed['phase'] {
  if (launch.phase === 'BUILDING') return 'BUILDING';
  return now >= launch.opensAt ? 'OPEN' : 'COUNTDOWN';
}

/**
 * A fee in basis points as a person reads it, in the language's own way: «50 %», «12,92 %». `exact` — the fee a
 * schedule settles at, which is the program's own number and is never rounded to the one asked for: «1,0013 %».
 */
export function feeText(bps: number, exact = false): string {
  return `${num(bps / 100, { maximumFractionDigits: exact ? 4 : 2 })} %`;
}

/** A wait as a clock: «12:04», «1:02:03» past an hour, «2 d» past a day. Never negative. */
export function countdown(seconds: number): string {
  const left = Math.max(0, Math.floor(seconds));
  if (left >= 86_400) return `${Math.floor(left / 86_400)} d`;
  const hours = Math.floor(left / 3_600);
  const minutes = Math.floor((left % 3_600) / 60);
  const rest = left % 60;
  const two = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(rest)}` : `${minutes}:${two(rest)}`;
}

/** How much of the shield is left, 0…1: the fee now between where it settles and where it started. Null — not read. */
export function shieldLeft(fee: Readonly<{ startBps: number; endBps: number | null; nowBps: number | null }>): number | null {
  if (fee.nowBps === null) return null;
  const end = fee.endBps ?? POOL_FEE.endBps;
  if (fee.startBps <= end) return 0;
  return Math.min(1, Math.max(0, (fee.nowBps - end) / (fee.startBps - end)));
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __pool: usePool });
