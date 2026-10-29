import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import {
  PIECES, fitToQuarter, pieceCap, planLayout as checkLayout, signText,
  type Layout, type LayoutRefusalReason, type Piece, type PieceKind, type Rotation,
} from '../../../../../lib/world/layout.ts';
import { randomId } from '../../ids.ts';
import { lotOf } from '../../plot.ts';
import { quarterStore, type QuarterStore } from '../../store.ts';
import type { MeResponse } from '../../types.ts';
import { layoutClient, isLayoutError, type LayoutClient } from './client.ts';
import { dirToLocal, pieceAt, snap, toLocal, type Target, type V3 } from './grid.ts';

/**
 * Free building on my quarter (CITY-55): which piece is in hand, its turn, the pieces on the lot, the steps back,
 * and the save behind every change. A piece lands the moment it is placed; the whole layout is saved a moment
 * later, at the version this device saw. A refusal takes the change back and says why in one line; a layout changed
 * on another device wins and is shown as it is. Nothing here pays points or touches money.
 */

export type Tool = PieceKind | 'erase';

/** One short line over the dock, for a moment: why a piece did not go down, or what happened to the save. */
export type Note = { kind: 'refused'; reason: LayoutRefusalReason; at: number } | { kind: 'offline' | 'synced' | 'full'; at: number };

export type Cell3 = { gx: number; gz: number; y: number };

export type FreeState = {
  on: boolean;
  status: 'idle' | 'loading' | 'ready' | 'offline';
  quarterId: string | null;
  /** What stands on the lot now, fitted to the quarter as it is. */
  pieces: Piece[];
  version: number;
  tool: Tool;
  rot: Rotation;
  /** The piece last put down or touched: the turn and a sign's words apply to it. */
  focus: Cell3 | null;
  /** The piece that just landed, for its little drop. */
  fresh: { at: Cell3; t: number } | null;
  /** Where the pointer would put the piece in hand, on a device that hovers. */
  hover: Target | null;
  history: Piece[][];
  saving: boolean;
  note: Note | null;
  /** Read the layout of my quarter (once per quarter). */
  load: () => Promise<void>;
  open: () => Promise<void>;
  close: () => void;
  choose: (tool: Tool) => void;
  turn: () => void;
  undo: () => void;
  /** Where a ray from the camera (in the world) meets the grid, for the piece in hand. */
  aim: (origin: V3, dir: V3, ground: number) => Target | null;
  tap: (target: Target | null) => void;
  setHover: (target: Target | null) => void;
  setText: (text: string) => void;
  /** Send what is waiting now (leaving the screen). */
  flush: () => Promise<void>;
};

export type FreeOptions = {
  client?: () => LayoutClient;
  quarter?: QuarterStore;
  now?: () => number;
  newKey?: () => string;
  /** The pause between the last change and its save. */
  saveMs?: number;
  retryMs?: number;
};

const HISTORY = 40;
const same = (a: Cell3 | null, p: Piece) => !!a && a.gx === p.gx && a.gz === p.gz && a.y === p.y;
const key = (pieces: readonly Piece[]) => JSON.stringify(pieces);

