import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { world, type WorldClient } from './client.ts';
import { randomId } from './ids.ts';
import { firstBuildable, moduleById, moduleForKind, refusalLine, verdict, verdictLine } from './modules.ts';
import { openPlots } from './plot.ts';
import { isWorldError, type Building, type BuildingKind, type ChainLink, type ClientErrorCode, type MeResponse, type WorldError } from './types.ts';

/**
 * My quarter, from the first tap to a home on its plot. The city knows whether this visitor has a quarter, flies
 * the camera to it (`arrive`), lets them build (`build`) and comes back (`city`). A building lands the moment it is
 * picked and is saved behind it: if the world refuses, it lifts away and the picker says why in one line.
 * The quarter on screen is its owner's (`setOwner`, from `account.ts`): the wallet signed in to Ryntra; a visitor sees none.
 */

export type Mode = 'city' | 'arrive' | 'build';

/** A building on its way down: what it is, where, and when it was dropped (ms, performance clock). */
export type Landing = { slot: number; kind: BuildingKind; modules: string[]; at: number };

export type QuarterState = {
  /** Not read yet, no quarter, a quarter, or the world could not be reached. */
  status: 'unknown' | 'none' | 'resident' | 'offline';
  me: MeResponse | null;
  mode: Mode;
  /** The plot whose picker is open. */
  slot: number | null;
  /** The building chosen in the open picker. */
  choice: string | null;
  /** Shown at once, saved in the background. */
  landing: Landing | null;
  /** The last landing the world kept, and the points it paid (a day's task done). */
  landed: (Landing & { gained: number }) | null;
  /** One line about the last refused claim or build. */
  error: string | null;
  /** A claim or a build is on its way. */
  busy: boolean;
  /** The visitor put their card off for this visit. */
  later: boolean;
  /**
   * The visitor asked for their card from the dock («Home») this visit: it shows even with the «Arrivals card» switch
   * off (city/lib/feed/settings.ts), until closed again.
   */
  asked: boolean;
  /**
   * Whose quarter is shown: `null` — a visitor (no wallet, or one not signed in), the quarter hidden; a key — the
   * signed-in wallet's account, read from the world; `undefined` — not decided yet (the first read of the session).
   */
  owner: string | null | undefined;
  load: () => Promise<void>;
  /** The account behind the city changed (`account.ts`): a visitor sees none; an account reads its own place again. */
  setOwner: (owner: string | null | undefined) => Promise<void>;
  claim: () => Promise<boolean>;
  enter: () => void;
  arrived: () => void;
  leave: () => void;
  pick: (slot: number | null) => void;
  choose: (id: string) => void;
  place: () => Promise<boolean>;
  /** Shows an engine object on the building of a plot, or takes it off (null). The world checks the object is yours. */
  link: (slot: number, link: ChainLink | null) => Promise<LinkOutcome>;
  /** Reads my place again: after a wallet sign-in the resident may now have an account. */
  reload: () => Promise<void>;
  dismiss: () => void;
};

export type LinkOutcome = { ok: true } | { ok: false; code: ClientErrorCode; reason: WorldError['reason'] };

export type QuarterOptions = {
  client?: () => WorldClient;
  now?: () => number;
  newKey?: () => string;
  /** The pause before the one retry of a write that met no answer. */
  retryMs?: number;
};

const pause = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/** A write that met no answer or a broken server is tried once more with the same key; a refusal is final. */
const worthRetry = (e: unknown) => isWorldError(e) && (e.status === 0 || e.status >= 500);

/** The quarter's buildings with one written: the slot's old building gives way to the new one. */
const withBuilding = (list: readonly Building[], b: Building) => [...list.filter((x) => x.slot !== b.slot), b].sort((x, y) => x.slot - y.slot);

/** Nothing of a quarter on screen: no picker, no landing, back to the city. */
const CLEARED = { me: null, mode: 'city', slot: null, choice: null, landing: null, landed: null, busy: false, error: null } as const;

