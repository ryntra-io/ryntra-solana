import { create } from 'zustand';
import { checkBeacons, isLit, mergeStates, sanitizeBeacons, sanitizeStates, type BeaconRule, type BeaconStates, type TowerRead } from '../../../lib/world/beacons/rules.ts';
import type { CitySnapshot } from '../market/types.ts';
import { BEACONS } from './switch.ts';

/**
 * The city's beacons (CITY-72): the rules a person put on towers, and which of them are lit.
 *
 * The rules live on the device at once and, once the wallet signed in, on the server under the account
 * (`/api/world/beacons`), where the server's check tells Telegram. The city runs the same engine on every market read
 * it already makes (`/api/city`): a tower lights when its beacon fires here or on the server, whichever came later.
 * Until the server keeps beacons (its migration applied by the owner), the device alone does.
 *
 * Nothing here moves money or signs: a beacon only lights a tower and tells.
 */

const SAVED = 'ryntra.city.beacons.v1';

export type TelegramState = 'linked' | 'unlinked' | null;
/** `local`: on this device only; `synced`: the server has it; `saving`: on its way. */
export type Sync = 'local' | 'saving' | 'synced';

type Answer = Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type BeaconEnv = Readonly<{
  fetch: (url: string, init?: RequestInit) => Promise<Answer>;
  storage: () => Pick<Storage, 'getItem' | 'setItem'> | null;
  now: () => number;
  open: (url: string) => void;
  /** The account keeps beacons and Telegram is told: only where the deployment opened them (`BEACONS === 'open'`). */
  server: boolean;
}>;

let env: BeaconEnv = {
  fetch: (url, init) => fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init, headers: { accept: 'application/json', ...(init?.headers ?? {}) } }),
  storage: () => {
    try {
      return typeof window === 'undefined' ? null : window.localStorage;
    } catch {
      return null;
    }
  },
  now: () => Date.now(),
  open: (url) => {
    window.open(url, '_blank', 'noopener');
  },
  server: BEACONS === 'open',
};

/** Swap what the store reaches: for tests, and nothing else. */
export function setBeaconEnv(next: Partial<BeaconEnv>): void {
  env = { ...env, ...next };
}

type Saved = { rules: unknown; states: unknown };

function readSaved(): { rules: readonly BeaconRule[]; states: BeaconStates } {
  try {
    const raw = JSON.parse(env.storage()?.getItem(SAVED) ?? 'null') as Partial<Saved> | null;
    const rules = sanitizeBeacons(raw?.rules);
    return { rules, states: sanitizeStates(raw?.states, rules) };
  } catch {
    return { rules: [], states: {} };
  }
}

function writeSaved(rules: readonly BeaconRule[], states: BeaconStates): void {
  try {
    env.storage()?.setItem(SAVED, JSON.stringify({ rules, states }));
  } catch {
    // A private window keeps the beacons for this visit only.
  }
}

/** What a tower's beacons look like in the city: none, set and waiting, or lit. */
export type Glow = 'set' | 'lit';

type BeaconState = {
  rules: readonly BeaconRule[];
  /** The city's own engine states, merged with the server's. */
  states: BeaconStates;
  /** The server's revision of the list; null until it answered. */
  revision: number | null;
  sync: Sync;
  /** Signed in with a wallet: the server keeps the list. */
  signedIn: boolean;
  telegram: TelegramState;
  /** The tower whose beacon editor is open. */
  openFor: string | null;
  /** Glow by mint, kept in step with `rules` and `states`. */
  glow: ReadonlyMap<string, Glow>;
  loaded: boolean;

  load: () => void;
  /** Read the server's list: after a sign-in, and when the tab comes back. Adopts the device's list when it has none. */
  pull: (signedIn: boolean) => Promise<void>;
  /** Replace the whole list: on the device at once, then on the server when signed in. */
  save: (rules: readonly BeaconRule[]) => Promise<boolean>;
  /** One market read of the city: every beacon checked. */
  check: (snapshot: CitySnapshot) => void;
  open: (mint: string) => void;
  close: () => void;
  /** The account's Telegram: the bot's link, opened in a new tab. */
  linkTelegram: () => Promise<boolean>;
};

function glowOf(rules: readonly BeaconRule[], states: BeaconStates, now: number): ReadonlyMap<string, Glow> {
  const glow = new Map<string, Glow>();
  for (const rule of rules) {
    if (!rule.on) continue;
    if (isLit(rule, states[rule.id], now)) glow.set(rule.mint, 'lit');
    else if (!glow.has(rule.mint)) glow.set(rule.mint, 'set');
  }
  return glow;
}

type ServerList = { revision: number; rules: readonly BeaconRule[]; states: BeaconStates; telegram?: TelegramState };

