import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { linkKey, linkKindOf, linkRefusalLine, listMine, readObject, type Candidate, type CandidateList, type Fetcher, type ObjectRead } from './objects.ts';
import { quarterStore, type QuarterStore } from './store.ts';
import type { ChainLink } from './types.ts';

/**
 * The engine side of my quarter's buildings: what each linked object reads now, and the few steps that link one —
 * a wallet, its one signed message (no transaction), the person's own objects from the engine, a tap. The world keeps
 * the link; this store keeps only reads, each with the moment it was made, and reads again when one is opened.
 */

export type Connection = Readonly<{ wallet: string; address: string }>;

export type ProofResult = Readonly<{ ok: true }> | Readonly<{ ok: false; state: 'declined' | 'failed'; message: string }>;

/** A read, the moment it was made, and the wallet it was made under (a read under another wallet is not this one's). */
export type ReadEntry = Readonly<{ read: ObjectRead | null; loading: boolean; readAt: number; wallet: string | null }>;

/** Linking a plot's building: the steps in order, the list of the person's objects, and one line when a step fails. */
export type Picking = Readonly<{
  slot: number;
  step: 'wallet' | 'proof' | 'list' | 'saving';
  list: CandidateList | null;
  busy: boolean;
  error: string | null;
}>;

export type SiteState = {
  reads: Record<string, ReadEntry>;
  /** The wallet the city is connected to, handed in by the screen that watches it. */
  connection: Connection | null;
  /** The address whose signed proof this tab already sent. */
  proven: string | null;
  /** The wallet's message is out for its signature; and the one line when it came back unsigned. */
  signing: boolean;
  signError: string | null;
  picking: Picking | null;
  setConnection: (connection: Connection | null) => void;
  /** Read a linked object; a read younger than `maxAgeMs` is kept. */
  refresh: (link: ChainLink, maxAgeMs?: number) => Promise<void>;
  /** Start linking the building on this plot. */
  startLink: (slot: number) => Promise<void>;
  /**
   * The one signed message: proves the wallet to Ryntra (no transaction). While linking it then lists the person's
   * objects; otherwise it reads again what waited for it.
   */
  prove: () => Promise<void>;
  choose: (candidate: Candidate) => Promise<boolean>;
  cancel: () => void;
};

export type SiteOptions = {
  fetch?: Fetcher;
  prove?: (connection: Connection) => Promise<ProofResult>;
  quarter?: QuarterStore;
  now?: () => number;
};

/** How long a read stands before opening its building reads it again. */
export const READ_FRESH_MS = 60_000;

const browserFetch: Fetcher = (url, init) => fetch(url, init as RequestInit);
const browserProve = (connection: Connection) => import('../trade/proof.ts').then((m) => m.proveWallet(connection) as Promise<ProofResult>);

