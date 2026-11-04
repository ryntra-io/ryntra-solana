import { create } from 'zustand';
import { citySigner } from '../app-bridge/route.ts';
import type { SignResult } from '../trade/flow.ts';
import type { Connection } from '../trade/store.ts';
import { useWallet, type Holdings } from '../trade/wallet.ts';
import {
  DOLLAR_MINT,
  dollarProblem,
  dollarRaw,
  fieldText,
  readDollarSurface,
  START_TEXT,
  walletSpendable,
  type DollarAsset,
  type DollarProblem,
  type DollarSide,
  type DollarSurface,
} from './dollar.ts';
import type { DollarAsk } from './dollar-read.ts';
import { useEarn } from './open.ts';

/**
 * The Dollar Saver's card (CITY-192): one coin, one side, one amount, one tap — the server builds the deposit or the
 * withdrawal at Jupiter Lend and seals it (`/api/solana/earn/review`), the person's wallet signs it, and the server
 * checks the market again and sends those exact bytes once (`/api/solana/earn/submit`). Nothing here builds or holds
 * a transaction of its own and no key is ever near it: the engine is SOL-3's `lib/earn`, the signature the city's one
 * door (`citySigner`). A signature whose answer was lost is read back by the chain (`/api/solana/earn/status`), never
 * called «nothing happened».
 */

export type DollarPhase = 'idle' | 'building' | 'wallet' | 'sending' | 'checking' | 'done' | 'failed' | 'unknown';

/** The phases with a signature out or bytes on their way: the window holds still under them. */
export const DOLLAR_BUSY: ReadonlySet<DollarPhase> = new Set(['building', 'wallet', 'sending', 'checking']);

export type DollarDone = Readonly<{ side: DollarSide; asset: DollarAsset; amountRaw: string; signature: string; partial: boolean }>;

type Post = (url: string, body: unknown) => Promise<Readonly<{ ok: boolean; status: number; json: unknown }>>;
type Get = (url: string) => Promise<Readonly<{ ok: boolean; status: number; json: unknown }>>;

export type DollarEnv = Readonly<{
  get: Get;
  post: Post;
  sign: (connection: Connection, unsignedWireBase64: string) => Promise<SignResult>;
  wallet: () => Readonly<{ connection: Connection | null; holdings: Holdings | null }>;
  refreshHoldings: (delaysMs?: readonly number[]) => void;
  sleep: (ms: number) => Promise<void>;
}>;

const asJson = async (response: Response) => ({ ok: response.ok, status: response.status, json: await response.json().catch(() => null) });

let env: DollarEnv = {
  get: async (url) => asJson(await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })),
  post: async (url, body) =>
    asJson(await fetch(url, { method: 'POST', cache: 'no-store', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(35_000) })),
  sign: (connection, wire) => citySigner.signTransaction({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: wire, chain: 'solana:mainnet' }),
  wallet: () => useWallet.getState(),
  refreshHoldings: (delays) => useWallet.getState().refreshHoldings(delays),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** For the tests and the screenshot stand. */
export function setDollarEnv(next: Partial<DollarEnv>): void {
  env = { ...env, ...next };
}

const AFTER_READS_MS = [1_500, 7_000];
/** How often, and how many times, a signature whose answer was lost is read back. */
const CHECK_MS = 2_500;
const CHECKS = 6;

type Surface = Readonly<{ status: 'idle' | 'loading' | 'error' }> | Readonly<{ status: 'ready'; value: DollarSurface; at: number }>;

type DollarState = {
  asset: DollarAsset;
  side: DollarSide;
  typed: string;
  surface: Surface;
  phase: DollarPhase;
  notice: Readonly<{ tone: 'info' | 'warn' | 'error'; text: string }> | null;
  done: DollarDone | null;
  /** A signature the chain has not settled yet, or one that failed: the card links it. */
  signature: string | null;
  load: (owner: string | null) => Promise<void>;
  setAsset: (asset: DollarAsset) => void;
  setSide: (side: DollarSide) => void;
  setTyped: (text: string) => void;
  /** «Put my USDC to work», «поклади 50 USDC під відсоток»: the card opens with the coin, the side and the amount. */
  fromAsk: (ask: DollarAsk) => void;
  /** The one action: build, sign, send. */
  press: () => Promise<'ok' | 'connect' | 'refused'>;
  again: () => void;
};

/** What the wallet holds of the coin, as the city's wallet read it; null when not read. */
export function heldOf(asset: DollarAsset, holdings: Holdings | null): bigint | null {
  if (!holdings) return null;
  const balance = asset === 'SOL' ? holdings.sol : holdings.tokens.get(DOLLAR_MINT.USDC) ?? null;
  if (!balance) return holdings.complete ? 0n : null;
  return walletSpendable(asset, balance.spendableRaw);
}

