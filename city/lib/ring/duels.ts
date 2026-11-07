import { create } from 'zustand';
import type { Archetype } from '../../../lib/ring/contract.ts';
import type { DuelView } from '../../../lib/ring/duel/service.ts';
import { randomId } from '../quarter/ids.ts';
import { duelsOpen, RING_DUELS_OPEN } from './flag.ts';

/**
 * The Ring's duels in the city (CITY-51): the Arena's «Ring» door opens one window — pick a format, start a duel,
 * watch it round by round, replay it. Behind its own switch (`NEXT_PUBLIC_RYNTRA_CITY_RING_DUELS`), on top of the
 * Ring's; both closed by default, so the door is not shown and `/api/ring/fight` answers 404.
 *
 * Who plays: your agent, when this browser has read your garage, against a house sparring partner (practice — nothing
 * rated); without an agent, two house partners (an exhibition). No money anywhere: no entry, no stake, no prize.
 */

export { duelsOpen, RING_DUELS_OPEN };

export type DuelFormat = DuelView['format'];
export const DUEL_FORMATS: readonly DuelFormat[] = ['duo-crack', 'market-replay'];

/** The house partners of each format: the first stands in for you without an agent, the second is always across. */
export const HOUSE: Readonly<Record<DuelFormat, readonly [string, string]>> = {
  'duo-crack': ['wall', 'chatty'],
  'market-replay': ['trend', 'holder'],
};

/** The body each house partner wears. */
export const HOUSE_BODY: Readonly<Record<string, Archetype>> = { wall: 'guardian', chatty: 'host', trend: 'tactician', holder: 'engineer' };

/** How long the window waits between reads of a live duel. */
export const POLL_MS = 900;
/** How fast a replay shows the rounds again. */
export const REPLAY_MS = 650;

export type DuelsState = {
  open: boolean;
  format: DuelFormat;
  duel: DuelView | null;
  /** Rounds shown: all of them, or fewer while a replay plays them again. */
  shown: number | null;
  starting: boolean;
  error: 'offline' | 'signIn' | 'limit' | 'noKey' | 'market' | 'wrong' | null;
  details: boolean;
  /** This start's Idempotency-Key: the same while it is retried. */
  key: string;
  show: () => void;
  close: () => void;
  setFormat: (format: DuelFormat) => void;
  start: (agent: string | null) => Promise<void>;
  read: () => Promise<void>;
  replay: () => void;
  toggleDetails: () => void;
};

const ERRORS: Readonly<Record<string, DuelsState['error']>> = {
  SIGN_IN: 'signIn',
  RATE_LIMITED: 'limit',
  NO_KEY: 'noKey',
  MARKET_UNAVAILABLE: 'market',
};

let poll: ReturnType<typeof setTimeout> | null = null;
let replayTimer: ReturnType<typeof setInterval> | null = null;

function stopTimers() {
  if (poll) clearTimeout(poll);
  if (replayTimer) clearInterval(replayTimer);
  poll = null;
  replayTimer = null;
}

export const useDuels = create<DuelsState>((set, get) => ({
  open: false,
  format: 'duo-crack',
  duel: null,
  shown: null,
  starting: false,
  error: null,
  details: false,
  key: randomId(),
  show: () => set({ open: true }),
  close: () => {
    stopTimers();
    set({ open: false, details: false, shown: null });
  },
  setFormat: (format) => {
    if (get().format === format) return;
    stopTimers();
    set({ format, duel: null, shown: null, error: null, details: false, key: randomId() });
  },
  async start(agent) {
    const { format, key, starting } = get();
    if (starting) return;
    stopTimers();
    set({ starting: true, error: null, details: false, shown: null });
    const [stand, across] = HOUSE[format];
    try {
      const res = await fetch('/api/ring/fight', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify({ format, agent: agent ?? stand, opponent: across }),
      });
      const body = (await res.json().catch(() => null)) as { duel?: DuelView; error?: { code?: string } } | null;
      if (!res.ok || !body?.duel) {
        set({ starting: false, error: ERRORS[body?.error?.code ?? ''] ?? 'wrong' });
        return;
      }
      set({ starting: false, duel: body.duel, key: randomId() });
      schedule(get);
    } catch {
      set({ starting: false, error: 'offline' });
    }
  },
  async read() {
    const duel = get().duel;
    if (!duel) return;
    try {
      const res = await fetch(`/api/ring/duel?id=${encodeURIComponent(duel.id)}`, { cache: 'no-store' });
      const body = (await res.json().catch(() => null)) as { duel?: DuelView } | null;
      if (res.ok && body?.duel && get().duel?.id === duel.id) set({ duel: body.duel });
    } catch {
      // The next read tries again.
    }
    schedule(get);
  },
  replay() {
    const duel = get().duel;
    if (!duel || duel.status === 'live') return;
    stopTimers();
    set({ shown: 0 });
    replayTimer = setInterval(() => {
      const { shown, duel: now } = get();
      const total = now?.duel.rounds.length ?? 0;
      if (shown === null || shown >= total) {
        stopTimers();
        set({ shown: null });
        return;
      }
      set({ shown: shown + 1 });
    }, REPLAY_MS);
  },
  toggleDetails: () => set({ details: !get().details }),
}));

function schedule(get: () => DuelsState) {
  if (poll) clearTimeout(poll);
  poll = null;
  const { open, duel } = get();
  if (!open || !duel || duel.status !== 'live') return;
  poll = setTimeout(() => void get().read(), POLL_MS);
}

export function toggleDuels(): void {
  const st = useDuels.getState();
  if (st.open) st.close();
  else st.show();
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __duels: useDuels });
