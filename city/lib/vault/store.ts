import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { AttemptResponse, PublicEntry, VaultId, VaultState } from '../../../lib/vault/contract.ts';
import { MAX_ATTEMPT_CHARS, charCount } from '../../../lib/vault/size.ts';
import { randomId } from '../quarter/ids.ts';
import { httpVault, VaultClientError, type VaultClient } from './client.ts';

/**
 * The Vault's room, from the door to a crack. Entering reads the vaults as this person sees them and the live feed,
 * and picks the first vault still to crack; an attempt goes out with its own key (a retry of the same text sends the
 * same key, so it is counted once); the answer, the feed and the person's limits all come back in one reply. When a
 * limit is used up the room waits until it resets, then reads the vaults again, so the Try button comes back by itself.
 */

/** The guard's state, as the characters line names it (CITY-57): ready · thinking · acting · done. */
export type GuardianState = 'ready' | 'thinking' | 'acting' | 'done';

export type Phase =
  | { step: 'idle' }
  | { step: 'sending'; text: string; key: string }
  | { step: 'answered'; result: AttemptResponse; at: number }
  | { step: 'refused'; code: string; line: string; retryAfterS: number | null; window?: 'minute' | 'day' | null; text: string; key: string };

export type VaultRoomState = {
  open: boolean;
  vault: VaultId;
  state: VaultState | null;
  status: 'unread' | 'reading' | 'read' | 'offline';
  feed: Partial<Record<VaultId, PublicEntry[]>>;
  draft: string;
  phase: Phase;
  /** A limit is used up: no attempt goes out until it resets and the vaults are read again. */
  limited: boolean;
  /** When the last attempt was sent and when a vault was last cracked (ms, `now`): the tower's pulse and beam. */
  pulseAt: number;
  crackedAt: number;
  enter: (vault?: VaultId) => Promise<void>;
  leave: () => void;
  choose: (vault: VaultId) => void;
  setDraft: (text: string) => void;
  send: () => Promise<void>;
  readFeed: () => Promise<void>;
};

/** The room's clock for waiting out a limit; tests pass their own. */
export type Timers = { set: (run: () => void, ms: number) => unknown; clear: (handle: unknown) => void };

export type VaultStoreOptions = { client?: () => VaultClient; now?: () => number; newKey?: () => string; timers?: Timers };

const browserTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** What the room says when a limit is used up: the server's own words. */
const LIMIT_LINE = { minute: 'Three tries a minute. Catch your breath.', day: "That's today's 25 tries. The vaults reset at midnight UTC." } as const;

/** A moment past the reset, so the server's window has surely moved on when the room reads again. */
const RESET_MARGIN_MS = 500;
/** If reading the vaults again fails, the room tries again after this long. */
const RETRY_READ_MS = 15_000;

/** What the guard is doing now, from the room's phase: an answer plays for a moment, a crack stays done. */
export function guardianOf(phase: Phase, now: number): GuardianState {
  if (phase.step === 'sending') return 'thinking';
  if (phase.step === 'answered') {
    if (phase.result.outcome === 'cracked') return 'done';
    return now - phase.at < 2600 ? 'acting' : 'ready';
  }
  return 'ready';
}

/** The first vault still to crack: the practice levels in order, then the daily one. */
export function firstToCrack(state: VaultState): VaultId {
  return state.vaults.find((v) => v.open && !v.cracked)?.id ?? 'daily';
}

/** The limit a state has used up, and how many seconds until it resets; null while tries are left. */
export function usedUp(state: VaultState | null): { window: 'minute' | 'day'; resetS: number } | null {
  const limits = state?.me.limits;
  if (!limits) return null;
  if (limits.day.left <= 0) return { window: 'day', resetS: Math.max(1, limits.day.resetS) };
  if (limits.minute.left <= 0) return { window: 'minute', resetS: Math.max(1, limits.minute.resetS) };
  return null;
}