/** The amount on screen against the surface and the wallet: what the card shows before the tap. */
export function dollarChoice(state: Pick<DollarState, 'asset' | 'side' | 'typed' | 'surface'>, holdings: Holdings | null) {
  const surface = state.surface.status === 'ready' ? state.surface.value : null;
  const market = surface?.markets[state.asset] ?? null;
  const position = surface?.positions[state.asset] ?? null;
  const raw = dollarRaw(state.typed, state.asset);
  const walletRaw = heldOf(state.asset, holdings);
  const problem: DollarProblem | null = dollarProblem({ side: state.side, raw, market, walletRaw, position, maxUsd: surface?.actions.maxUsd ?? null });
  const max = state.side === 'deposit' ? walletRaw : (position?.availableRaw ?? position?.worthRaw ?? null);
  return { surface, market, position, raw, walletRaw, problem, max };
}

/** The engine's refusal as one short line for the card; the code picks the words, never the server's text. */
export type RefusalWords = Readonly<Record<string, string>> & Readonly<{ fallback: string }>;
let refusalWords: () => RefusalWords = () => ({ fallback: 'Not sent. Try again.' });
export function setDollarRefusals(words: () => RefusalWords): void {
  refusalWords = words;
}

function refusal(json: unknown): string {
  const code = (json as { error?: { code?: unknown } } | null)?.error?.code;
  const words = refusalWords();
  return (typeof code === 'string' && words[code]) || words.fallback;
}

let ticket = 0;

