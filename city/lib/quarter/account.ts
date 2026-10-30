import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { wordsNow } from '../i18n/dict.ts';
import type { QuarterStore } from './store.ts';
import { ACCOUNT_WORDS } from './words.ts';

/**
 * Whose quarter this is. A quarter is kept under a Ryntra account, and in the city that account is a wallet signed in
 * with Ryntra's own Sign In With Solana: one message, no transaction. The city stays open to everyone; claiming a spot
 * and building ask for the wallet first, connect it and sign in if needed, then go on to the claim or the build.
 * After the sign-in the world reads the place again, so a guest's quarter joins the account and the same wallet finds
 * it on any device. Another wallet reads its own place; no wallet, or one not signed in, sees the city as a visitor.
 */

export type Connection = Readonly<{ wallet: string; address: string }>;

/** What this browser's Ryntra session says, as the shared wallet fact keeps it (`lib/account/wallet-proof-store.client.ts`). */
export type SessionFact = Readonly<{ status: 'unknown' | 'known' | 'down'; signedIn: boolean; walletAddress: string | null }>;

export type ProofResult = Readonly<{ ok: true }> | Readonly<{ ok: false; state: 'declined' | 'failed'; message: string }>;

/** Where a step stands for a wallet: none connected, the session not read yet, a sign-in needed, or ready to build. */
export type Readiness = 'wallet' | 'checking' | 'sign' | 'ready';

/**
 * The account a quarter is read under: `null` — a visitor (no wallet, or a wallet this browser has not signed in
 * with); `undefined` — the session has not answered yet, nothing changes; a key — the signed-in account.
 * An account opened by another door (email, Google) with a wallet connected keeps its own quarter.
 */
export function accountKey(fact: SessionFact, connection: Connection | null): string | null | undefined {
  if (!connection) return null;
  if (fact.status !== 'known') return undefined;
  if (!fact.signedIn) return null;
  if (fact.walletAddress === connection.address) return `wallet:${connection.address}`;
  if (fact.walletAddress === null) return `account:${connection.address}`;
  // Signed in with another wallet: this one has not signed.
  return null;
}

export function readiness(fact: SessionFact, connection: Connection | null): Readiness {
  if (!connection) return 'wallet';
  const key = accountKey(fact, connection);
  return key === undefined ? 'checking' : key === null ? 'sign' : 'ready';
}

/** What waits for the wallet: a spot to claim, the build mode to enter, or nothing (the top bar's own connect). */
export type Intent = 'claim' | 'build' | null;
/** Where the request came from, so its one line shows there. */
export type From = 'card' | 'top';

export type AccountState = {
  /** `pick`: the list of wallets is open; the others are on their way. */
  step: 'pick' | 'connecting' | 'signing' | 'opening' | null;
  /** The wallet a tap is connecting. */
  connectingTo: string | null;
  intent: Intent;
  from: From | null;
  /** One honest line about the last step that did not go. */
  error: string | null;
  /** Connect if needed, sign in if needed, then claim or build. True when it went all the way. */
  begin: (intent: Intent, from: From) => Promise<boolean>;
  /** A wallet picked from the list. */
  pick: (name: string) => Promise<boolean>;
  /** Close the list of wallets; nothing happens. */
  cancel: () => void;
  /** Let the wallet go and sign its session out: the city is a visitor's again. */
  disconnect: () => Promise<void>;
  /** Read the wallet and the session again and show the quarter of whoever is signed in. */
  sync: () => Promise<void>;
  /** Follow the wallet and the session from now on. */
  start: () => () => void;
};

export type AccountDeps = {
  quarter: QuarterStore;
  wallet: {
    connection(): Connection | null;
    wallets(): readonly Readonly<{ name: string }>[];
    /** True once connected; false when the person closed the wallet or it refused (its line in `error()`). */
    connect(name: string): Promise<boolean>;
    error(): string | null;
    disconnect(): void;
    subscribe(listener: () => void): () => void;
  };
  session: {
    fact(): SessionFact;
    revalidate(): Promise<SessionFact>;
    subscribe(listener: () => void): () => void;
  };
  /** Ryntra's Sign In With Solana for this wallet (`proveWallet`, signing in). */
  signIn(connection: Connection): Promise<ProofResult>;
  /** Close the wallet's session on the server (the rest of Ryntra's Disconnect). */
  signOut(): Promise<void>;
};

