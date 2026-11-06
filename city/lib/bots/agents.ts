import { create } from 'zustand';
import { isMandateRecord, MANDATE_NET, useMandate, type MandateNetwork, type MandateRecord, type MandateStatus } from './mandate.ts';

/**
 * A wallet's agents from the engine (CITY-207): any browser, any phone sees the agent the person hired somewhere else.
 * `POST /api/bots/agents` answers from the agent's book and the chain — the mandates, mainnet and devnet apart, the
 * autopilot on one of them, the piers it looks after. The book is the truth; the note this browser keeps
 * (`mandate.ts`) stays only as a cache, written over by the engine's answer.
 */

export type EngineMandate = Readonly<{
  record: MandateRecord;
  status: 'working' | 'paused' | 'stopped' | 'ended' | 'spent';
  budgetLamports: string | null;
  live: boolean | null;
  active: boolean;
  trades: number;
  pilot: boolean;
  createdAt: number;
}>;

export type EngineNetwork = Readonly<{
  read: boolean;
  mandates: readonly EngineMandate[];
  pilot: Readonly<{ status: 'working' | 'stopped'; policy: string | null }> | null;
  cares: readonly Readonly<{ key: string; pool: string; status: 'working' | 'stopped' }>[];
}>;

export type EngineAgents = Readonly<{ owner: string; networks: Readonly<Record<MandateNetwork, EngineNetwork>> }>;

const STATES = new Set(['working', 'paused', 'stopped', 'ended', 'spent']);
const LAMPORTS = /^\d{1,20}$/;
const EMPTY: EngineNetwork = { read: false, mandates: [], pilot: null, cares: [] };

const mandateOf = (value: unknown, owner: string): EngineMandate | null => {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isMandateRecord(v.record) || v.record.owner !== owner || typeof v.status !== 'string' || !STATES.has(v.status)) return null;
  return {
    record: v.record,
    status: v.status as EngineMandate['status'],
    budgetLamports: typeof v.budgetLamports === 'string' && LAMPORTS.test(v.budgetLamports) ? v.budgetLamports : null,
    live: typeof v.live === 'boolean' ? v.live : null,
    active: v.active === true,
    trades: typeof v.trades === 'number' && Number.isFinite(v.trades) ? v.trades : 0,
    pilot: v.pilot === true,
    createdAt: typeof v.createdAt === 'number' ? v.createdAt : 0,
  };
};

const networkOf = (value: unknown, owner: string): EngineNetwork => {
  if (typeof value !== 'object' || value === null) return EMPTY;
  const v = value as Record<string, unknown>;
  const mandates = Array.isArray(v.mandates) ? v.mandates.map((m) => mandateOf(m, owner)).filter((m): m is EngineMandate => m !== null) : [];
  const p = v.pilot as Record<string, unknown> | null | undefined;
  const pilot = p && (p.status === 'working' || p.status === 'stopped') ? { status: p.status as 'working' | 'stopped', policy: typeof p.policy === 'string' ? p.policy : null } : null;
  const cares = Array.isArray(v.cares)
    ? v.cares.flatMap((c) => {
        const r = c as Record<string, unknown> | null;
        return r && typeof r.key === 'string' && typeof r.pool === 'string' && (r.status === 'working' || r.status === 'stopped') ? [{ key: r.key, pool: r.pool, status: r.status as 'working' | 'stopped' }] : [];
      })
    : [];
  return { read: v.read === true, mandates, pilot, cares };
};

/** The engine's answer, read strictly: another wallet's mandate, or a record that is not one, never passes. */
export function parseAgents(value: unknown, owner: string): EngineAgents | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.owner !== owner || typeof v.networks !== 'object' || v.networks === null) return null;
  const n = v.networks as Record<string, unknown>;
  return { owner, networks: { mainnet: networkOf(n.mainnet, owner), devnet: networkOf(n.devnet, owner) } };
}

/** The mandate a wallet sees first on a network: one at work, the newest of them; else the newest. */
export function leadOf(network: EngineNetwork): EngineMandate | null {
  const newest = [...network.mandates].sort((a, b) => b.createdAt - a.createdAt);
  return newest.find((m) => m.active) ?? newest[0] ?? null;
}

/**
 * What the browser's cache becomes: the engine's lead mandate over whatever this browser kept, and its state as the
 * chain stood — or, when the engine knows none, the browser's own note left as it is (a mandate signed here that never
 * reached the book still stands on chain and still needs its «Stop»).
 */
export function cacheFrom(network: EngineNetwork, local: MandateRecord | undefined): Readonly<{ record: MandateRecord | null; status: MandateStatus | null }> {
  const lead = network.read ? leadOf(network) : null;
  if (!lead) return { record: local ?? null, status: null };
  const status = lead.live === null ? null : { active: lead.active, budgetLamports: lead.budgetLamports };
  return { record: lead.record, status };
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** One read of the engine; null — it did not answer (closed here, refused, unreachable). */
export async function readAgents(owner: string, fetcher: Fetcher = (url, init) => fetch(url, init)): Promise<EngineAgents | null> {
  try {
    const response = await fetcher('/api/bots/agents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner }), credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return null;
    return parseAgents(await response.json(), owner);
  } catch {
    return null;
  }
}

type AgentsState = {
  /** The engine's last answer per wallet. */
  byOwner: Readonly<Record<string, EngineAgents>>;
  keep: (agents: EngineAgents) => void;
};

export const useAgents = create<AgentsState>((set, get) => ({
  byOwner: {},
  keep: (agents) => set({ byOwner: { ...get().byOwner, [agents.owner]: agents } }),
}));

/** A fresh answer is not asked again this soon: the portfolio, «Your agents» and the budget card open together. */
export const SYNC_FRESH_MS = 20_000;
const asked = new Map<string, Readonly<{ at: number; promise: Promise<EngineAgents | null> }>>();

/**
 * Read the wallet's agents from the engine and write the deployment's network into the browser's cache — so the
 * portfolio, «Your agents» and the budget card, which read that cache, show the engine's truth on a new device too.
 */
export function syncAgents(owner: string, deps: Readonly<{ fetch?: Fetcher; now?: () => number; network?: MandateNetwork | null }> = {}): Promise<EngineAgents | null> {
  const now = (deps.now ?? Date.now)();
  const kept = asked.get(owner);
  if (kept && now - kept.at < SYNC_FRESH_MS) return kept.promise;
  const network = deps.network === undefined ? MANDATE_NET : deps.network;
  const promise = readAgents(owner, deps.fetch).then((agents) => {
    if (!agents) {
      asked.delete(owner);
      return null;
    }
    useAgents.getState().keep(agents);
    if (network) {
      const mandate = useMandate.getState();
      mandate.hydrate();
      const { record, status } = cacheFrom(agents.networks[network], mandate.records[owner]);
      if (record && JSON.stringify(record) !== JSON.stringify(mandate.records[owner])) mandate.keep(record);
      if (record && status) useMandate.getState().setStatus(record.policy, status);
    }
    return agents;
  });
  asked.set(owner, { at: now, promise });
  return promise;
}

/** Forget the last answer — after the person signs or stops, the next read asks the engine again. */
export function forgetAgents(owner: string): void {
  asked.delete(owner);
}
