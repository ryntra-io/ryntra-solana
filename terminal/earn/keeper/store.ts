import { create } from 'zustand';
import { citySigner } from '../../../city/lib/app-bridge/route.ts';
import { DEFAULT_KEEPER_CHOICE, type KeeperChoice, type KeeperStatus } from '../../../lib/care/stock-keeper-terms.ts';
import type { CoinWords, KeeperMode, KeeperTerms } from '../../../lib/care/range-limits.ts';
import { sameChoice } from './model.ts';

/**
 * The keeper's state on the position screen: the wallet's keepers as the server reads them, the position
 * whose bounds are open, the person's choice, the server's Review of exactly that choice, and where the signature is.
 *
 * The flow is the care's own (`city/lib/earn/care.ts`): the Review is built while the bounds are read, the wallet
 * signs in one prompt, the server relays only the transaction it built. Each change is the proven wallet's own
 * (`lib/care/door.server.ts`): one signed message first, none where this browser already holds the proof. «Stop» builds
 * the rights taken back; the keeper works until the chain shows them signed and sent.
 */

export type Wallet = Readonly<{ wallet: string; address: string }>;
export type KeeperPhase = 'idle' | 'reviewing' | 'wallet' | 'sending' | 'done' | 'stopped' | 'failed' | 'cancelled';
export const KEEPER_LOCKED: ReadonlySet<KeeperPhase> = new Set(['wallet', 'sending']);

export type KeeperReview = Readonly<{ key: string; nftMint: string; choice: KeeperChoice; transactions: readonly string[]; mode: KeeperMode; terms: KeeperTerms; coins: Readonly<{ x: CoinWords; y: CoinWords }>; network: 'devnet' | 'mainnet' }>;
export type Loaded = Readonly<{ status: 'idle' | 'loading' | 'closed' | 'error' }> | Readonly<{ status: 'ready'; value: KeeperStatus; owner: string; at: number }>;

type Answer<T> = (T & { ok: true }) | Readonly<{ ok: false; code: string }>;

export type KeeperPost = (body: Record<string, unknown>) => Promise<Answer<Record<string, unknown>>>;
export type KeeperSign = (wallet: Wallet, unsigned: readonly string[], network: 'devnet' | 'mainnet') => Promise<readonly string[] | null>;

const browserPost: KeeperPost = async (body) => {
  try {
    const response = await fetch('/api/city/earn/keeper', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 404) return { ok: false, code: 'KEEPER_CLOSED' };
    const json = (await response.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: { code?: string } }) | null;
    if (!response.ok || !json?.ok) return { ok: false, code: typeof json?.error?.code === 'string' ? json.error.code : 'UNAVAILABLE' };
    return json as Record<string, unknown> & { ok: true };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
};

const browserSign: KeeperSign = async (wallet, unsigned, network) => {
  const signed = await citySigner.signTransactions({ wallet: wallet.wallet as never, address: wallet.address, unsignedWireBase64: [...unsigned], chain: `solana:${network}` } as never);
  return signed.ok ? (signed as { signedWireBase64: readonly string[] }).signedWireBase64 : null;
};

/**
 * The wallet's proof for a change: `ok`; `unproven` — this browser holds none, and the wallet was not asked (`ask`
 * false: the screen never opens the wallet by itself); the person said no; or it did not go through.
 */
export type KeeperProve = (wallet: Wallet, ask: boolean) => Promise<'ok' | 'unproven' | 'declined' | 'failed'>;

const browserProve: KeeperProve = async (wallet, ask) => {
  if (!ask) {
    const facts = await import('../../../lib/account/wallet-proof-store.client.ts');
    const fact = facts.walletFact().status === 'known' ? facts.walletFact() : await facts.revalidateWalletFact();
    return facts.proofCanAct(fact, wallet.address) ? 'ok' : 'unproven';
  }
  const { proveWallet } = await import('../../../city/lib/trade/proof.ts');
  const proof = await proveWallet({ wallet: wallet.wallet, address: wallet.address });
  return proof.ok ? 'ok' : proof.state === 'declined' ? 'declined' : 'failed';
};

let reach: Readonly<{ post: KeeperPost; sign: KeeperSign; prove: KeeperProve }> = { post: browserPost, sign: browserSign, prove: browserProve };
/** Tests and the stand's shots put their own reach here. */
export function setKeeperReach(next: Partial<typeof reach>): void {
  reach = { ...reach, ...next };
}

const STATUS_FRESH_MS = 20_000;

type Store = {
  loaded: Loaded;
  /** The position whose bounds are open on screen; null — the position's own ticket. */
  open: string | null;
  choice: KeeperChoice;
  review: KeeperReview | null;
  phase: KeeperPhase;
  code: string | null;
  /** The position whose Review waits for the person's tap: this browser holds no proof of the wallet yet. */
  quiet: string | null;
  load: (owner: string, force?: boolean) => Promise<void>;
  openFor: (nftMint: string, current: KeeperChoice | null) => void;
  close: () => void;
  setChoice: (patch: Partial<KeeperChoice>) => void;
  /** `auto`: built while the bounds are read — never opening the wallet for its proof. */
  prepare: (wallet: Wallet, request: Readonly<{ pool: string; nftMint: string }>, auto?: boolean) => Promise<void>;
  confirm: (wallet: Wallet) => Promise<void>;
  stop: (wallet: Wallet, key: string) => Promise<void>;
  again: () => void;
};