/** The sign-in's one-line answers, in the language on screen when they are said (`./words.ts`). */
export const LINES: Readonly<Record<'noWallet' | 'declined' | 'changed' | 'notHeld', string>> = {
  get noWallet() {
    return wordsNow(ACCOUNT_WORDS).noWallet;
  },
  get declined() {
    return wordsNow(ACCOUNT_WORDS).declined;
  },
  get changed() {
    return wordsNow(ACCOUNT_WORDS).changed;
  },
  get notHeld() {
    return wordsNow(ACCOUNT_WORDS).notHeld;
  },
};

export function createAccountStore(deps: AccountDeps) {
  const { quarter, wallet, session } = deps;

  return createStore<AccountState>()((set, get) => {
    const busy = () => get().step !== null && get().step !== 'pick';
    const stop = (error: string | null) => {
      set({ step: null, connectingTo: null, intent: null, error });
      return false;
    };

    /** The wallet is here: sign in if this browser has not with it, read its place, then do what waited. */
    const signThen = async (): Promise<boolean> => {
      const connection = wallet.connection();
      if (!connection) return stop(LINES.noWallet);
      let fact = session.fact();
      if (fact.status !== 'known') fact = await session.revalidate();
      if (readiness(fact, connection) !== 'ready') {
        set({ step: 'signing', connectingTo: null });
        const proof = await deps.signIn(connection);
        if (!proof.ok) return stop(proof.state === 'declined' ? LINES.declined : proof.message);
        if (wallet.connection()?.address !== connection.address) return stop(LINES.changed);
      }
      const key = accountKey(session.fact(), connection);
      if (!key) return stop(LINES.notHeld);
      set({ step: 'opening' });
      // The world joins a guest's place to the account on this read, once.
      await quarter.getState().setOwner(key);
      const intent = get().intent;
      set({ step: null, connectingTo: null, intent: null, error: null });
      if (!intent) return true;
      const q = quarter.getState();
      if (q.owner !== key) return false;
      if (q.status === 'resident') {
        q.enter();
        return true;
      }
      return q.claim();
    };

    const connectThen = async (name: string): Promise<boolean> => {
      set({ step: 'connecting', connectingTo: name, error: null });
      const ok = await wallet.connect(name);
      if (!ok || !wallet.connection()) return stop(wallet.error() ?? LINES.noWallet);
      return signThen();
    };

    return {
      step: null,
      connectingTo: null,
      intent: null,
      from: null,
      error: null,

      async begin(intent, from) {
        if (busy()) return false;
        set({ intent, from, error: null });
        if (wallet.connection()) return signThen();
        const list = wallet.wallets();
        // One wallet in this browser: straight to it. Several, or none: the list says which, or where to get one.
        if (list.length === 1) return connectThen(list[0]!.name);
        set({ step: 'pick' });
        return false;
      },

      async pick(name) {
        if (busy()) return false;
        return connectThen(name);
      },

      cancel() {
        if (get().step === 'pick') set({ step: null, intent: null, error: null });
      },

      async disconnect() {
        set({ step: null, connectingTo: null, intent: null, error: null });
        wallet.disconnect();
        await get().sync();
        await deps.signOut();
      },

      async sync() {
        await quarter.getState().setOwner(accountKey(session.fact(), wallet.connection()));
      },

      start() {
        const follow = () => void get().sync();
        const offWallet = wallet.subscribe(follow);
        const offSession = session.subscribe(follow);
        if (session.fact().status === 'unknown') void session.revalidate();
        follow();
        return () => {
          offWallet();
          offSession();
        };
      },
    };
  });
}

export type AccountStore = ReturnType<typeof createAccountStore>;

export function useAccountOf<T>(store: AccountStore, pick: (state: AccountState) => T): T {
  return useStore(store, pick);
}
