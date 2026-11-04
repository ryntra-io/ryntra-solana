import { create } from 'zustand';
import type { Tower } from '../../market/types.ts';
import { askAdvice, type Advice } from './brain.ts';
import { left, readLedger, reserve, settle, type Ledger } from './budget.ts';
import type { MyTower } from './mine.ts';
import { markAll, readMarks, report, type Marks, type Report } from './report.ts';
import { agentName, DEFAULT_SETTINGS, readSettings, type GarageSettings, type Topic } from './settings.ts';

/**
 * The agent in the garage of your quarter (CITY-29): a character without money. It keeps, on this device, its name,
 * what it reports on, whether it is on, the read of your towers from when you last looked and its count of model
 * answers for the day. It holds no key and no wallet, and nothing it does moves money or signs anything: a tower in
 * its report or its advice only makes the camera fly there and the tower light up.
 */

export type AdviceState =
  | Readonly<{ status: 'none' }>
  | Readonly<{ status: 'asking'; at: number }>
  | Readonly<{ status: 'ready'; line: string; more: readonly string[]; towers: readonly Tower[]; at: number }>
  | Readonly<{ status: 'failed'; busy: boolean; at: number }>
  /** Today's budget of model answers is spent: nothing was asked. */
  | Readonly<{ status: 'spent'; at: number }>;

export type GarageView = 'home' | 'settings';

/** The towers the agent is showing: the camera flies to them and they light, until the person moves on. */
export type Showing = Readonly<{ towers: readonly Tower[]; at: number }>;

const STORE_KEY = 'ryntra.city.garage.v1';

type Saved = Readonly<{ settings: GarageSettings; marks: Marks; ledger: Ledger }>;

export type GarageEnv = Readonly<{
  storage: () => Pick<Storage, 'getItem' | 'setItem'> | null;
  now: () => number;
  ask: typeof askAdvice;
}>;

let env: GarageEnv = {
  storage: () => {
    try {
      return typeof window === 'undefined' ? null : window.localStorage;
    } catch {
      return null;
    }
  },
  now: () => Date.now(),
  ask: askAdvice,
};

/** Swap what the store reaches: for tests, and nothing else. */
export function setGarageEnv(next: Partial<GarageEnv>): void {
  env = { ...env, ...next };
}

function load(): Saved | null {
  try {
    const raw = JSON.parse(env.storage()?.getItem(STORE_KEY) ?? 'null') as Partial<Saved> | null;
    if (!raw) return null;
    const now = env.now();
    return { settings: readSettings(raw.settings), marks: readMarks(raw.marks, now), ledger: readLedger(raw.ledger, now) };
  } catch {
    return null;
  }
}

function save(saved: Saved): void {
  try {
    env.storage()?.setItem(STORE_KEY, JSON.stringify(saved));
  } catch {
    // A private window keeps the agent for this visit only.
  }
}

export type GarageState = {
  settings: GarageSettings;
  marks: Marks;
  ledger: Ledger | null;
  /** The agent's window is open. */
  open: boolean;
  /** The window stepped aside while the agent shows towers; it comes back as it was. */
  away: boolean;
  view: GarageView;
  /** Each opening, so the character greets once per opening. */
  opened: number;
  /** The report as it stood when the window opened: it compares with the read kept the time before. */
  report: Report | null;
  /** The kept read this opening compares with: what `marks` was before this opening's first report. */
  basis: Marks | null;
  advice: AdviceState;
  showing: Showing | null;

  hydrate: () => void;
  show: () => void;
  /** Steps aside for a show of towers, keeping the report and the advice of this opening. */
  stepAside: () => void;
  close: () => void;
  setView: (view: GarageView) => void;
  rename: (raw: string) => boolean;
  setTopic: (topic: Topic, on: boolean) => void;
  setOn: (on: boolean) => void;
  /**
   * The report for this opening, from your towers as the city reads them now. A live read makes it and keeps the read
   * for next time; without one the report waits, and the kept read stays as it was.
   */
  look: (mine: readonly MyTower[], live: boolean) => void;
  ask: (mine: readonly MyTower[]) => Promise<void>;
  setShowing: (showing: Showing | null) => void;
  /** Model answers the agent may still take today. */
  answersLeft: () => number;
};