export const useDollar = create<DollarState>((set, get) => {
  const idle = (patch: Partial<DollarState>) => {
    useEarn.getState().setBusy(false);
    set({ phase: 'idle', ...patch });
  };
  const busy = (phase: DollarPhase) => {
    set({ phase });
    useEarn.getState().setBusy(DOLLAR_BUSY.has(phase));
  };
  const landed = (done: DollarDone, owner: string) => {
    useEarn.getState().setBusy(false);
    set({ phase: 'done', done, signature: done.signature, notice: null });
    env.refreshHoldings(AFTER_READS_MS);
    // The position moves on the chain a moment after: the card and «Mine» read it again.
    void env.sleep(AFTER_READS_MS[0]!).then(() => get().load(owner));
  };

  return {
    asset: 'USDC',
    side: 'deposit',
    typed: START_TEXT.USDC,
    surface: { status: 'idle' },
    phase: 'idle',
    notice: null,
    done: null,
    signature: null,

    load: async (owner) => {
      const before = get().surface;
      if (before.status !== 'ready' || before.value.owner !== owner) set({ surface: { status: 'loading' } });
      const read = await env.get(owner ? `/api/solana/earn?owner=${encodeURIComponent(owner)}` : '/api/solana/earn').catch(() => null);
      const value = read?.ok ? readDollarSurface(read.json, owner) : null;
      // A wallet changed while the read was out: the newer read is the one that stands.
      const now = env.wallet().connection?.address ?? null;
      if (now !== owner && owner !== null) return;
      set({ surface: value ? { status: 'ready', value, at: Date.now() } : before.status === 'ready' && before.value.owner === owner ? before : { status: 'error' } });
    },

    setAsset: (asset) => {
      if (DOLLAR_BUSY.has(get().phase)) return;
      set({ asset, typed: get().side === 'deposit' ? START_TEXT[asset] : '', notice: null, phase: 'idle' });
    },
    setSide: (side) => {
      if (DOLLAR_BUSY.has(get().phase)) return;
      // Taking back starts from the whole position: the most common ask, and the card says what can leave today.
      const position = get().surface.status === 'ready' ? (get().surface as { value: DollarSurface }).value.positions[get().asset] : undefined;
      const all = position?.availableRaw ?? position?.worthRaw ?? null;
      set({ side, typed: side === 'deposit' ? START_TEXT[get().asset] : all !== null && all > 0n ? fieldText(all, get().asset) : '', notice: null, phase: 'idle' });
    },
    setTyped: (text) => {
      if (DOLLAR_BUSY.has(get().phase)) return;
      set({ typed: text.slice(0, 24), notice: null, phase: get().phase === 'failed' ? 'idle' : get().phase });
    },

    fromAsk: (ask) => {
      if (DOLLAR_BUSY.has(get().phase)) return;
      set({ asset: ask.asset, side: ask.side, typed: ask.amount ?? (ask.side === 'deposit' ? START_TEXT[ask.asset] : ''), notice: null, phase: 'idle', done: null });
      if (ask.side === 'withdraw' && !ask.amount) get().setSide('withdraw');
    },

    press: async () => {
      const { connection, holdings } = env.wallet();
      if (!connection) return 'connect';
      if (DOLLAR_BUSY.has(get().phase)) return 'refused';
      const state = get();
      const choice = dollarChoice(state, holdings);
      if (!choice.surface?.actions.open || choice.problem || choice.raw === null) return 'refused';
      const my = ++ticket;
      const owner = connection.address;
      set({ notice: null, signature: null });

      // 1. The server builds the transaction at Jupiter Lend and seals it; nothing is signed yet.
      busy('building');
      const built = await env.post('/api/solana/earn/review', { provider: 'jupiter', action: state.side, owner, market: DOLLAR_MINT[state.asset], amount: choice.raw.toString() }).catch(() => null);
      if (my !== ticket) return 'refused';
      const review = built?.json as { ticket?: unknown; transaction?: { wireBase64?: unknown }; amountRaw?: unknown; partial?: unknown } | null;
      if (!built?.ok || typeof review?.ticket !== 'string' || typeof review.transaction?.wireBase64 !== 'string') {
        idle({ notice: { tone: 'error', text: refusal(built?.json ?? null) } });
        return 'refused';
      }

      // 2. The person's wallet signs those bytes — the only signature.
      busy('wallet');
      const signed = await env.sign(connection, review.transaction.wireBase64).catch((error: unknown) => ({ ok: false as const, reason: String(error) }));
      if (my !== ticket) return 'refused';
      if (!signed.ok) {
        idle({ notice: { tone: 'info', text: refusalWords().CANCELLED ?? refusalWords().fallback } });
        return 'refused';
      }

      // 3. The server checks the market again and sends the exact bytes once.
      busy('sending');
      const sent = await env.post('/api/solana/earn/submit', { ticket: review.ticket, signed: signed.signedWireBase64 }).catch(() => null);
      if (my !== ticket) return 'refused';
      const receipt = sent?.json as { state?: unknown; signature?: unknown; amountRaw?: unknown } | null;
      const done: DollarDone = {
        side: state.side,
        asset: state.asset,
        amountRaw: typeof review.amountRaw === 'string' ? review.amountRaw : choice.raw.toString(),
        signature: typeof receipt?.signature === 'string' ? receipt.signature : '',
        partial: review.partial === true,
      };
      if (!sent?.ok || typeof receipt?.signature !== 'string') {
        // Refused before anything left (the market moved, the gate closed): nothing moved, and the card says why.
        if (sent && sent.status >= 400 && sent.status < 500) {
          idle({ notice: { tone: 'warn', text: refusal(sent.json) } });
          return 'refused';
        }
        // No answer at all: the signature may still have gone. The wallet's own balance tells, never a guess.
        useEarn.getState().setBusy(false);
        env.refreshHoldings(AFTER_READS_MS);
        set({ phase: 'unknown', notice: { tone: 'warn', text: refusalWords().UNKNOWN ?? refusalWords().fallback } });
        return 'ok';
      }
      if (receipt.state === 'LANDED') {
        landed(done, owner);
        return 'ok';
      }
      if (receipt.state === 'FAILED') {
        env.refreshHoldings(AFTER_READS_MS);
        useEarn.getState().setBusy(false);
        set({ phase: 'failed', signature: done.signature, notice: { tone: 'error', text: refusalWords().FAILED ?? refusalWords().fallback } });
        return 'ok';
      }

      // 4. Sent, and the chain has not answered yet: read the signature back a few times.
      busy('checking');
      for (let n = 0; n < CHECKS; n += 1) {
        await env.sleep(CHECK_MS);
        if (my !== ticket) return 'ok';
        const read = await env.get(`/api/solana/earn/status?signatures=${encodeURIComponent(done.signature)}`).catch(() => null);
        const row = (read?.json as { results?: { state?: unknown }[] } | null)?.results?.[0];
        if (row?.state === 'LANDED') {
          landed(done, owner);
          return 'ok';
        }
        if (row?.state === 'FAILED') {
          useEarn.getState().setBusy(false);
          env.refreshHoldings(AFTER_READS_MS);
          set({ phase: 'failed', signature: done.signature, notice: { tone: 'error', text: refusalWords().FAILED ?? refusalWords().fallback } });
          return 'ok';
        }
      }
      useEarn.getState().setBusy(false);
      env.refreshHoldings(AFTER_READS_MS);
      set({ phase: 'unknown', signature: done.signature, notice: { tone: 'warn', text: refusalWords().UNKNOWN ?? refusalWords().fallback } });
      return 'ok';
    },

    again: () => {
      ticket += 1;
      useEarn.getState().setBusy(false);
      set({ phase: 'idle', done: null, notice: null, signature: null, typed: get().side === 'deposit' ? START_TEXT[get().asset] : '' });
      if (get().side === 'withdraw') get().setSide('withdraw');
    },
  };
});

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __dollar: useDollar });
