import { create } from 'zustand';
import type { Lang } from '../../city/lib/i18n/langs.ts';
import { proveWallet, type ProofOutcome } from '../../city/lib/trade/proof.ts';
import { ALERT_NOTES_KEY, alertNotesOf, alertsOf, refusalOf, type AlertNote, type AlertRefusal, type AlertRule, type AlertsRead } from './watch-view.ts';

/**
 * A coin's alerts — «tell me when the price or the cap crosses X» — on the conditions Ryntra already watches for a
 * person (`/api/v1/assistant/watches`): a rule judged every minute, its note in the person's notifications, and on
 * Telegram and push as their settings say, through the monitoring the terminal already has. The engine answers only for
 * a wallet that proved itself — whose alerts are not public — so the screen reads when the proof is here, and one tap
 * signs one message, no transaction, when it is not. Nothing here signs a transaction, sends or trades.
 */

export type AlertsStatus = 'none' | 'reading' | 'proof' | 'proving' | 'ready' | 'failed';
export type CreateOutcome = Readonly<{ ok: true }> | Readonly<{ ok: false; refusal: AlertRefusal | 'declined' }>;

type Connection = Readonly<{ wallet: string; address: string }>;
type Answer = Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type AlertsEnv = Readonly<{
  fetch: (url: string, init?: RequestInit) => Promise<Answer>;
  prove: (connection: Connection) => Promise<ProofOutcome>;
  load: () => string | null;
  save: (raw: string) => void;
}>;

let env: AlertsEnv = {
  fetch: (url, init) => fetch(url, { cache: 'no-store', credentials: 'same-origin', ...init, headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) } }),
  prove: proveWallet,
  load: () => {
    try {
      return window.localStorage.getItem(ALERT_NOTES_KEY);
    } catch {
      return null;
    }
  },
  save: (raw) => {
    try {
      window.localStorage.setItem(ALERT_NOTES_KEY, raw);
    } catch {
      /* Storage shut: an alert set by a cap reads as its price. */
    }
  },
};

/** Swap what the alerts reach: for tests, and nothing else. */
export function setAlertsEnv(next: Partial<AlertsEnv>): void {
  env = { ...env, ...next };
}

/** What the engine said stays good this long; coming back later reads it again. */
const TTL_MS = 60_000;
const API = '/api/v1/assistant/watches';

type Store = {
  owner: string | null;
  status: AlertsStatus;
  view: AlertsRead | null;
  at: number | null;
  /** What the browser remembers of the alerts set by a cap. */
  notes: Readonly<Record<string, AlertNote>>;
  /** Why the last signature did not go: null for a person's own «no». */
  message: string | null;
  /** Read the wallet's alerts, if its proof is already here. Never opens the wallet. */
  read: (owner: string, lang: Lang, force?: boolean) => Promise<void>;
  /** The one tap that proves the wallet, then reads. */
  prove: (connection: Connection, lang: Lang) => Promise<boolean>;
  create: (connection: Connection, lang: Lang, input: Readonly<{ mint: string; rule: AlertRule; cap: number | null }>) => Promise<CreateOutcome>;
  remove: (connection: Connection, lang: Lang, id: string) => Promise<boolean>;
  reset: () => void;
};

async function json(answer: Answer): Promise<unknown> {
  try {
    return await answer.json();
  } catch {
    return null;
  }
}

let ticket = 0;

export const useAlerts = create<Store>((set, get) => ({
  owner: null,
  status: 'none',
  view: null,
  at: null,
  notes: {},
  message: null,

  read: async (owner, lang, force = false) => {
    const state = get();
    if (state.owner === owner && !force) {
      if (state.status === 'reading' || state.status === 'proving') return;
      if (state.status === 'ready' && state.at !== null && Date.now() - state.at < TTL_MS) return;
    }
    const my = ++ticket;
    set({ owner, status: 'reading', message: null, notes: alertNotesOf(env.load()), ...(state.owner === owner ? {} : { view: null, at: null }) });
    const answer = await env.fetch(`${API}?${new URLSearchParams({ locale: lang })}`).catch(() => null);
    if (my !== ticket) return;
    if (!answer) {
      set({ status: 'failed' });
      return;
    }
    if (answer.status === 401) {
      set({ status: 'proof', view: null, at: null });
      return;
    }
    const view = answer.ok ? alertsOf(await json(answer)) : null;
    if (my !== ticket) return;
    // A failed read keeps what was shown.
    if (!view) set({ status: 'failed' });
    else set({ status: 'ready', view, at: Date.now() });
  },

  prove: async (connection, lang) => {
    if (get().status === 'proving') return false;
    const my = ++ticket;
    set({ owner: connection.address, status: 'proving', message: null });
    const proof = await env.prove(connection);
    // Another wallet (or none) came while this one was signing: its answer is not this screen's any more.
    if (my !== ticket) return false;
    if (!proof.ok) {
      set({ status: 'proof', message: proof.state === 'declined' ? null : proof.message });
      return false;
    }
    await get().read(connection.address, lang, true);
    return get().status === 'ready';
  },

  create: async (connection, lang, input) => {
    const send = () =>
      env.fetch(`${API}?${new URLSearchParams({ locale: lang })}`, {
        method: 'POST',
        body: JSON.stringify({ mint: input.mint, rule: input.rule, locale: lang, channels: { telegram: true, push: true }, cooldownMinutes: 60 }),
      });
    const before = new Set((get().view?.rows ?? []).map((row) => row.id));
    let answer = await send().catch(() => null);
    if (answer?.status === 401) {
      // No proof here yet: one message, then the same alert once more.
      if (!(await get().prove(connection, lang))) return { ok: false, refusal: get().status === 'proof' && get().message === null ? 'declined' : 'proof' };
      answer = await send().catch(() => null);
    }
    if (!answer) return { ok: false, refusal: 'failed' };
    const body = await json(answer);
    if (!answer.ok) return { ok: false, refusal: refusalOf(answer.status, body) };
    const view = alertsOf(body);
    if (!view) return { ok: false, refusal: 'failed' };
    if (input.cap !== null) {
      const made = view.rows.find((row) => !before.has(row.id) && row.mint === input.mint && row.price?.level === input.rule.level);
      if (made) {
        const notes = { ...alertNotesOf(env.load()), [made.id]: { basis: 'cap' as const, cap: input.cap, level: input.rule.level } };
        env.save(JSON.stringify(notes));
        set({ notes });
      }
    }
    set({ owner: connection.address, status: 'ready', view, at: Date.now() });
    return { ok: true };
  },

  remove: async (connection, lang, id) => {
    const send = () => env.fetch(`${API}/${encodeURIComponent(id)}?${new URLSearchParams({ locale: lang })}`, { method: 'DELETE' });
    let answer = await send().catch(() => null);
    if (answer?.status === 401) {
      if (!(await get().prove(connection, lang))) return false;
      answer = await send().catch(() => null);
    }
    if (!answer || !answer.ok) return false;
    const view = alertsOf(await json(answer));
    if (!view) return false;
    const notes = { ...alertNotesOf(env.load()) };
    delete notes[id];
    env.save(JSON.stringify(notes));
    set({ view, notes, at: Date.now(), status: 'ready' });
    return true;
  },

  reset: () => {
    ticket += 1;
    set({ owner: null, status: 'none', view: null, at: null, message: null });
  },
}));
