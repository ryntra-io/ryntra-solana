import { create } from 'zustand';
import { proveWallet, type ProofOutcome } from '../../city/lib/trade/proof.ts';
import { COPY_PATH, copiesOf, moneyOf, typedSol, type CopyForm, type CopyRow, type MoneyRow } from './copy-view.ts';
import type { MoneyFailure, MoneySign, MoneyStart, MoneyStop, Stuck } from './copy-money.ts';

/**
 * «Copy a wallet» — the person's copies where the engine keeps them (`/api/wallet-watch/copy`): with her wallet
 * proven to Ryntra by one signed message — no transaction — the copies are kept with it, on every device, and the
 * engine's pass fills them on paper as the wallet trades. Start, stop and read; nothing here signs a transaction, sends
 * or trades. With money — her start, stop and freeze go through `./copy-money.ts`, loaded on the tap; her wallet
 * signs, the server builds and relays. Her copies with money are read, and stopped, whatever the switch — only a
 * start (and its finish) waits for it.
 */

export type CopyStatus = 'idle' | 'reading' | 'ready' | 'proof' | 'proving' | 'failed';
export type CopyNote = 'started' | 'declined' | 'failed' | 'full' | 'money' | 'noCoins' | 'already' | 'partial' | null;

/**
 * What her last stop of a copy with money came to: the coins it left in her vault, named, and those her next stop takes.
 * `rest` — something still stands in her vault (her row keeps «Take the rest» after a reload too); `review` —
 * her unfinished start's, stopped from the server's record of it.
 */
export type StopNote = Readonly<{ policy: string; review: string | null; kind: 'stopped' | 'nothing' | 'declined' | 'failed'; stuck: readonly Stuck[]; left: number; failed: number; rest: boolean }>;

type Connection = Readonly<{ wallet: string; address: string }>;
type Answer = Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type CopyEnv = Readonly<{
  fetch: (url: string, init?: RequestInit) => Promise<Answer>;
  prove: (connection: Connection) => Promise<ProofOutcome>;
  /** Her wallet's one prompt for many transactions — the city's one door to a signature. */
  sign: MoneySign;
}>;

let env: CopyEnv = {
  fetch: (url, init) => fetch(url, { cache: 'no-store', credentials: 'same-origin', ...init, headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) } }),
  prove: proveWallet,
  sign: async (args) => (await import('../../city/lib/app-bridge/route.ts')).citySigner.signTransactions(args),
};

/** Swap what the store reaches: for tests, and nothing else. */
export function setCopyEnv(next: Partial<CopyEnv>): void {
  env = { ...env, ...next };
}

type Store = {
  owner: string | null;
  status: CopyStatus;
  rows: readonly CopyRow[];
  /** Her copies with money; `moneyRead` — false when the book did not answer. */
  money: readonly MoneyRow[];
  moneyRead: boolean;
  note: CopyNote;
  busy: boolean;
  /** What a money verb is busy with — `start`, or a copy's policy. */
  moneyBusy: string | null;
  stopNote: StopNote | null;
  /** The connected wallet changed (or went): the list follows it. */
  follow: (owner: string | null) => Promise<void>;
  /** One signed message, then the list. */
  prove: (connection: Connection) => Promise<boolean>;
  /** A copy on paper of `leader`, on her numbers; proves the wallet first when it must. */
  start: (connection: Connection, leader: string, form: CopyForm) => Promise<boolean>;
  stop: (leader: string) => Promise<void>;
  /** A copy with money of `leader`: her review, one signature, the copy into the book. */
  startMoney: (connection: Connection, leader: string, form: CopyForm) => Promise<boolean>;
  /** Her copy with money stopped — every policy off, the budget and the coins home, one signature. `review` — her unfinished start's. */
  stopMoney: (connection: Connection, policy: string, review?: string | null) => Promise<void>;
  /** Her unfinished start finished — one signature for what is missing, then her copy into the book. */
  finishMoney: (connection: Connection, policy: string, review: string) => Promise<boolean>;
  /** Her switch over the copy's new orders. */
  freezeMoney: (connection: Connection, policy: string, frozen: boolean) => Promise<void>;
  clearNote: () => void;
};