export function createFreeStore(options: FreeOptions = {}) {
  const client = options.client ?? layoutClient;
  const quarter = options.quarter ?? quarterStore;
  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const newKey = options.newKey ?? randomId;
  const saveMs = options.saveMs ?? 600;
  const retryMs = options.retryMs ?? 700;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let saved: { pieces: Piece[]; version: number } = { pieces: [], version: 0 };
  let inflight: Promise<void> | null = null;
  let loading: Promise<void> | null = null;

  const me = (): MeResponse | null => quarter.getState().me;
  const fit = (pieces: readonly Piece[]) => {
    const m = me();
    return m ? fitToQuarter(pieces, m.quarter.level, m.buildings) : [];
  };

  return createStore<FreeState>()((set, get) => {
    const note = (n: Note['kind'], reason?: LayoutRefusalReason) =>
      set({ note: n === 'refused' ? { kind: 'refused', reason: reason ?? 'support', at: now() } : ({ kind: n, at: now() } as Note) });

    /** Take on a layout the world sent: what it saved, or what another device saved before this one. */
    const adopt = (layout: Layout) => {
      saved = { pieces: layout.pieces, version: layout.version };
      set({ version: layout.version, pieces: fit(layout.pieces) });
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void save();
      }, saveMs);
    };

    async function save(): Promise<void> {
      if (inflight) {
        await inflight;
        return save();
      }
      const { quarterId, pieces } = get();
      if (!quarterId || key(pieces) === key(saved.pieces)) return;
      const body = { quarterId, pieces, version: saved.version };
      const k = newKey();
      set({ saving: true });
      inflight = (async () => {
        try {
          let layout: Layout;
          try {
            layout = await client().save(body, k);
          } catch (e) {
            if (!isLayoutError(e) || (e.status !== 0 && e.status < 500)) throw e;
            await new Promise((r) => setTimeout(r, retryMs));
            layout = await client().save(body, k);
          }
          if (get().quarterId !== quarterId) return;
          saved = { pieces: layout.pieces, version: layout.version };
          // Changes made while the save was out stay on screen and go in the next one.
          set({ version: layout.version });
          if (key(get().pieces) !== key(pieces)) schedule();
        } catch (e) {
          if (get().quarterId !== quarterId) return;
          const err = isLayoutError(e) ? e : null;
          if (err?.current) {
            // Another device saved first: its layout wins and is shown.
            adopt(err.current);
            note('synced');
          } else if (err && err.status >= 400 && err.status < 500 && err.code !== 'RATE_LIMITED') {
            // The world did not take it: back to what it keeps, with the reason.
            set({ pieces: fit(saved.pieces) });
            note('refused', err.reason ?? 'shape');
          } else {
            note('offline');
          }
        } finally {
          inflight = null;
          set({ saving: false });
        }
      })();
      return inflight;
    }

    /** A change by the person: kept for a step back, shown at once, saved a moment later. */
    const change = (pieces: Piece[], extra: Partial<FreeState> = {}) => {
      const history = [...get().history, get().pieces].slice(-HISTORY);
      set({ pieces, history, note: null, ...extra });
      schedule();
    };

    /** The whole layout with one change, through the world's own rules: the pieces in order, or why not. */
    const check = (pieces: Piece[]) => {
      const m = me();
      if (!m) return { ok: false as const, reason: 'shape' as LayoutRefusalReason };
      const planned = checkLayout({ quarter: m.quarter, buildings: m.buildings, pieces });
      return planned.ok ? { ok: true as const, pieces: planned.pieces } : { ok: false as const, reason: planned.refusal.reason };
    };

    // The quarter on screen drives the layout: another quarter starts over, a new building or level refits it.
    quarter.subscribe((q, before) => {
      const id = q.me?.quarter.id ?? null;
      if (id !== get().quarterId) {
        if (timer) clearTimeout(timer);
        timer = null;
        saved = { pieces: [], version: 0 };
        loading = null;
        set({ quarterId: id, pieces: [], version: 0, status: 'idle', history: [], focus: null, fresh: null, hover: null, on: false, note: null });
        return;
      }
      if (q.mode !== 'build' && get().on) get().close();
      if (q.me !== before.me && (get().status === 'ready' || get().status === 'offline')) {
        const fitted = fit(get().pieces);
        if (key(fitted) !== key(get().pieces)) {
          set({ pieces: fitted });
          schedule();
        }
      }
    });

    return {
      on: false,
      status: 'idle',
      quarterId: null,
      pieces: [],
      version: 0,
      tool: 'block',
      rot: 0,
      focus: null,
      fresh: null,
      hover: null,
      history: [],
      saving: false,
      note: null,

      async load() {
        const m = me();
        if (!m) return;
        const quarterId = m.quarter.id;
        if (get().quarterId !== quarterId) set({ quarterId });
        if (get().status === 'ready' || get().status === 'loading') return loading ?? undefined;
        // Read again after a failed read; what is on screen stays meanwhile.
        set({ status: 'loading' });
        loading = (async () => {
          try {
            const layout = await client().mine(quarterId);
            if (get().quarterId !== quarterId) return;
            adopt(layout);
            set({ status: 'ready' });
          } catch {
            if (get().quarterId === quarterId) set({ status: 'offline' });
            loading = null;
          }
        })();
        return loading;
      },

      async open() {
        if (quarter.getState().mode !== 'build' || !me()) return;
        // The plot picker steps aside: one sheet on the screen.
        quarter.getState().pick(null);
        set({ on: true, note: null, hover: null });
        if (get().status !== 'ready') await get().load();
      },

      close() {
        set({ on: false, hover: null, focus: null });
        void get().flush();
      },

      choose(tool) {
        set({ tool, hover: null, note: null });
      },

      turn() {
        const rot = ((get().rot + 1) % 4) as Rotation;
        const focus = get().focus;
        const target = focus ? get().pieces.find((p) => same(focus, p)) : null;
        set({ rot });
        if (!target) return;
        const turned = check(get().pieces.map((p) => (p === target ? { ...p, rot: ((p.rot + 1) % 4) as Rotation } : p)));
        if (turned.ok) change(turned.pieces);
      },

      undo() {
        const history = get().history;
        if (!history.length) return;
        set({ pieces: fit(history[history.length - 1]!), history: history.slice(0, -1), focus: null, note: null });
        schedule();
      },

      aim(origin, dir, ground) {
        const m = me();
        if (!m) return null;
        const lot = lotOf(m.quarter.cell);
        const tool = get().tool;
        return snap(get().pieces, toLocal(lot, origin, ground), dirToLocal(lot, dir), tool === 'erase' ? 1 : PIECES[tool].size);
      },

      tap(target) {
        // Unread (the world out of reach) still builds: the save's version settles it once the world answers.
        if (!get().on || get().status === 'loading' || get().status === 'idle' || !target) return;
        const { tool, pieces } = get();
        if (tool === 'erase') {
          const hit = target.hit;
          if (!hit) return;
          // What stood on it goes with it.
          const left = fit(pieces.filter((p) => p !== hit));
          change(left, { focus: null });
          return;
        }
        if (!target.place) {
          // Nowhere to put it: the touched piece becomes the one the turn and the words apply to.
          if (target.hit) set({ focus: { gx: target.hit.gx, gz: target.hit.gz, y: target.hit.y } });
          else note('refused', 'cell');
          return;
        }
        const m = me();
        if (m && pieces.length >= pieceCap(m.quarter.level)) {
          note('full');
          return;
        }
        const piece: Piece = { ...target.place, kind: tool, rot: get().rot };
        const next = check([...pieces, piece]);
        if (!next.ok) {
          note('refused', next.reason);
          return;
        }
        change(next.pieces, { focus: target.place, fresh: { at: target.place, t: now() } });
      },

      setHover(target) {
        const h = get().hover;
        const a = h?.place;
        const b = target?.place;
        if (h?.hit === target?.hit && a?.gx === b?.gx && a?.gz === b?.gz && a?.y === b?.y) return;
        set({ hover: target });
      },

      setText(text) {
        const focus = get().focus;
        const target = focus ? pieceAt(get().pieces, focus.gx, focus.gz, focus.y) : null;
        if (!target || target.kind !== 'sign') return;
        const words = text.trim() === '' ? null : signText(text);
        if (words && !words.ok) return;
        const next = get().pieces.map((p) => {
          if (p !== target) return p;
          const { text: _old, ...rest } = p;
          return words ? { ...rest, text: words.text } : rest;
        });
        set({ pieces: next, note: null });
        schedule();
      },

      async flush() {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        await save();
      },
    };
  });
}

export type FreeStore = ReturnType<typeof createFreeStore>;

export const freeStore: FreeStore = createFreeStore();

export function useFree<T>(pick: (state: FreeState) => T): T {
  return useStore(freeStore, pick);
}

/** The piece in focus, if it still stands. */
export function focused(state: Pick<FreeState, 'focus' | 'pieces'>): Piece | null {
  const f = state.focus;
  return f ? pieceAt(state.pieces, f.gx, f.gz, f.y) : null;
}

// Development hook: lets the screenshot scripts drive free building.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __free: freeStore });
