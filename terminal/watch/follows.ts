import { create } from 'zustand';
import type { Lang } from '../../city/lib/i18n/langs.ts';
import { proveWallet, type ProofOutcome } from '../../city/lib/trade/proof.ts';
import { readOnce } from './wallet-reads.ts';
import { listAdd, listRemove, listRename, LOCAL_KEY, localListOf, nameOf, serverListOf, toMove, type Follow } from './watch-view.ts';

/**
 * The wallets a person watches, where the engine already keeps them (`/api/wallet-watch`): with a wallet that proved
 * itself to Ryntra, the list is kept with it — on every device, and the engine tells of their new trades in the
 * person's notifications, Telegram and push. Without one, the same list lives in this browser and moves to the wallet
 * the first time it proves itself. No new table: the engine's own record, or the browser.
 *
 * The screen never opens the wallet by itself: «Keep with my wallet» is one tap that signs one message — no
 * transaction. Nothing here signs a transaction, sends or trades.
 */

export type ListMode = 'local' | 'server';
export type ListStatus = 'ready' | 'reading' | 'proof' | 'proving' | 'failed';
export type ListNote = 'declined' | 'failed' | 'full' | 'bad' | 'noCreator' | null;
export type AddOutcome = Readonly<{ ok: true; address: string }> | Readonly<{ ok: false; note: Exclude<ListNote, null> }>;

type Connection = Readonly<{ wallet: string; address: string }>;
type Answer = Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type FollowsEnv = Readonly<{
  fetch: (url: string, init?: RequestInit) => Promise<Answer>;
  prove: (connection: Connection) => Promise<ProofOutcome>;
  load: () => string | null;
  save: (raw: string) => void;
  now: () => number;
}>;

let env: FollowsEnv = {
  fetch: (url, init) => fetch(url, { cache: 'no-store', credentials: 'same-origin', ...init, headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) } }),
  prove: proveWallet,
  load: () => {
    try {
      return window.localStorage.getItem(LOCAL_KEY);
    } catch {
      return null;
    }
  },
  save: (raw) => {
    try {
      window.localStorage.setItem(LOCAL_KEY, raw);
    } catch {
      /* Storage shut: the list holds for this visit. */
    }
  },
  now: () => Date.now(),
};

/** Swap what the list reaches: for tests, and nothing else. */
export function setFollowsEnv(next: Partial<FollowsEnv>): void {
  env = { ...env, ...next };
}

type Store = {
  owner: string | null;
  mode: ListMode;
  status: ListStatus;
  list: readonly Follow[];
  /** Whether the engine tells the person of each wallet's trades (the engine's list only). */
  notes: Readonly<Record<string, boolean>>;
  note: ListNote;
  read: boolean;
  /** The browser's list, once, after the page has drawn. */
  hydrate: () => void;
  /** The connected wallet changed (or went): the list follows it. */
  follow: (owner: string | null, lang: Lang) => Promise<void>;
  /** «Keep with my wallet»: one signed message, then the browser's wallets move to the engine's list. */
  keep: (connection: Connection, lang: Lang) => Promise<void>;
  add: (target: string, name: string | null, lang: Lang, creatorName: (symbol: string) => string) => Promise<AddOutcome>;
  remove: (address: string, lang: Lang) => Promise<void>;
  rename: (address: string, name: string | null, lang: Lang) => Promise<void>;
  setNotes: (address: string, on: boolean, lang: Lang) => Promise<void>;
};

const API = '/api/wallet-watch';

function localNow(): Follow[] {
  return localListOf(env.load());
}

function notesOf(raw: unknown): Record<string, boolean> {
  const wallets = (raw as { wallets?: unknown } | null)?.wallets;
  const out: Record<string, boolean> = {};
  if (Array.isArray(wallets)) for (const row of wallets) if (row && typeof row.address === 'string') out[row.address] = row.alerts !== 'off';
  return out;
}

async function json(answer: Answer): Promise<unknown> {
  try {
    return await answer.json();
  } catch {
    return null;
  }
}

let round = 0;