/** A money verb's refusal, in the form's words. */
function moneyNote(outcome: Exclude<MoneyStart, { kind: 'started' }>): CopyNote {
  if (outcome.kind === 'partial') return 'partial';
  if (outcome.kind === 'declined') return 'declined';
  if (outcome.kind === 'refused') return outcome.code === 'NO_COINS' ? 'noCoins' : outcome.code === 'ALREADY' ? 'already' : outcome.code === 'LIMIT' ? 'full' : 'failed';
  return 'failed';
}

/** A stop's outcome, as «My bots» says it. */
function stopNoteOf(policy: string, review: string | null, outcome: MoneyStop): StopNote {
  if (outcome.kind === 'stopped') return { policy, review, kind: 'stopped', stuck: outcome.stuck, left: outcome.left, failed: outcome.failed, rest: outcome.rest };
  if (outcome.kind === 'nothing') return { policy, review, kind: 'nothing', stuck: outcome.stuck, left: 0, failed: 0, rest: outcome.stuck.length > 0 };
  return { policy, review, kind: (outcome as MoneyFailure).kind === 'declined' ? 'declined' : 'failed', stuck: [], left: 0, failed: 0, rest: false };
}


async function json(answer: Answer): Promise<unknown> {
  try {
    return await answer.json();
  } catch {
    return null;
  }
}

let round = 0;

