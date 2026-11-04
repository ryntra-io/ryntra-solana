import { create } from 'zustand';
import { browserFetch, type FetchLike } from '../money/engine.ts';
import { askCheck, readInput, type WardCheckResponse } from './check.ts';

/**
 * The Guard window (CITY-152): whether it is open, what was pasted, what the agent said, and the engine's answer. One
 * check at a time; a new paste clears the last verdict, so a verdict on screen is always the verdict of what is in the
 * field.
 */

export type GuardPhase = 'idle' | 'checking' | 'done' | 'failed';

/** Why a check gave no verdict, in the window's own words: the input, or the engine. */
export type GuardFailure = 'unreadable' | 'busy' | 'offline';

type GuardWindow = {
  open: boolean;
  text: string;
  intent: string;
  /** Whether the line for the agent's intent is shown. */
  intentOpen: boolean;
  phase: GuardPhase;
  result: WardCheckResponse | null;
  failure: GuardFailure | null;
  show: () => void;
  close: () => void;
  setText: (text: string) => void;
  setIntent: (intent: string) => void;
  toggleIntent: () => void;
  /** Ask the engine about what is in the field. `signer` — the wallet on screen, for a link it would pay. */
  check: (signer?: string | null) => Promise<void>;
  reset: () => void;
};

let fetchImpl: FetchLike = browserFetch;
let inflight: AbortController | null = null;

/** Swap what the window reaches: for tests, and nothing else. */
export function setGuardFetch(next: FetchLike): void {
  fetchImpl = next;
}

export const useGuard = create<GuardWindow>((set, get) => ({
  open: false,
  text: '',
  intent: '',
  intentOpen: false,
  phase: 'idle',
  result: null,
  failure: null,
  show: () => set({ open: true }),
  close: () => {
    inflight?.abort();
    inflight = null;
    set({ open: false, phase: get().phase === 'checking' ? 'idle' : get().phase });
  },
  setText: (text) => set({ text, ...(get().phase === 'checking' ? {} : { phase: 'idle', result: null, failure: null }) }),
  setIntent: (intent) => set({ intent, ...(get().phase === 'done' ? { phase: 'idle', result: null } : {}) }),
  toggleIntent: () => set({ intentOpen: !get().intentOpen }),
  check: async (signer) => {
    const input = readInput(get().text);
    if (!input) return;
    inflight?.abort();
    const controller = new AbortController();
    inflight = controller;
    set({ phase: 'checking', result: null, failure: null });
    const answer = await askCheck(fetchImpl, { input, intentText: get().intentOpen ? get().intent : undefined, signer }, controller.signal);
    if (inflight !== controller) return;
    inflight = null;
    if (answer.ok) return set({ phase: 'done', result: answer.value });
    const failure: GuardFailure =
      answer.failure.code === 'VALIDATION_ERROR' ? 'unreadable' : answer.failure.code === 'RATE_LIMITED' ? 'busy' : 'offline';
    set({ phase: 'failed', failure });
  },
  reset: () => {
    inflight?.abort();
    inflight = null;
    set({ text: '', intent: '', phase: 'idle', result: null, failure: null });
  },
}));

export function openGuard(): void {
  useGuard.getState().show();
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __guard: useGuard });