const saved = (st: GarageState): Saved => ({ settings: st.settings, marks: st.marks, ledger: st.ledger ?? readLedger(null, env.now()) });

let asked = 0;
let inFlight: AbortController | null = null;

export const useGarage = create<GarageState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  marks: {},
  ledger: null,
  open: false,
  away: false,
  view: 'home',
  opened: 0,
  report: null,
  basis: null,
  advice: { status: 'none' },
  showing: null,

  hydrate: () => {
    const back = load();
    if (back) set({ settings: back.settings, marks: back.marks, ledger: back.ledger });
  },
  show: () => set((st) => (st.open ? { view: 'home' } : st.away ? { open: true, away: false } : { open: true, view: 'home', opened: st.opened + 1, report: null, basis: null })),
  stepAside: () => set((st) => (st.open ? { open: false, away: true } : {})),
  close: () => {
    inFlight?.abort();
    inFlight = null;
    asked++;
    set((st) => ({ open: false, away: false, view: 'home', report: null, basis: null, advice: st.advice.status === 'asking' ? { status: 'none' } : st.advice }));
  },
  setView: (view) => set({ view }),
  rename: (raw) => {
    const name = agentName(raw);
    if (!name) return false;
    set((st) => ({ settings: { ...st.settings, name } }));
    save(saved(get()));
    return true;
  },
  setTopic: (topic, on) => {
    set((st) => ({ settings: { ...st.settings, topics: { ...st.settings.topics, [topic]: on } }, report: null }));
    save(saved(get()));
  },
  setOn: (on) => {
    if (!on) {
      inFlight?.abort();
      inFlight = null;
      asked++;
    }
    set((st) => ({ settings: { ...st.settings, on }, report: null, ...(on ? {} : { advice: { status: 'none' as const }, showing: null }) }));
    save(saved(get()));
  },
  look: (mine, live) => {
    const st = get();
    if (!st.settings.on) return;
    const now = env.now();
    const basis = st.basis ?? st.marks;
    const next = report({ mine, marks: basis, live, topics: st.settings.topics });
    if (next.status === 'ready') {
      set({ report: next, basis, marks: markAll(mine, now, st.marks) });
      save(saved(get()));
      return;
    }
    set({ report: next });
  },
  ask: async (mine) => {
    const st = get();
    if (!st.settings.on || st.advice.status === 'asking') return;
    const now = env.now();
    // The worst case is taken before the question leaves; a question that does not fit is not sent.
    const taken = reserve(st.ledger, now);
    if (!taken.ok) {
      set({ ledger: taken.ledger, advice: { status: 'spent', at: now } });
      return;
    }
    set({ ledger: taken.ledger, advice: { status: 'asking', at: now } });
    save(saved(get()));
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    const id = ++asked;
    const changes = get().report?.status === 'ready' ? (get().report as Extract<Report, { status: 'ready' }>).changes : [];
    const answer: Advice = await env.ask(mine, changes, controller.signal);
    // The window closed, the agent was turned off or asked again: this answer is no one's now.
    if (id !== asked) return;
    inFlight = null;
    const at = env.now();
    if (!answer.ok) {
      set({ advice: { status: 'failed', busy: answer.busy, at } });
      return;
    }
    set((s) => ({ ledger: settle(s.ledger, at, answer.seam), advice: { status: 'ready', line: answer.line, more: answer.more, towers: answer.towers, at } }));
    save(saved(get()));
  },
  setShowing: (showing) => set({ showing }),
  answersLeft: () => left(get().ledger, env.now()),
}));

/**
 * The garage agent as «a window is open» reads it (CITY-29): while its window is open, and while it shows towers with
 * the window stepped aside — the feed and the banners keep giving way until the person is done with the towers.
 */
export function garageView(st: Readonly<{ open: boolean; away: boolean; showing: unknown }>): Readonly<{ open: boolean }> {
  return { open: st.open || (st.away && st.showing !== null) };
}

// Development hook: lets the screenshot scripts and the console drive the agent.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __garage: useGarage });
