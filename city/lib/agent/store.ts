import { create } from 'zustand';
import type { Tower } from '../market/types.ts';
import { DEFAULT_RULE, explain, fits, readRule, type Fact, type Rule } from './rule.ts';
import { decide, keepWeek, SEEN_MS, type Spend } from './scout.ts';

/**
 * The scout's state on this device: its rule, whether it is flying, what it found, and the buys the person made from
 * its finds this week. It holds no key and no wallet, and nothing it does moves money: a find only opens the trade
 * card, where the person decides and signs.
 */

export type ScoutPhase = 'off' | 'patrol' | 'found' | 'quiet' | 'waiting' | 'resting';

export type Find = Readonly<{ tower: Tower; facts: readonly Fact[]; at: number }>;

export type Advice =
  | Readonly<{ status: 'none' }>
  | Readonly<{ status: 'loading'; mint: string }>
  | Readonly<{ status: 'ready'; mint: string; lines: readonly string[] }>
  | Readonly<{ status: 'error'; mint: string; message: string }>;

/** A find's button was pressed: a buy of that coin soon after counts against the week's budget. */
export const BROUGHT_MS = 30 * 60 * 1000;

/** A find older than this is dropped: its figures are no longer the city's. */
export const FIND_MS = 3 * 60 * 1000;

const STORE_KEY = 'ryntra.city.scout.v1';

type Saved = Readonly<{ rule: Rule; on: boolean; seen: Record<string, number>; ledger: Spend[] }>;

function load(): Saved | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Saved> | null;
    if (!raw) return null;
    const now = Date.now();
    const seen: Record<string, number> = {};
    for (const [mint, at] of Object.entries(raw.seen ?? {})) if (typeof at === 'number' && now - at < SEEN_MS) seen[mint] = at;
    const ledger = Array.isArray(raw.ledger)
      ? keepWeek(
          raw.ledger.filter((s): s is Spend => !!s && typeof s.at === 'number' && typeof s.mint === 'string' && typeof s.usd === 'number'),
          now,
        )
      : [];
    return { rule: readRule(raw.rule), on: raw.on === true, seen, ledger };
  } catch {
    return null;
  }
}

function save(state: Saved): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ rule: state.rule, on: state.on, seen: state.seen, ledger: state.ledger }));
  } catch {
    // Without storage the scout still flies; it just starts fresh next visit.
  }
}

type AgentState = {
  /** The scout's card in the HUD: its rule being set, its status while it flies, or closed. */
  panel: 'none' | 'rule' | 'status';
  /** The rule being put together on the card; it becomes the rule only when the scout is launched. */
  draft: Rule;
  rule: Rule;
  on: boolean;
  phase: ScoutPhase;
  find: Find | null;
  /** The drone hangs over the find: only now does its card show. */
  arrived: boolean;
  /** When budget comes back, while the scout rests. */
  until: number | null;
  lookedAt: number;
  seen: Record<string, number>;
  ledger: Spend[];
  brought: Readonly<{ mint: string; at: number }> | null;
  advice: Advice;

  hydrate: () => void;
  toggle: () => void;
  closePanel: () => void;
  setDraft: (rule: Rule) => void;
  /** The rule again while it flies, to change it; the scout flies on the old rule until the new one is launched. */
  edit: () => void;
  launch: (now?: number) => void;
  stop: () => void;
  look: (towers: readonly Tower[], live: boolean, now?: number) => void;
  /**
   * The drone is over the find. The rule is checked again on the tower's figures as the city reads them now: the card
   * opens with those figures, or the find is dropped when the tower is gone, the read is not live, the find is too old
   * or the tower no longer fits.
   */
  arrive: (current: Tower | undefined, live: boolean, now?: number) => void;
  skip: (now?: number) => void;
  /** The find no longer stands (gone from the city, too old, no longer fits): forget it and fly on. */
  drop: (now?: number) => void;
  /** Drops a find older than FIND_MS, arrived or not. */
  expire: (now?: number) => void;
  /** The find's one button was pressed: remember the coin, and fly on. */
  bring: (now?: number) => void;
  record: (spend: Spend) => void;
  setAdvice: (advice: Advice) => void;
};

const saved = (st: AgentState): Saved => ({ rule: st.rule, on: st.on, seen: st.seen, ledger: st.ledger });

export const useAgent = create<AgentState>((set, get) => ({
  panel: 'none',
  draft: DEFAULT_RULE,
  rule: DEFAULT_RULE,
  on: false,
  phase: 'off',
  find: null,
  arrived: false,
  until: null,
  lookedAt: 0,
  seen: {},
  ledger: [],
  brought: null,
  advice: { status: 'none' },

  hydrate: () => {
    const back = load();
    if (!back) return;
    set({ rule: back.rule, draft: back.rule, on: back.on, phase: back.on ? 'patrol' : 'off', seen: back.seen, ledger: back.ledger, lookedAt: Date.now() });
  },
  toggle: () => set((st) => (st.panel !== 'none' ? { panel: 'none' } : { panel: st.on ? 'status' : 'rule', draft: st.rule })),
  closePanel: () => set({ panel: 'none' }),
  setDraft: (draft) => set({ draft }),
  edit: () => set((st) => ({ draft: st.rule, panel: 'rule' })),
  launch: (now = Date.now()) => {
    set((st) => ({ rule: st.draft, on: true, phase: 'patrol', find: null, arrived: false, until: null, lookedAt: now, panel: 'status' }));
    save(saved(get()));
  },
  stop: () => {
    set({ on: false, phase: 'off', find: null, arrived: false, until: null, panel: 'none', advice: { status: 'none' } });
    save(saved(get()));
  },
  look: (towers, live, now = Date.now()) => {
    const st = get();
    if (!st.on || st.phase === 'found') return;
    const d = decide({ rule: st.rule, towers, live, seen: st.seen, ledger: st.ledger, now });
    if (d.kind === 'find') {
      set({ phase: 'found', find: { tower: d.tower, facts: d.facts, at: now }, arrived: false, until: null, lookedAt: now, seen: { ...st.seen, [d.tower.id]: now }, advice: { status: 'none' } });
      save(saved(get()));
      return;
    }
    set({ phase: d.kind, until: d.kind === 'resting' ? d.until : null, lookedAt: now });
  },
  arrive: (current, live, now = Date.now()) => {
    const st = get();
    if (!st.find || st.arrived) return;
    if (!current || current.id !== st.find.tower.id || !live || now - st.find.at > FIND_MS || !fits(current, st.rule)) {
      get().drop(now);
      return;
    }
    set({ arrived: true, find: { tower: current, facts: explain(current, st.rule), at: st.find.at } });
  },
  skip: (now = Date.now()) => set({ find: null, arrived: false, phase: get().on ? 'patrol' : 'off', lookedAt: now, advice: { status: 'none' } }),
  drop: (now = Date.now()) => get().skip(now),
  expire: (now = Date.now()) => {
    const find = get().find;
    if (find && now - find.at > FIND_MS) get().drop(now);
  },
  bring: (now = Date.now()) => {
    const find = get().find;
    if (!find) return;
    set({ brought: { mint: find.tower.id, at: now }, find: null, arrived: false, phase: get().on ? 'patrol' : 'off', lookedAt: now, advice: { status: 'none' } });
  },
  record: (spend) => {
    set((st) => ({ ledger: keepWeek([...st.ledger, spend], spend.at) }));
    save(saved(get()));
  },
  setAdvice: (advice) => set({ advice }),
}));

// Development hook: lets the screenshot scripts show the scout's states on demand.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __agent: useAgent });