function listOf(body: unknown): ServerList | null {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  if (!b || typeof b.revision !== 'number' || !Array.isArray(b.rules)) return null;
  const rules = sanitizeBeacons(b.rules);
  const telegram = b.telegram === 'linked' || b.telegram === 'unlinked' ? b.telegram : null;
  return { revision: b.revision, rules, states: sanitizeStates(b.states, rules), telegram };
}

export const useBeacons = create<BeaconState>((set, get) => {
  const settle = (rules: readonly BeaconRule[], states: BeaconStates, more: Partial<BeaconState> = {}) => {
    const kept = mergeStates(rules, states, {});
    writeSaved(rules, kept);
    set({ rules, states: kept, glow: glowOf(rules, kept, env.now()), ...more });
  };

  const push = async (rules: readonly BeaconRule[], revision: number): Promise<boolean> => {
    set({ sync: 'saving' });
    let answer: Answer;
    try {
      answer = await env.fetch('/api/world/beacons', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision, rules }),
      });
    } catch {
      set({ sync: 'local' });
      return false;
    }
    const body = listOf(await answer.json().catch(() => null));
    if (answer.ok && body) {
      settle(body.rules, mergeStates(body.rules, get().states, body.states), { revision: body.revision, sync: 'synced' });
      return true;
    }
    if (answer.status === 409 && body) {
      // Changed on another device: the server's list stands, and this one shows it.
      settle(body.rules, mergeStates(body.rules, get().states, body.states), { revision: body.revision, sync: 'synced' });
      return false;
    }
    if (answer.status === 401) set({ signedIn: false });
    set({ sync: 'local' });
    return false;
  };

  return {
    rules: [],
    states: {},
    revision: null,
    sync: 'local',
    signedIn: false,
    telegram: null,
    openFor: null,
    glow: new Map(),
    loaded: false,

    load() {
      if (get().loaded) return;
      const saved = readSaved();
      set({ loaded: true });
      settle(saved.rules, saved.states);
    },

    async pull(signedIn) {
      set({ signedIn });
      if (!signedIn || !env.server) {
        set({ revision: null, sync: 'local', telegram: null });
        return;
      }
      let answer: Answer;
      try {
        answer = await env.fetch('/api/world/beacons');
      } catch {
        return;
      }
      if (answer.status === 401) {
        set({ signedIn: false, revision: null, sync: 'local', telegram: null });
        return;
      }
      const body = answer.ok ? listOf(await answer.json().catch(() => null)) : null;
      if (!body) return;
      set({ telegram: body.telegram ?? null });
      if (body.revision === 0 && get().rules.length > 0) {
        // The account keeps no beacons yet: the ones set on this device become the account's.
        await push(get().rules, 0);
        return;
      }
      settle(body.rules, mergeStates(body.rules, get().states, body.states), { revision: body.revision, sync: 'synced' });
    },

    async save(rules) {
      const clean = sanitizeBeacons(rules);
      settle(clean, get().states);
      const { signedIn, revision } = get();
      if (!signedIn || revision === null || !env.server) return true;
      return push(clean, revision);
    },

    check(snapshot) {
      const { rules, states } = get();
      if (!rules.length) return;
      const now = env.now();
      const live = snapshot.source === 'live';
      const at = live ? Date.parse(snapshot.fetchedAt) : NaN;
      const towers = new Map<string, TowerRead>(
        live ? snapshot.towers.map((t) => [t.id, { price: t.price, liquidity: t.liquidity, change5m: t.change5m, change1h: t.change1h, change24h: t.change24h }]) : [],
      );
      const next = checkBeacons(rules, states, towers, Number.isFinite(at) ? at : null, now);
      settle(rules, next.states);
    },

    open(mint) {
      set({ openFor: mint });
    },

    close() {
      set({ openFor: null });
    },

    async linkTelegram() {
      if (!env.server) return false;
      try {
        const answer = await env.fetch('/api/account/notifications', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'start' }),
        });
        const body = (await answer.json().catch(() => null)) as { link?: unknown } | null;
        if (!answer.ok || typeof body?.link !== 'string' || !body.link.startsWith('https://t.me/')) return false;
        env.open(body.link);
        return true;
      } catch {
        return false;
      }
    },
  };
});

/** Refresh which towers glow: a lit beacon goes dark half an hour after it fired, without a new read. */
export function refreshGlow(): void {
  const { rules, states } = useBeacons.getState();
  useBeacons.setState({ glow: glowOf(rules, states, env.now()) });
}

/** The beacons on one tower. */
export const beaconsOn = (rules: readonly BeaconRule[], mint: string): readonly BeaconRule[] => rules.filter((rule) => rule.mint === mint);