export const useFollows = create<Store>((set, get) => {
  const keepLocal = (list: readonly Follow[]) => {
    env.save(JSON.stringify(list));
    set({ list });
  };

  /** The engine's answer after a change: its list, or the reason it was not taken. */
  const landed = async (answer: Answer): Promise<boolean> => {
    const body = await json(answer);
    const list = answer.ok ? serverListOf(body) : null;
    if (list) {
      set({ list, notes: notesOf(body), status: 'ready', note: null });
      return true;
    }
    if (answer.status === 401) set({ mode: 'local', status: 'proof', list: localNow(), notes: {} });
    return false;
  };

  /** The browser's wallets the engine does not hold yet, moved to it; each one taken leaves the browser's list. */
  const moveLocal = async (owner: string, server: readonly Follow[], lang: Lang): Promise<void> => {
    let local = localNow();
    for (const row of toMove(local, server)) {
      const answer = await env.fetch(API, { method: 'POST', body: JSON.stringify({ address: owner, target: row.address, ...(row.name ? { name: row.name } : {}), locale: lang }) }).catch(() => null);
      if (!answer || !(await landed(answer))) break;
      local = listRemove(local, row.address);
      env.save(JSON.stringify(local));
    }
    // What the engine already held of them is the engine's now: the browser keeps only what did not move.
    const held = new Set(get().list.map((row) => row.address));
    env.save(JSON.stringify(local.filter((row) => !held.has(row.address))));
  };

  return {
    owner: null,
    mode: 'local',
    status: 'ready',
    list: [],
    notes: {},
    note: null,
    read: false,

    hydrate: () => {
      if (get().read) return;
      set({ read: true, ...(get().mode === 'local' ? { list: localNow() } : {}) });
    },

    follow: async (owner, lang) => {
      const my = ++round;
      if (!owner) {
        set({ owner: null, mode: 'local', status: 'ready', list: localNow(), notes: {}, note: null, read: true });
        return;
      }
      set({ owner, status: 'reading', note: null, ...(get().owner !== owner ? { mode: 'local' as const, list: localNow(), notes: {} } : {}), read: true });
      const answer = await env.fetch(`${API}?${new URLSearchParams({ address: owner })}`).catch(() => null);
      if (my !== round) return;
      if (!answer) {
        set({ status: 'failed' });
        return;
      }
      if (answer.status === 401) {
        set({ mode: 'local', status: 'proof', list: localNow() });
        return;
      }
      const body = await json(answer);
      const list = answer.ok ? serverListOf(body) : null;
      if (my !== round) return;
      if (!list) {
        set({ status: 'failed' });
        return;
      }
      set({ mode: 'server', status: 'ready', list, notes: notesOf(body) });
      if (localNow().length > 0) await moveLocal(owner, list, lang);
    },

    keep: async (connection, lang) => {
      if (get().status === 'proving') return;
      set({ status: 'proving', note: null });
      const proof = await env.prove(connection);
      if (get().owner !== connection.address) return;
      if (!proof.ok) {
        set({ status: 'proof', note: proof.state === 'declined' ? 'declined' : 'failed' });
        return;
      }
      await get().follow(connection.address, lang);
    },

    add: async (target, typedName, lang, creatorName) => {
      const name = nameOf(typedName);
      const { mode, owner } = get();
      if (mode === 'server' && owner) {
        const answer = await env.fetch(API, { method: 'POST', body: JSON.stringify({ address: owner, target, ...(name ? { name } : {}), locale: lang }) }).catch(() => null);
        if (!answer) return { ok: false, note: 'failed' };
        const body = await json(answer);
        const list = answer.ok ? serverListOf(body) : null;
        if (list) {
          set({ list, notes: notesOf(body), note: null });
          const followed = (body as { followed?: unknown }).followed;
          return { ok: true, address: typeof followed === 'string' ? followed : target };
        }
        const code = (body as { code?: unknown } | null)?.code;
        if (answer.status === 401) {
          set({ mode: 'local', status: 'proof', list: localNow(), notes: {} });
          return get().add(target, typedName, lang, creatorName);
        }
        const note: Exclude<ListNote, null> = code === 'LIMIT' ? 'full' : code === 'NO_CREATOR' ? 'noCreator' : answer.status === 400 ? 'bad' : 'failed';
        set({ note });
        return { ok: false, note };
      }
      // In the browser: what the address is, first — a coin's is its creator's wallet, as the engine's list does.
      let address = target;
      let kept = name;
      const read = await readOnce(target);
      if (read.kind === 'bad') return { ok: false, note: 'bad' };
      if (read.kind === 'coin') {
        if (!read.creator) return { ok: false, note: 'noCreator' };
        address = read.creator;
        kept = name ?? nameOf(creatorName(read.symbol));
      }
      const change = listAdd(localNow(), address, kept, new Date(env.now()).toISOString());
      if (!change.ok) {
        set({ note: 'full' });
        return { ok: false, note: 'full' };
      }
      keepLocal(change.list);
      set({ note: null });
      return { ok: true, address };
    },

    remove: async (address, lang) => {
      const { mode, owner, list } = get();
      if (mode === 'server' && owner) {
        // Off the screen at once; the engine's answer is the list.
        set({ list: listRemove(list, address) });
        const answer = await env.fetch(`${API}?${new URLSearchParams({ address: owner, wallet: address, locale: lang })}`, { method: 'DELETE' }).catch(() => null);
        const ok = answer ? await landed(answer) : false;
        // Not taken: the row comes back, unless the list went back to the browser (the proof expired).
        if (!ok && get().mode === 'server') set({ list, note: 'failed' });
        return;
      }
      keepLocal(listRemove(localNow(), address));
    },

    rename: async (address, typedName, lang) => {
      const name = nameOf(typedName);
      const { mode, owner, list } = get();
      if (mode === 'server' && owner) {
        set({ list: listRename(list, address, name) });
        const answer = await env.fetch(API, { method: 'PATCH', body: JSON.stringify({ address: owner, wallet: address, name, locale: lang }) }).catch(() => null);
        const ok = answer ? await landed(answer) : false;
        if (!ok && get().mode === 'server') set({ list, note: 'failed' });
        return;
      }
      keepLocal(listRename(localNow(), address, name));
    },

    setNotes: async (address, on, lang) => {
      const { mode, owner, notes } = get();
      if (mode !== 'server' || !owner) return;
      set({ notes: { ...notes, [address]: on } });
      const answer = await env.fetch(API, { method: 'PATCH', body: JSON.stringify({ address: owner, wallet: address, alerts: on ? 'all' : 'off', locale: lang }) }).catch(() => null);
      const ok = answer ? await landed(answer) : false;
      if (!ok && get().mode === 'server') set({ notes, note: 'failed' });
    },
  };
});
