import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { wordsNow } from '../i18n/dict.ts';
import { crews, type CrewClient } from './crew.ts';
import { arrivalsStore } from './district.ts';
import { randomId } from './ids.ts';
import { quarterStore } from './store.ts';
import { isWorldError, type CrewColour, type CrewStreet, type GiftRequest, type MyCrew } from './types.ts';
import { CREW_WORDS } from './words.ts';

/**
 * My crew in the city (CITY-20): whether I am in one, every crew street on the terrace, the one sheet that makes,
 * joins, invites to and leaves a crew, and an invite that came in by a link. A step that moves my quarter (make, join,
 * leave) reads my place and the terrace again, so the camera and the street follow at once.
 */

/** Which face of the sheet is up: my crew, a new one, a code to type, or the street behind an invite. */
export type CrewView = 'home' | 'create' | 'code' | 'invite';

export type CrewState = {
  /** No crews in this build, not read yet, in none, in one, or the world could not be reached. */
  status: 'off' | 'unread' | 'none' | 'member' | 'offline';
  crew: MyCrew | null;
  streets: CrewStreet[];
  /** The sheet, when it is up. */
  view: CrewView | null;
  /** An invite that came in by a link or a typed code, and the street behind it once read. */
  invite: { code: string; street: CrewStreet | null; state: 'reading' | 'ok' | 'gone' } | null;
  busy: boolean;
  /** One short line about the last step that did not go. */
  error: string | null;
  /** The invite link was just copied or shared. */
  shared: boolean;
  read: () => Promise<void>;
  readStreets: () => Promise<void>;
  open: (view?: CrewView) => void;
  close: () => void;
  create: (name: string, colour: CrewColour) => Promise<boolean>;
  /** Reads the street behind a code, then shows it with its one action. */
  peek: (code: string) => Promise<void>;
  join: (code: string) => Promise<boolean>;
  leave: () => Promise<boolean>;
  gift: (input: GiftRequest) => Promise<boolean>;
  markShared: () => void;
};

export type CrewOptions = { client?: () => CrewClient | null; newKey?: () => string; retryMs?: number };

/** A refusal's reason or code, and the key of its one line in `CREW_WORDS`. */
const LINES: Readonly<Record<string, keyof (typeof CREW_WORDS)['en']>> = {
  name: 'name',
  full: 'full',
  in_crew: 'inCrew',
  not_in_crew: 'notInCrew',
  today: 'today',
  points: 'points',
  module: 'module',
  NOT_FOUND: 'notFound',
  NO_RESIDENT: 'noResident',
  RATE_LIMITED: 'rateLimited',
};

/** The one line a refusal shows, in the language on screen; anything unexpected is the city being out of reach, said plainly. */
export function crewLine(e: unknown): string {
  const w = wordsNow(CREW_WORDS);
  if (!isWorldError(e)) return w.unreachable;
  const key = (e.reason && LINES[e.reason]) || LINES[e.code];
  return key ? w[key] : w.unreachable;
}

const worthRetry = (e: unknown) => isWorldError(e) && (e.status === 0 || e.status >= 500);
const pause = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

export function createCrewStore(options: CrewOptions = {}) {
  const client = options.client ?? crews;
  const newKey = options.newKey ?? randomId;
  const retryMs = options.retryMs ?? 700;

  /** A write that met no answer is tried once more with the same key; a refusal is final. */
  const write = async <T>(run: (c: CrewClient, key: string) => Promise<T>): Promise<T> => {
    const c = client();
    if (!c) throw new Error('crews are closed');
    const key = newKey();
    try {
      return await run(c, key);
    } catch (e) {
      if (!worthRetry(e)) throw e;
      await pause(retryMs);
      return run(c, key);
    }
  };

  /** My quarter moved: my place and the terrace are read again. */
  const moved = async () => {
    await quarterStore.getState().reload();
    void arrivalsStore.getState().read(true);
  };

  return createStore<CrewState>()((set, get) => ({
    status: client() ? 'unread' : 'off',
    crew: null,
    streets: [],
    view: null,
    invite: null,
    busy: false,
    error: null,
    shared: false,

    async read() {
      const c = client();
      if (!c) return set({ status: 'off' });
      try {
        const crew = await c.mine();
        set({ crew, status: crew ? 'member' : 'none' });
      } catch {
        if (get().status === 'unread') set({ status: 'offline' });
      }
      await get().readStreets();
    },

    async readStreets() {
      const c = client();
      if (!c) return;
      try {
        set({ streets: await c.streets() });
      } catch {
        // The streets read stay on the terrace; the next read tries again.
      }
    },

    open(view) {
      if (get().status === 'off') return;
      set({ view: view ?? (get().crew ? 'home' : 'create'), error: null, shared: false });
    },

    close() {
      set({ view: null, error: null, shared: false, ...(get().view === 'invite' ? { invite: null } : {}) });
    },

    async create(name, colour) {
      if (get().busy) return false;
      set({ busy: true, error: null });
      try {
        const done = await write((c, key) => c.create({ name, colour }, key));
        set({ crew: done.crew, status: 'member', busy: false, view: 'home', invite: null });
        await Promise.all([moved(), get().readStreets()]);
        return true;
      } catch (e) {
        set({ busy: false, error: crewLine(e) });
        return false;
      }
    },

    async peek(code) {
      const c = client();
      if (!c) return;
      set({ invite: { code, street: null, state: 'reading' }, view: 'invite', error: null });
      try {
        const street = await c.invite(code);
        if (get().invite?.code === code) set({ invite: { code, street, state: 'ok' } });
      } catch (e) {
        if (get().invite?.code === code) set({ invite: { code, street: null, state: 'gone' }, error: crewLine(e) });
      }
    },

    async join(code) {
      if (get().busy) return false;
      set({ busy: true, error: null });
      try {
        const done = await write((c, key) => c.join(code, key));
        set({ crew: done.crew, status: 'member', busy: false, view: 'home', invite: null });
        await Promise.all([moved(), get().readStreets()]);
        return true;
      } catch (e) {
        set({ busy: false, error: crewLine(e) });
        return false;
      }
    },

    async leave() {
      if (get().busy) return false;
      set({ busy: true, error: null });
      try {
        await write((c, key) => c.leave(key));
        set({ crew: null, status: 'none', busy: false, view: null });
        await Promise.all([moved(), get().readStreets()]);
        return true;
      } catch (e) {
        set({ busy: false, error: crewLine(e) });
        return false;
      }
    },

    async gift(input) {
      if (get().busy) return false;
      set({ busy: true, error: null });
      try {
        const done = await write((c, key) => c.gift(input, key));
        set({ crew: done.crew, busy: false });
        void get().readStreets();
        return true;
      } catch (e) {
        set({ busy: false, error: crewLine(e) });
        return false;
      }
    },

    markShared() {
      set({ shared: true });
    },
  }));
}

export type CrewStore = ReturnType<typeof createCrewStore>;

export const crewStore: CrewStore = createCrewStore();

export function useCrew<T>(pick: (state: CrewState) => T): T {
  return useStore(crewStore, pick);
}

// Development hook: lets the screenshot scripts follow a crew's flow.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __crew: crewStore });
