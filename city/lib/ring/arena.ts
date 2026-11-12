import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { AgentView, BoardRow } from '../../../lib/ring/contract.ts';
import type { DuelView } from '../../../lib/ring/duel/service.ts';
import { httpRing, RingClientError, type RingClient } from './client.ts';
import { RING_DUELS_OPEN, useDuels } from './duels.ts';
import { ringStore } from './store.ts';

/**
 * The Arena's Ring window (CITY-217): three tabs over one window — «Fight», «Agent», «Rating». Opened by the Arena's
 * «Ring» door and by the Agents' «Hangar». It reads the person's own agents once it opens (`/api/ring/mine`), so the
 * fight knows whose agent stands in the left corner without a visit to a garage; a first agent is made right here, in
 * the account's own garage in the Arena (no quarter, no level first); the board of a format comes from
 * `/api/ring/board`. No money anywhere: no entry, no stake, no prize.
 */

export type ArenaTab = 'fight' | 'agent' | 'board';
export type BoardFormat = DuelView['format'];

export type MineRead = {
  status: 'idle' | 'reading' | 'read' | 'failed';
  signedIn: boolean;
  agents: AgentView[];
  bay: { quarter: string; slot: number } | null;
};

export type BoardRead = { status: 'idle' | 'reading' | 'read' | 'failed'; rows: BoardRow[] };

export type ArenaState = {
  open: boolean;
  tab: ArenaTab;
  mine: MineRead;
  boards: Record<BoardFormat, BoardRead>;
  /** The wallet's sign-in is on its way. */
  signing: boolean;
  show: (tab?: ArenaTab) => void;
  close: () => void;
  setTab: (tab: ArenaTab) => void;
  readMine: () => Promise<void>;
  readBoard: (format: BoardFormat) => Promise<void>;
  /** Connect and sign in with the wallet, then read «my agent» again. True once signed in. */
  signIn: () => Promise<boolean>;
  /** The making screen in the account's garage in the Arena — after a sign-in, when it is needed. */
  makeAgent: () => Promise<void>;
};

export type ArenaDeps = {
  client?: () => RingClient;
  /** The city's wallet sign-in (`cityAccount.begin`); true when it went all the way. */
  signIn?: () => Promise<boolean>;
  /**
   * Whether the duels' own switch is open (`RING_DUELS_OPEN`). Closed, the window has no Fight tab and reads no duels:
   * `/api/ring/duels` would only answer 404 (review 8.11).
   */
  duelsOpen?: () => boolean;
};

const EMPTY_MINE: MineRead = { status: 'idle', signedIn: false, agents: [], bay: null };
const EMPTY_BOARD: BoardRead = { status: 'idle', rows: [] };

/** The person's agent that fights: the first active one (the Arena's garage, or the oldest of the quarter's). */
export function fighterOf(mine: MineRead): AgentView | null {
  return mine.agents.find((agent) => agent.status === 'active') ?? null;
}

/**
 * What the Ring's one button asks of a person who is not signed in (CITY-239). A wallet that is already connected is
 * not asked to «Connect wallet» again: what is left is the sign-in message, and the button says so — the same sign-in
 * the wallet's own panel offers (`cityAccount.begin`). With no wallet connected the words are as they were.
 */
export type EntryWord = 'connect' | 'connecting' | 'signIn' | 'checkWallet';

export function entryWord(connected: boolean, signing: boolean): EntryWord {
  if (connected) return signing ? 'checkWallet' : 'signIn';
  return signing ? 'connecting' : 'connect';
}