export function createQuarterStore(options: QuarterOptions = {}) {
  const client = options.client ?? world;
  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const newKey = options.newKey ?? randomId;
  const retryMs = options.retryMs ?? 700;

  const write = async <T>(run: (key: string) => Promise<T>): Promise<T> => {
    const key = newKey();
    try {
      return await run(key);
    } catch (e) {
      if (!worthRetry(e)) throw e;
      await pause(retryMs);
      return run(key);
    }
  };

  let ownerTicket = 0;
  let reading: Promise<void> = Promise.resolve();

  return createStore<QuarterState>()((set, get) => ({
    owner: undefined,
    status: 'unknown',
    me: null,
    mode: 'city',
    slot: null,
    choice: null,
    landing: null,
    landed: null,
    error: null,
    busy: false,
    later: false,
    asked: false,

    async load() {
      const { status } = get();
      if (status === 'none' || status === 'resident') return;
      try {
        const me = await client().me();
        // A claim that finished while this read was on its way wins.
        if (get().status === 'resident') return;
        set({ me, status: me ? 'resident' : 'none' });
      } catch {
        if (get().status === 'unknown') set({ status: 'offline' });
      }
    },

    setOwner(owner) {
      // The same account: whoever asks waits for the read already on its way.
      if (owner === undefined || owner === get().owner) return reading;
      const ticket = ++ownerTicket;
      if (owner === null) {
        set({ ...CLEARED, owner: null, status: 'none' });
        reading = Promise.resolve();
        return reading;
      }
      // Another account's place never stays on screen while this one's is read.
      set({ ...CLEARED, owner, status: get().status === 'unknown' ? 'unknown' : 'none' });
      reading = (async () => {
        try {
          const me = await client().me();
          if (ticket !== ownerTicket) return;
          set({ me, status: me ? 'resident' : 'none' });
        } catch {
          if (ticket === ownerTicket) set({ status: 'offline' });
        }
      })();
      return reading;
    },

    async claim() {
      const state = get();
      if (state.busy) return false;
      const owner = state.owner;
      if (state.status === 'resident') {
        get().enter();
        return true;
      }
      set({ busy: true, error: null });
      try {
        const claimed = await write((key) => client().claim(key));
        // The claim names the place; the full read brings what already stands on it, the points and the day's tasks.
        let me: MeResponse = { resident: claimed.resident, quarter: claimed.quarter, buildings: [], quarters: [claimed.quarter], points: { total: 0, recent: [] }, tasks: [] };
        try {
          me = (await client().me()) ?? me;
        } catch {
          // The place is claimed; the rest is read again on the next visit.
        }
        // The wallet changed while the claim was out: the place is that account's, not the one on screen now.
        if (get().owner !== owner) return false;
        set({ me, status: 'resident', busy: false, later: false, mode: 'arrive', slot: null, choice: null });
        return true;
      } catch (e) {
        if (get().owner !== owner) return false;
        set({ busy: false, error: isWorldError(e) ? refusalLine(e.code) : refusalLine('OFFLINE') });
        return false;
      }
    },

    enter() {
      if (get().status !== 'resident') return;
      set({ mode: 'arrive', slot: null, choice: null, error: null, later: false, landed: null });
    },

    arrived() {
      if (get().mode === 'arrive') set({ mode: 'build' });
    },

    leave() {
      set({ mode: 'city', slot: null, choice: null, error: null, landed: null });
    },

    pick(slot) {
      const { mode, me, landing } = get();
      if (mode !== 'build' || !me) return;
      if (slot === null || landing?.slot === slot) {
        set({ slot: null, choice: null, error: null });
        return;
      }
      // A closed plot opens its picker too: it says which level opens it.
      if (slot >= openPlots(me.quarter.level)) {
        set({ slot, choice: null, error: null });
        return;
      }
      const here = me.buildings.find((b) => b.slot === slot);
      const choice = here ? (moduleForKind(here.kind)?.id ?? null) : (firstBuildable(me.quarter, me.buildings, slot)?.id ?? null);
      set({ slot, choice, error: null });
    },

    choose(id) {
      if (get().slot === null || !moduleById(id)) return;
      set({ choice: id, error: null });
    },

    async place() {
      const { me, slot, choice, busy, landing } = get();
      if (!me || slot === null || !choice || busy || landing) return false;
      const def = moduleById(choice);
      if (!def) return false;
      const v = verdict(def, me.quarter, me.buildings, slot);
      if (!v.ok) {
        set({ error: `${verdictLine(def, v)}.` });
        return false;
      }
      const drop: Landing = { slot, kind: def.kind, modules: [...def.modules], at: now() };
      const owner = get().owner;
      set({ landing: drop, slot: null, choice: null, busy: true, error: null });
      try {
        const res = await write((key) => client().build({ quarterId: me.quarter.id, slot, kind: def.kind, modules: drop.modules, version: me.quarter.version }, key));
        // Another wallet's place is on screen now: this answer is not about it.
        if (get().owner !== owner) return false;
        const current = get().me ?? me;
        set({
          me: { ...current, quarter: res.quarter, buildings: withBuilding(current.buildings, res.building), tasks: res.tasks, points: { ...current.points, total: res.points.total } },
          landing: null,
          landed: { ...drop, gained: Math.max(0, res.points.total - current.points.total) },
          busy: false,
        });
        return true;
      } catch (e) {
        if (get().owner !== owner) return false;
        const err = isWorldError(e) ? e : null;
        if (err?.code === 'NO_RESIDENT') {
          // The guest's key is gone: the place has to be claimed again.
          set({ me: null, status: 'none', mode: 'city', landing: null, busy: false, slot: null, choice: null, error: refusalLine('NO_RESIDENT') });
          return false;
        }
        const fresh = get().me ?? me;
        // Someone changed the quarter elsewhere: the world sent it as it is now, so the next try sends that version.
        const after = err?.current ? { ...fresh, quarter: err.current.quarter, buildings: err.current.buildings } : fresh;
        // Back to the picker on the same plot, with the reason; the building lifts away.
        set({
          me: after,
          landing: null,
          busy: false,
          error: err ? refusalLine(err.code, err.reason, err.need?.quarterLevel ?? null) : refusalLine('OFFLINE'),
          slot: get().mode === 'build' ? slot : null,
          choice: def.id,
        });
        return false;
      }
    },

    async link(slot, link) {
      const { me } = get();
      if (!me) return { ok: false, code: 'NO_RESIDENT', reason: null };
      const owner = get().owner;
      try {
        const res = await write((key) => client().link({ quarterId: me.quarter.id, slot, link, version: me.quarter.version }, key));
        if (get().owner !== owner) return { ok: false, code: 'NO_RESIDENT', reason: null };
        const current = get().me ?? me;
        set({ me: { ...current, quarter: res.quarter, buildings: withBuilding(current.buildings, res.building) } });
        return { ok: true };
      } catch (e) {
        const err = isWorldError(e) ? e : null;
        if (err?.current) {
          // Someone changed the quarter elsewhere: keep it as the world has it, so the next try sends that version.
          const fresh = get().me ?? me;
          set({ me: { ...fresh, quarter: err.current.quarter, buildings: err.current.buildings } });
        }
        return { ok: false, code: err?.code ?? 'OFFLINE', reason: err?.reason ?? null };
      }
    },

    async reload() {
      if (get().status !== 'resident') return;
      const owner = get().owner;
      try {
        const me = await client().me();
        if (me && get().owner === owner) set({ me });
      } catch {
        // What is shown stays; the next visit reads it again.
      }
    },

    dismiss() {
      set({ later: true, asked: false });
    },
  }));
}

export type QuarterStore = ReturnType<typeof createQuarterStore>;

export const quarterStore: QuarterStore = createQuarterStore();

export function useQuarter<T>(pick: (state: QuarterState) => T): T {
  return useStore(quarterStore, pick);
}

// Development hook: lets the screenshot scripts follow the quarter's flow.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __quarter: quarterStore });
