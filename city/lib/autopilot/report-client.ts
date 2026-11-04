import { create } from 'zustand';
import type { AgentDay } from '../../../lib/mandate/report.ts';
import type { MandateRecord } from '../bots/mandate.ts';
import { clockOf, REPORT_HOUR, worthTelling, type Lang } from './report.ts';
import { readAgentView, useAutopilot } from './store.ts';

/**
 * The agent's day in the page (CITY-194): when this browser last saw the agent (kept per mandate on this device), the
 * card «While you were away: 3 trades, +0.012 SOL» on the person's return — once, when the agent traded since — and
 * her daily report's one switch, kept on Ryntra's server under her wallet's own proof. Nothing here counts money: the
 * figures are the agent's book's (`/api/bots/mandate/agent?since=`).
 */

/** Back after less than this, there is nothing to tell. */
export const AWAY_MIN_MS = 20 * 60_000;
export const SEEN_KEY = 'ryntra.city.agent.seen.v1:';

export type StorageLike = Readonly<{ getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }>;

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readSeen(storage: StorageLike | null, policy: string): number | null {
  try {
    const raw = storage?.getItem(SEEN_KEY + policy);
    const at = raw ? Number(raw) : NaN;
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

export function keepSeen(storage: StorageLike | null, policy: string, at: number): void {
  try {
    storage?.setItem(SEEN_KEY + policy, String(Math.floor(at)));
  } catch {
    // Without storage the card may come again after a reload; nothing worse.
  }
}

/** Whether to ask the book what the agent did since: the person was away long enough; a first visit only starts the clock. */
export const askSince = (seen: number | null, now: number): number | null => (seen !== null && now - seen >= AWAY_MIN_MS ? seen : null);

export type ReportSwitch = Readonly<{ on: boolean; hour: number; kept: boolean }>;

type ReportState = {
  /** The card on her return: what the agent did while she was away, for this mandate. */
  away: Readonly<{ policy: string; day: AgentDay }> | null;
  /** Her daily report's switch as the server keeps it; null while unread. */
  report: ReportSwitch | null;
  busy: boolean;
  /** Read once per mandate per page: the card, then the clock moves on. */
  check: (record: MandateRecord, env?: Partial<ReportEnv>) => Promise<boolean>;
  dismiss: () => void;
  /** The server's switch for this wallet, and her clock and language kept with it. */
  readReport: (owner: string, lang: Lang, env?: Partial<ReportEnv>) => Promise<void>;
  toggle: (owner: string, env?: Partial<ReportEnv>) => Promise<void>;
};

export type ReportEnv = Readonly<{ storage: StorageLike | null; now: () => number; fetch: (url: string, init?: RequestInit) => Promise<Response>; timezone: () => string }>;

const ENV: ReportEnv = {
  storage: browserStorage(),
  now: () => Date.now(),
  fetch: (url, init) => fetch(url, init),
  timezone: () => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'UTC';
    }
  },
};

const checked = new Set<string>();
const SWITCH = '/api/bots/mandate/report';

async function post(env: ReportEnv, body: Record<string, unknown>): Promise<ReportSwitch | null> {
  try {
    const answer = await env.fetch(SWITCH, {
      method: 'POST',
      headers: { 'X-Ryntra-API': '1', accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!answer.ok) return null;
    return readSwitch(await answer.json());
  } catch {
    return null;
  }
}

export function readSwitch(value: unknown): ReportSwitch | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.on !== 'boolean' || typeof v.hour !== 'number') return null;
  return { on: v.on, hour: Number.isInteger(v.hour) && v.hour >= 0 && v.hour <= 23 ? v.hour : REPORT_HOUR, kept: v.kept === true };
}

export const useAgentReport = create<ReportState>((set, get) => ({
  away: null,
  report: null,
  busy: false,
  check: async (record, overrides) => {
    const env = { ...ENV, ...overrides };
    if (checked.has(record.policy)) return false;
    checked.add(record.policy);
    const now = env.now();
    const since = askSince(readSeen(env.storage, record.policy), now);
    keepSeen(env.storage, record.policy, now);
    /* Read on entry either way: the line over the agent's tower says its day. */
    const view = await readAgentView(record, env.fetch, since);
    if (view) useAutopilot.getState().setView(record.policy, view);
    if (since === null || !view || !worthTelling(view.away)) return false;
    set({ away: { policy: record.policy, day: view.away } });
    return true;
  },
  dismiss: () => set({ away: null }),
  readReport: async (owner, lang, overrides) => {
    const env = { ...ENV, ...overrides };
    try {
      const answer = await env.fetch(`${SWITCH}?owner=${owner}`, { cache: 'no-store' });
      const read = answer.ok ? readSwitch(await answer.json()) : null;
      if (read) set({ report: read });
      /* Her clock and language go with her report, so it reaches her at her hour in her words; without her proof, nothing changes. */
      const kept = await post(env, { owner, timezone: clockOf(env.timezone()), locale: lang });
      if (kept) set({ report: kept });
    } catch {
      // Unread: the switch is not shown.
    }
  },
  toggle: async (owner, overrides) => {
    const env = { ...ENV, ...overrides };
    const now = get().report;
    if (!now || get().busy) return;
    set({ busy: true, report: { ...now, on: !now.on } });
    const kept = await post(env, { owner, on: !now.on, timezone: clockOf(env.timezone()) });
    set({ busy: false, report: kept ?? now });
  },
}));

/** For the tests: the page forgets what it checked. */
export function forgetChecked(): void {
  checked.clear();
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __agentReport: useAgentReport });
