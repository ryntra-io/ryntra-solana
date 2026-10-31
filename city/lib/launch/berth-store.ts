import { create } from 'zustand';
import type { LaunchClaimReviewResponse, LaunchCreatorCabinetResponse } from '../../../lib/api/v1/contract.ts';
import { graduationOf, httpBerthEngine, type BerthEngine } from './berth.ts';
import { launchEngine, useLaunch } from './district.ts';

/**
 * «Мій причал» as a window of the city: whether it is open and on which launch, and what the engine last said about the
 * connected wallet's launches. Reads only — the cabinet, a launch's graduation mark, the claim's Review; the claim itself
 * runs in the window (`berth-flow.ts`), which holds the window open while a signature is out.
 */

export type Graduation = Readonly<{ at: number; signature: string }>;

type BerthState = {
  open: boolean;
  /** The launch asked for: a tower's own «Мій причал». */
  focus: string | null;
  /** The launch on screen, once the person picked one. */
  picked: string | null;
  /** A claim is mid-way: the window does not close under the signature. */
  busy: boolean;
  /** The wallet the cabinet was read for, and the cabinet: null before the first answer. */
  wallet: string | null;
  cabinet: LaunchCreatorCabinetResponse | null;
  status: 'idle' | 'reading' | 'ready' | 'failed';
  reviews: Readonly<Record<string, LaunchClaimReviewResponse | null>>;
  graduations: Readonly<Record<string, Graduation | null>>;
  show: (focus?: string | null) => void;
  close: () => void;
  pick: (token: string) => void;
  setBusy: (busy: boolean) => void;
};

export const useBerth = create<BerthState>((set, get) => ({
  open: false,
  focus: null,
  picked: null,
  busy: false,
  wallet: null,
  cabinet: null,
  status: 'idle',
  reviews: {},
  graduations: {},
  show: (focus = null) => {
    /* One panel at a time: the launch sheet gives way, unless a launch is under way in it. */
    const launch = useLaunch.getState();
    if (launch.sheet && (!launch.phase || launch.phase.step === 'done' || launch.phase.step === 'failed')) launch.closeSheet();
    set({ open: true, focus, picked: focus ?? get().picked });
  },
  close: () => (get().busy ? undefined : set({ open: false, focus: null })),
  pick: (picked) => (get().busy ? undefined : set({ picked })),
  setBusy: (busy) => set({ busy }),
}));

/** Open «Мій причал», on a launch when one is asked for. */
export function openBerth(focus?: string | null): void {
  useBerth.getState().show(focus ?? null);
}

/* ---------------------------------------------------------------- the engine */

let engine: Promise<BerthEngine> | null = null;
const loadStub = process.env.NODE_ENV === 'production' ? null : () => import('./berth-stub.ts');

/**
 * The engine's cabinet and claim routes: over HTTP, or the stand-in's beside the stub engine (development builds only).
 * A load that fails is let go, so the next read asks again.
 */
export function berthEngine(): Promise<BerthEngine> {
  if (engine) return engine;
  const made =
    useLaunch.getState().stub && loadStub
      ? loadStub().then((stub) => stub.stubBerthEngine({ engine: launchEngine(), delayMs: 450 }))
      : Promise.resolve(httpBerthEngine());
  engine = made;
  made.catch(() => {
    if (engine === made) engine = null;
  });
  return made;
}

/* ---------------------------------------------------------------- reads */

let readSeq = 0;

/** The wallet's launches as the engine reads them now. Another wallet clears the last one's figures first. */
export async function readCabinet(wallet: string): Promise<void> {
  const seq = ++readSeq;
  const before = useBerth.getState();
  if (before.wallet !== wallet) useBerth.setState({ wallet, cabinet: null, reviews: {}, graduations: {}, picked: before.focus });
  useBerth.setState({ status: useBerth.getState().cabinet ? 'ready' : 'reading' });
  const source = await berthEngine().catch(() => null);
  const answer = await source?.cabinet(wallet);
  if (seq !== readSeq) return;
  if (answer?.ok) useBerth.setState({ cabinet: answer.data, status: 'ready' });
  else useBerth.setState((st) => ({ status: st.cabinet ? 'ready' : 'failed' }));
}

/** A launch's own reads: where its move to the DEX rests on the chain, and what «Забрати» takes now. */
export async function readLaunch(token: string, wallet: string, need: Readonly<{ graduation: boolean; review: boolean }>): Promise<void> {
  const source = await berthEngine().catch(() => null);
  if (!source) return;
  const [market, review] = await Promise.all([need.graduation ? source.market(token) : null, need.review ? source.review(token, wallet) : null]);
  if (useBerth.getState().wallet !== wallet) return;
  useBerth.setState((st) => ({
    ...(need.graduation ? { graduations: { ...st.graduations, [token]: market?.ok ? graduationOf(market.data) : null } } : {}),
    ...(need.review ? { reviews: { ...st.reviews, [token]: review?.ok ? review.data : null } } : {}),
  }));
}

/* The berth's store for the development stand's shots (`berth-shots.mjs`); never in a production bundle. */
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __berth: useBerth });
