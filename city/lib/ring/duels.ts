import { create } from 'zustand';
import type { Archetype } from '../../../lib/ring/contract.ts';
import type { DuelView } from '../../../lib/ring/duel/service.ts';
import { randomId } from '../quarter/ids.ts';
import { duelsOpen, RING_DUELS_OPEN } from './flag.ts';

/**
 * The Ring's duels in the city (CITY-51): the Fight tab of the Arena's window (`arena.ts`, CITY-217) — pick a format,
 * start a duel, watch it round by round, replay it. Behind its own switch (`NEXT_PUBLIC_RYNTRA_CITY_RING_DUELS`), on
 * top of the Ring's; both closed by default, so `/api/ring/fight` answers 404.
 *
 * Who plays: your agent against a house sparring partner (practice — nothing rated), or against a rival the server
 * draws from other owners of your class (rated, CITY-217); without an agent, two house partners (an exhibition).
 * Before the first fight the window shows the latest duels anyone may watch. No money anywhere: no entry, no stake, no
 * prize.
 */

export { duelsOpen, RING_DUELS_OPEN };

export type DuelFormat = DuelView['format'];
export const DUEL_FORMATS: readonly DuelFormat[] = ['duo-crack', 'market-replay'];

/** Against the house (nothing rated), or against a rival of your class (rated). */
export type DuelMode = 'practice' | 'rated';

/** The opponent that asks the server for a rival (`lib/ring/duel/service.ts`). */
export const RIVAL = 'rival';

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
  mode: DuelMode;
  duel: DuelView | null;
  /** The latest duels anyone may watch: what the stage shows before a fight. */
  recent: { status: 'idle' | 'reading' | 'read' | 'failed'; duels: DuelView[] };
  /** The formats the server can play now (Market Replay only where it has real candles). */
  formats: readonly DuelFormat[];
  /** Rounds shown: all of them, or fewer while a replay plays them again. */
  shown: number | null;
  starting: boolean;
  error: 'offline' | 'signIn' | 'limit' | 'noKey' | 'market' | 'noRival' | 'dailyCap' | 'format' | 'wrong' | null;
  details: boolean;
  /** This start's Idempotency-Key: the same while it is retried. */
  key: string;
  show: () => void;
  close: () => void;
  setFormat: (format: DuelFormat) => void;
  setMode: (mode: DuelMode) => void;
  start: (agent: string | null) => Promise<void>;
  read: () => Promise<void>;
  readRecent: () => Promise<void>;
  /** One of the latest duels on the stage: watched to its end when live, replayed when over. */
  watch: (duel: DuelView) => void;
  /** Back to the empty stage, ready for a new fight. */
  clear: () => void;
  replay: () => void;
  toggleDetails: () => void;
};

const ERRORS: Readonly<Record<string, DuelsState['error']>> = {
  SIGN_IN: 'signIn',
  RATE_LIMITED: 'limit',
  NO_KEY: 'noKey',
  MARKET_UNAVAILABLE: 'market',
  NO_RIVAL: 'noRival',
  DAILY_CAP: 'dailyCap',
  FORMAT: 'format',
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
  mode: 'practice',
  duel: null,
  recent: { status: 'idle', duels: [] },
  formats: DUEL_FORMATS,
  shown: null,
  starting: false,
  error: null,
  details: false,
  key: randomId(),
  show: () => {
    set({ open: true });
    // A live duel left on the stage goes on being read; the latest are read again for the empty stage.
    schedule(get);
    void get().readRecent();
  },
  close: () => {
    stopTimers();
    set({ open: false, details: false, shown: null });
  },
  setFormat: (format) => {
    if (get().format === format) return;
    stopTimers();
    set({ format, duel: null, shown: null, error: null, details: false, key: randomId() });
  },
  setMode: (mode) => {
    if (get().mode === mode) return;
    // A finished fight leaves the stage: the corners show who meets whom in the mode just picked.
    const live = get().duel?.status === 'live';
    if (!live) stopTimers();
    set({ mode, error: null, key: randomId(), ...(live ? {} : { duel: null, shown: null, details: false }) });
    if (!live) void get().readRecent();
  },
  async start(agent) {
    const { format, key, starting, mode } = get();
    if (starting) return;
    stopTimers();
    set({ starting: true, error: null, details: false, shown: null });
    const [stand, across] = HOUSE[format];
    const opponent = agent && mode === 'rated' ? RIVAL : across;
    try {
      const res = await fetch('/api/ring/fight', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify({ format, agent: agent ?? stand, opponent }),
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
  async readRecent() {
    const before = get().recent;
    if (before.status !== 'read') set({ recent: { ...before, status: 'reading' } });
    try {
      const res = await fetch('/api/ring/duels', { cache: 'no-store' });
      const body = (await res.json().catch(() => null)) as { duels?: DuelView[]; formats?: unknown } | null;
      if (!res.ok || !Array.isArray(body?.duels)) throw new Error('unread');
      const formats = Array.isArray(body.formats) ? DUEL_FORMATS.filter((f) => (body.formats as unknown[]).includes(f)) : DUEL_FORMATS;
      set({ recent: { status: 'read', duels: body.duels }, formats: formats.length ? formats : DUEL_FORMATS });
      if (!get().formats.includes(get().format) && !get().duel) get().setFormat(get().formats[0]!);
    } catch {
      set({ recent: { ...get().recent, status: before.status === 'read' ? 'read' : 'failed' } });
    }
  },
  watch(duel) {
    stopTimers();
    set({ format: duel.format, duel, shown: null, error: null, details: false, key: randomId() });
    if (duel.status === 'live') schedule(get);
    else get().replay();
  },
  clear() {
    stopTimers();
    set({ duel: null, shown: null, error: null, details: false, key: randomId() });
    void get().readRecent();
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