export function createSiteStore(options: SiteOptions = {}) {
  const doFetch = options.fetch ?? browserFetch;
  const doProve = options.prove ?? browserProve;
  const quarter = options.quarter ?? quarterStore;
  const now = options.now ?? (() => Date.now());

  return createStore<SiteState>()((set, get) => {
    const context = () => ({ fetch: doFetch, wallet: get().connection?.address ?? null, accountId: quarter.getState().me?.resident.accountId ?? null, now });
    const buildingAt = (slot: number) => quarter.getState().me?.buildings.find((b) => b.slot === slot) ?? null;
    const patch = (next: Partial<Picking>) => {
      const p = get().picking;
      if (p) set({ picking: { ...p, ...next } });
    };

    /** The person's own objects of the building's kind, from the engine. */
    const list = async (slot: number) => {
      const b = buildingAt(slot);
      if (!b) return get().cancel();
      patch({ step: 'list', busy: true, error: null, list: null });
      const answer = await listMine(b.kind, context());
      if (get().picking?.slot !== slot) return;
      // A read that still wants the proof goes back one step.
      patch(answer.state === 'proof' ? { step: 'proof', busy: false, list: null } : answer.state === 'wallet' ? { step: 'wallet', busy: false, list: null } : { busy: false, list: answer });
    };

    return {
      reads: {},
      connection: null,
      proven: null,
      signing: false,
      signError: null,
      picking: null,

      setConnection(connection) {
        const before = get().connection;
        if (before?.address === connection?.address && before?.wallet === connection?.wallet) return;
        set({ connection, proven: get().proven === connection?.address ? get().proven : null });
        // Reads that waited for a wallet can go now; a waiting picker moves on.
        for (const [key, entry] of Object.entries(get().reads)) if (entry.read?.state === 'wallet') set({ reads: { ...get().reads, [key]: { ...entry, readAt: 0 } } });
        const p = get().picking;
        if (p && p.step === 'wallet' && connection) set({ picking: { ...p, step: 'proof', error: null } });
      },

      async refresh(link, maxAgeMs = READ_FRESH_MS) {
        const key = linkKey(link);
        const had = get().reads[key];
        if (had?.loading) return;
        const ctx = context();
        if (had?.read && had.read.state !== 'wallet' && had.wallet === ctx.wallet && now() - had.readAt < maxAgeMs) return;
        set({ reads: { ...get().reads, [key]: { read: had?.read ?? null, loading: true, readAt: had?.readAt ?? 0, wallet: had?.wallet ?? null } } });
        const read = await readObject(link, ctx);
        // The wallet changed while the read was out: it is the other wallet's answer. Drop it and read again.
        if ((get().connection?.address ?? null) !== ctx.wallet) {
          set({ reads: { ...get().reads, [key]: { read: null, loading: false, readAt: 0, wallet: null } } });
          return get().refresh(link, 0);
        }
        set({ reads: { ...get().reads, [key]: { read, loading: false, readAt: now(), wallet: ctx.wallet } } });
      },

      async startLink(slot) {
        const b = buildingAt(slot);
        if (!b || !linkKindOf(b.kind)) return;
        const { connection, proven } = get();
        set({ picking: { slot, step: !connection ? 'wallet' : proven === connection.address ? 'list' : 'proof', list: null, busy: false, error: null } });
        if (connection && proven === connection.address) await list(slot);
      },

      async prove() {
        const p = get().picking;
        const connection = get().connection;
        if (p?.busy || get().signing) return;
        if (!connection) return p ? patch({ step: 'wallet' }) : undefined;
        if (p) patch({ busy: true, error: null });
        set({ signing: true, signError: null });
        const proof = await doProve(connection);
        set({ signing: false, signError: proof.ok ? null : proof.message });
        if (!proof.ok) return p && get().picking?.slot === p.slot ? patch({ busy: false, error: proof.message }) : undefined;
        // A signature made counts even if the picker was closed meanwhile: the next link needs no new one.
        if (get().connection?.address === connection.address) set({ proven: connection.address });
        // A sign-in may have given the resident an account; the paper book and strategies need it.
        await quarter.getState().reload();
        // Reads that waited for the proof go again.
        for (const b of quarter.getState().me?.buildings ?? []) {
          const entry = b.link ? get().reads[linkKey(b.link)] : null;
          if (b.link && entry?.read && (entry.read.state === 'proof' || entry.read.state === 'wallet')) void get().refresh(b.link, 0);
        }
        // The picker goes on only if it is still open on the same plot.
        if (p && get().picking?.slot === p.slot) await list(p.slot);
      },

      async choose(candidate) {
        const p = get().picking;
        if (!p || p.busy) return false;
        patch({ step: 'saving', busy: true, error: null });
        const done = await quarter.getState().link(p.slot, candidate.link);
        if (get().picking?.slot !== p.slot) return done.ok;
        if (!done.ok) {
          // The world wants the proof again (expired, or another wallet): back to that step.
          if (done.code === 'WALLET_REQUIRED') {
            set({ proven: null });
            patch({ step: 'proof', busy: false, error: linkRefusalLine(done.code, done.reason) });
          } else patch({ step: 'list', busy: false, error: linkRefusalLine(done.code, done.reason) });
          return false;
        }
        set({ picking: null });
        await get().refresh(candidate.link, 0);
        return true;
      },

      cancel() {
        set({ picking: null });
      },
    };
  });
}

export type SiteStore = ReturnType<typeof createSiteStore>;

export const siteStore: SiteStore = createSiteStore();

export function useSite<T>(pick: (state: SiteState) => T): T {
  return useStore(siteStore, pick);
}