export function createVaultStore({ client = () => httpVault, now = () => Date.now(), newKey = randomId, timers = browserTimers }: VaultStoreOptions = {}) {
  return createStore<VaultRoomState>()((set, get) => {
    let wake: unknown = null;
    let until = 0;

    const stopWaiting = () => {
      if (wake !== null) timers.clear(wake);
      wake = null;
    };

    /** Waits `ms`, then reads the vaults again while the room is open. */
    function wakeIn(ms: number) {
      stopWaiting();
      wake = timers.set(() => {
        wake = null;
        if (!get().open) return;
        set({ limited: false });
        void read();
      }, ms);
    }

    /** Takes in the vaults as the server sees them and, if a limit is used up, waits for it to reset. */
    function apply(state: VaultState) {
      const out = usedUp(state);
      set({ state, limited: !!out });
      if (out && get().open) {
        until = now() + out.resetS * 1000;
        wakeIn(out.resetS * 1000 + RESET_MARGIN_MS);
      } else {
        until = 0;
        stopWaiting();
      }
    }

    async function read() {
      set({ status: get().state ? 'read' : 'reading' });
      try {
        const state = await client().state();
        apply(state);
        set({ status: 'read' });
        return state;
      } catch {
        set({ status: get().state ? 'read' : 'offline' });
        if (get().open && get().limited) wakeIn(RETRY_READ_MS);
        return null;
      }
    }

    return {
      open: false,
      vault: 'practice-1',
      state: null,
      status: 'unread',
      feed: {},
      draft: '',
      phase: { step: 'idle' },
      limited: false,
      pulseAt: 0,
      crackedAt: 0,

      async enter(vault) {
        set({ open: true, phase: { step: 'idle' } });
        const state = await read();
        if (!get().open) return;
        const pick = vault && state?.vaults.find((v) => v.id === vault && v.open) ? vault : state ? firstToCrack(state) : get().vault;
        set({ vault: pick });
        await get().readFeed();
      },

      leave() {
        stopWaiting();
        set({ open: false, phase: { step: 'idle' } });
      },

      choose(vault) {
        const view = get().state?.vaults.find((v) => v.id === vault);
        if (!view?.open || get().phase.step === 'sending') return;
        set({ vault, phase: { step: 'idle' } });
        void get().readFeed();
      },

      setDraft(text) {
        // The field holds what one attempt may hold; a paste past the limit is cut where the limit ends.
        set({ draft: charCount(text) > MAX_ATTEMPT_CHARS ? [...text].slice(0, MAX_ATTEMPT_CHARS).join('') : text });
      },

      async send() {
        const { draft, vault, phase } = get();
        const text = draft.trim();
        if (!text || phase.step === 'sending') return;
        // A used-up limit is said here, without a request the server would refuse anyway.
        const out = get().limited ? usedUp(get().state) : null;
        if (out) {
          const left = Math.max(1, Math.ceil((until - now()) / 1000));
          set({ phase: { step: 'refused', code: 'RATE_LIMITED', line: LIMIT_LINE[out.window], retryAfterS: left, window: out.window, text, key: newKey() } });
          return;
        }
        // The same text again after a refusal it may retry is the same attempt: the same key, counted once.
        const key = phase.step === 'refused' && phase.text === text && phase.code === 'OFFLINE' ? phase.key : newKey();
        set({ phase: { step: 'sending', text, key }, pulseAt: now() });
        try {
          const result = await client().attempt(vault, text, key);
          const list = get().feed[vault] ?? [];
          set({
            phase: { step: 'answered', result, at: now() },
            draft: result.outcome === 'cracked' ? '' : get().draft,
            feed: { ...get().feed, [vault]: [result.entry, ...list.filter((e) => e.id !== result.entry.id)].slice(0, 30) },
            ...(result.outcome === 'cracked' ? { crackedAt: now() } : {}),
          });
          apply(result.state);
        } catch (error) {
          const e = error instanceof VaultClientError ? error : new VaultClientError(0, 'OFFLINE', 'No connection. Nothing was counted.');
          set({ phase: { step: 'refused', code: e.code, line: e.message, retryAfterS: e.retryAfterS, window: e.window, text, key } });
          if (e.code === 'RATE_LIMITED' || e.code === 'LOCKED') void read();
        }
      },

      async readFeed() {
        const vault = get().vault;
        try {
          const page = await client().feed(vault);
          // Entries this person just made stay at the top until the server's page has them.
          const mine = (get().feed[vault] ?? []).filter((e) => !page.entries.some((p) => p.id === e.id) && Date.parse(e.at) > Date.parse(page.entries[0]?.at ?? '1970-01-01'));
          set({ feed: { ...get().feed, [vault]: [...mine, ...page.entries].slice(0, 30) } });
        } catch {
          // The feed waits for the next read; the room keeps what it showed.
        }
      },
    };
  });
}

export const vaultStore = createVaultStore();

export function useVault<T>(selector: (state: VaultRoomState) => T): T {
  return useStore(vaultStore, selector);
}