export const useKeeper = create<Store>((set, get) => ({
  loaded: { status: 'idle' },
  open: null,
  choice: DEFAULT_KEEPER_CHOICE,
  review: null,
  phase: 'idle',
  code: null,
  quiet: null,

  async load(owner, force = false) {
    const now = Date.now();
    const kept = get().loaded;
    if (!force && kept.status === 'ready' && kept.owner === owner && now - kept.at < STATUS_FRESH_MS) return;
    if (kept.status === 'loading') return;
    if (kept.status !== 'ready' || kept.owner !== owner) set({ loaded: { status: 'loading' } });
    const answer = await reach.post({ action: 'status', owner });
    if (!answer.ok) return set({ loaded: { status: answer.code === 'KEEPER_CLOSED' ? 'closed' : 'error' } });
    set({ loaded: { status: 'ready', value: answer as unknown as KeeperStatus, owner, at: Date.now() } });
  },

  openFor(nftMint, current) {
    set({ open: nftMint, choice: current ?? DEFAULT_KEEPER_CHOICE, review: null, phase: 'idle', code: null, quiet: null });
  },

  close() {
    if (KEEPER_LOCKED.has(get().phase)) return;
    set({ open: null, review: null, phase: 'idle', code: null });
  },

  setChoice(patch) {
    if (KEEPER_LOCKED.has(get().phase)) return;
    set({ choice: { ...get().choice, ...patch }, review: null, phase: 'idle', code: null, quiet: null });
  },

  async prepare(wallet, request, auto = false) {
    if (get().phase !== 'idle') return;
    const choice = get().choice;
    set({ phase: 'reviewing', code: null });
    const proof = await reach.prove(wallet, !auto);
    /* No proof here yet: the Review waits for the person's tap, which asks the wallet for it. */
    if (proof === 'unproven') return set({ phase: 'idle', quiet: request.nftMint });
    if (proof !== 'ok') return set(proof === 'declined' ? { phase: 'cancelled' } : { phase: 'failed', code: 'UNAUTHORIZED' });
    const answer = await reach.post({ action: 'review', owner: wallet.address, pool: request.pool, nftMint: request.nftMint, choice });
    /* The person changed a bound while it was built: that Review is not the one on screen. */
    if (!sameChoice(get().choice, choice) || get().open !== request.nftMint) return set({ phase: 'idle' });
    if (!answer.ok) return set({ phase: 'failed', code: answer.code });
    const value = answer as unknown as Omit<KeeperReview, 'nftMint' | 'choice'>;
    set({ phase: 'idle', review: { ...value, nftMint: request.nftMint, choice } });
  },

  async confirm(wallet) {
    const review = get().review;
    if (!review || get().phase !== 'idle') return;
    set({ phase: 'wallet', code: null });
    const signed = await reach.sign(wallet, review.transactions, review.network);
    if (!signed) return set({ phase: 'cancelled', review: null });
    set({ phase: 'sending' });
    const answer = await reach.post({ action: 'submit', owner: wallet.address, key: review.key, signed });
    if (!answer.ok) return set({ phase: 'failed', code: answer.code, review: null });
    set({ phase: 'done', review: null });
    void get().load(wallet.address, true);
  },

  async stop(wallet, key) {
    if (KEEPER_LOCKED.has(get().phase)) return;
    set({ phase: 'reviewing', code: null });
    const proof = await reach.prove(wallet, true);
    if (proof !== 'ok') return set(proof === 'declined' ? { phase: 'cancelled' } : { phase: 'failed', code: 'UNAUTHORIZED' });
    const built = await reach.post({ action: 'stop', owner: wallet.address, key });
    if (!built.ok) return set({ phase: 'failed', code: built.code });
    const transactions = (built.transactions as readonly string[] | undefined) ?? [];
    /* Nothing of the agent left on chain to take back: the server stopped the row as it stands. */
    if (transactions.length === 0) {
      void get().load(wallet.address, true);
      return set({ phase: 'stopped' });
    }
    const loaded = get().loaded;
    const network = loaded.status === 'ready' ? loaded.value.network : 'mainnet';
    set({ phase: 'wallet' });
    const signed = await reach.sign(wallet, transactions, network);
    if (!signed) return set({ phase: 'cancelled' });
    set({ phase: 'sending' });
    const relayed = await reach.post({ action: 'relay', owner: wallet.address, key, signed });
    /* The keeper is stopped once the chain shows the approval gone; until then it works as it did. */
    void get().load(wallet.address, true);
    set(relayed.ok ? { phase: 'stopped' } : { phase: 'failed', code: relayed.code });
  },

  again() {
    set({ phase: 'idle', code: null, review: null });
  },
}));