export function createArenaStore(deps: ArenaDeps = {}) {
  const client = deps.client ?? (() => httpRing);
  const duelsOn = deps.duelsOpen ?? (() => RING_DUELS_OPEN);
  let reading: Promise<void> | null = null;
  let again = false;

  return createStore<ArenaState>()((set, get) => ({
    open: false,
    tab: 'fight',
    mine: EMPTY_MINE,
    boards: { 'duo-crack': EMPTY_BOARD, 'market-replay': EMPTY_BOARD },
    signing: false,

    show(tab) {
      set({ open: true, ...(tab ? { tab } : {}) });
      if (duelsOn()) useDuels.getState().show();
      void get().readMine();
    },

    close() {
      set({ open: false });
      useDuels.getState().close();
      const ring = ringStore.getState();
      if (ring.editor?.quarterId === get().mine.bay?.quarter) ring.closeEditor();
    },

    setTab(tab) {
      if (get().tab !== tab) set({ tab });
    },

    readMine() {
      // One read at a time; an ask while one is out (a sign-in just landed) reads once more after it.
      if (reading) {
        again = true;
        return reading;
      }
      reading = (async () => {
        do {
          again = false;
          const before = get().mine;
          if (before.status !== 'read') set({ mine: { ...before, status: 'reading' } });
          try {
            const read = await client().mine();
            set({ mine: { status: 'read', signedIn: read.signedIn, agents: read.agents, bay: read.bay } });
          } catch (error) {
            // A Ring that answers 404 is closed: nothing to show, nothing to retry.
            const closed = error instanceof RingClientError && error.code === 'CLOSED';
            set({ mine: closed ? { ...EMPTY_MINE, status: 'read' } : { ...get().mine, status: before.status === 'read' ? 'read' : 'failed' } });
          }
        } while (again);
      })().finally(() => {
        reading = null;
      });
      return reading;
    },

    async readBoard(format) {
      const before = get().boards[format];
      if (before.status !== 'read') set({ boards: { ...get().boards, [format]: { ...before, status: 'reading' } } });
      try {
        const read = await client().board(format);
        set({ boards: { ...get().boards, [format]: { status: 'read', rows: read.rows } } });
      } catch {
        set({ boards: { ...get().boards, [format]: { ...get().boards[format], status: before.status === 'read' ? 'read' : 'failed' } } });
      }
    },

    async signIn() {
      if (get().signing) return false;
      set({ signing: true });
      try {
        const ok = (await deps.signIn?.().catch(() => false)) ?? false;
        // A «no» in the wallet, or a sign-in that failed, changed nothing: the button says «Sign in» again at once
        // (CITY-240 — it stayed «Check your wallet», switched off, for as long as «my agent» took to answer). The read
        // still goes, behind the button: a sign-in that landed another way is seen.
        if (!ok) {
          set({ signing: false });
          void get().readMine();
          return false;
        }
        await get().readMine();
        return get().mine.signedIn;
      } finally {
        set({ signing: false });
      }
    },

    async makeAgent() {
      if (!get().mine.signedIn && !(await get().signIn())) return;
      if (!get().mine.bay) await get().readMine();
      const { bay } = get().mine;
      if (!bay || fighterOf(get().mine)) return;
      set({ tab: 'agent' });
      ringStore.getState().openEditor(bay.quarter, bay.slot);
    },
  }));
}

export type ArenaStore = ReturnType<typeof createArenaStore>;

/** The city's own Arena: signs in through the city's account, loaded only when the button is pressed. */
export const arenaStore = createArenaStore({
  signIn: async () => {
    const { cityAccount } = await import('../quarter/account-live.ts');
    return cityAccount.getState().begin(null, 'top');
  },
});

// A save or a switch-off in the making screen changes «my agent»: read it again.
ringStore.subscribe((st, before) => {
  if ((before.editor && !st.editor) || (before.offing && !st.offing)) void arenaStore.getState().readMine();
});

export function useArena<T>(pick: (state: ArenaState) => T): T {
  return useStore(arenaStore, pick);
}

/** The Arena's window on a tab: the Ring door opens it on the fight, the Hangar on the agent. */
export function openArena(tab: ArenaTab = 'fight'): void {
  arenaStore.getState().show(tab);
}

export function toggleArena(tab: ArenaTab = 'fight'): void {
  const st = arenaStore.getState();
  if (st.open && st.tab === tab) st.close();
  else st.show(tab);
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __arena: arenaStore });