export const useCopies = create<Store>((set, get) => {
  /** The engine's answer after a change: its list, or the reason it was not taken. */
  const landed = async (answer: Answer | null): Promise<boolean> => {
    if (!answer) return false;
    if (answer.status === 401) {
      set({ status: 'proof' });
      return false;
    }
    const body = answer.ok ? await json(answer) : null;
    const rows = copiesOf(body);
    if (!rows) return false;
    const money = moneyOf(body);
    set({ rows, status: 'ready', money: money ?? get().money, moneyRead: money !== null });
    return true;
  };

  const post = (owner: string, leader: string, form: CopyForm) =>
    env
      .fetch(COPY_PATH, { method: 'POST', body: JSON.stringify({ address: owner, leader, perDaySol: typedSol(form.day), sharePct: form.share, days: form.days, slippagePct: form.bound }) })
      .catch(() => null);

  return {
    owner: null,
    status: 'idle',
    rows: [],
    money: [],
    moneyRead: true,
    note: null,
    busy: false,
    moneyBusy: null,
    stopNote: null,

    follow: async (owner) => {
      const my = ++round;
      if (!owner) {
        set({ owner: null, status: 'idle', rows: [], money: [], moneyRead: true, note: null, stopNote: null });
        return;
      }
      set({ owner, status: 'reading', ...(get().owner !== owner ? { rows: [], money: [], moneyRead: true, note: null, stopNote: null } : {}) });
      const answer = await env.fetch(`${COPY_PATH}?${new URLSearchParams({ address: owner })}`).catch(() => null);
      if (my !== round) return;
      if (!(await landed(answer)) && get().status !== 'proof') set({ status: 'failed' });
    },

    prove: async (connection) => {
      if (get().status === 'proving') return false;
      set({ status: 'proving', note: null });
      const proof = await env.prove(connection);
      if (get().owner !== connection.address) return false;
      if (!proof.ok) {
        set({ status: 'proof', note: proof.state === 'declined' ? 'declined' : 'failed' });
        return false;
      }
      await get().follow(connection.address);
      return get().status === 'ready';
    },

    start: async (connection, leader, form) => {
      if (get().busy || get().moneyBusy === 'start') return false;
      set({ busy: true, note: null });
      try {
        if (get().status === 'proof' && !(await get().prove(connection))) return false;
        let answer = await post(connection.address, leader, form);
        /* Not proven after all (a proof that lapsed): one signed message, then once more. */
        if (answer?.status === 401) {
          set({ status: 'proof' });
          if (!(await get().prove(connection))) return false;
          answer = await post(connection.address, leader, form);
        }
        if (answer?.status === 409) {
          set({ note: 'full' });
          return false;
        }
        const ok = await landed(answer);
        set({ note: ok ? 'started' : get().status === 'proof' ? get().note : 'failed' });
        return ok;
      } finally {
        set({ busy: false });
      }
    },

    stop: async (leader) => {
      const owner = get().owner;
      if (!owner) return;
      const answer = await env.fetch(`${COPY_PATH}?${new URLSearchParams({ address: owner, leader })}`, { method: 'DELETE' }).catch(() => null);
      if (!(await landed(answer))) set({ note: 'failed' });
    },

    startMoney: async (connection, leader, form) => {
      if (get().busy || get().moneyBusy) return false;
      set({ moneyBusy: 'start', note: null });
      try {
        if (get().status === 'proof' && !(await get().prove(connection))) return false;
        const money = await import('./copy-money.ts');
        const deps = { fetch: env.fetch, sign: env.sign };
        let outcome = await money.startWithMoney(connection, leader, form, deps);
        /* Not proven after all (a proof that lapsed): one signed message, then once more — nothing was relayed. */
        if (outcome.kind === 'proof') {
          set({ status: 'proof' });
          if (!(await get().prove(connection))) return false;
          outcome = await money.startWithMoney(connection, leader, form, deps);
        }
        if (outcome.kind !== 'started') {
          set({ note: outcome.kind === 'proof' ? 'failed' : moneyNote(outcome) });
          /* What landed of it is listed — unfinished, to finish or to take home. */
          if (outcome.kind === 'partial' || outcome.kind === 'refused' || outcome.kind === 'unreachable') await get().follow(connection.address);
          return false;
        }
        await get().follow(connection.address);
        set({ note: 'money' });
        return true;
      } finally {
        set({ moneyBusy: null });
      }
    },

    stopMoney: async (connection, policy, review = null) => {
      if (get().moneyBusy) return;
      set({ moneyBusy: policy, stopNote: null });
      try {
        const money = await import('./copy-money.ts');
        const deps = { fetch: env.fetch, sign: env.sign };
        let outcome = await money.stopWithMoney(connection, policy, deps, review);
        if (outcome.kind === 'proof') {
          set({ status: 'proof' });
          if (!(await get().prove(connection))) return;
          outcome = await money.stopWithMoney(connection, policy, deps, review);
        }
        set({ stopNote: stopNoteOf(policy, review, outcome) });
        /* Built or not, her copy was frozen first: the list says what stands now. */
        await get().follow(connection.address);
      } finally {
        set({ moneyBusy: null });
      }
    },

    finishMoney: async (connection, policy, review) => {
      if (get().busy || get().moneyBusy) return false;
      set({ moneyBusy: policy, note: null, stopNote: null });
      try {
        const money = await import('./copy-money.ts');
        const deps = { fetch: env.fetch, sign: env.sign };
        let outcome = await money.finishWithMoney(connection, policy, review, deps);
        if (outcome.kind === 'proof') {
          set({ status: 'proof' });
          if (!(await get().prove(connection))) return false;
          outcome = await money.finishWithMoney(connection, policy, review, deps);
        }
        set({ note: outcome.kind === 'started' ? 'money' : outcome.kind === 'proof' ? 'failed' : moneyNote(outcome) });
        await get().follow(connection.address);
        return outcome.kind === 'started';
      } finally {
        set({ moneyBusy: null });
      }
    },

    freezeMoney: async (connection, policy, frozen) => {
      if (get().moneyBusy) return;
      set({ moneyBusy: policy });
      try {
        const money = await import('./copy-money.ts');
        let outcome = await money.freezeWithMoney(connection, policy, frozen, { fetch: env.fetch });
        if (outcome.kind === 'proof') {
          set({ status: 'proof' });
          if (!(await get().prove(connection))) return;
          outcome = await money.freezeWithMoney(connection, policy, frozen, { fetch: env.fetch });
        }
        if (outcome.kind !== 'done') set({ note: 'failed' });
        await get().follow(connection.address);
      } finally {
        set({ moneyBusy: null });
      }
    },

    clearNote: () => set({ note: null }),
  };
});
