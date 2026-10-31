import { create } from 'zustand';
import { citySigner } from '../app-bridge/route.ts';
import { createEngine, type Engine } from '../trade/engine.ts';
import { confirmTrade, prepareOrder, recoverTrade, type AttemptStore, type FlowDeps, type FlowPhase, type Intent, type SignResult, type TradeOutcome } from '../trade/flow.ts';
import { browserAttempts, choiceOf, quoteRefusal, type Connection, type Phase, type QuoteState, type Review } from '../trade/store.ts';
import { SOL } from '../trade/tiles.ts';
import { useWallet, type Holdings } from '../trade/wallet.ts';
import { lstOf, LSTS, type Lst, type LstId } from './lst.ts';
import type { SaverLot } from './mine.ts';
import { useEarn } from './open.ts';
import { earnWords } from './words.ts';

/**
 * The SOL Saver (CITY-94): SOL into an LST in one signature, through the city trade card's own engine and flow — the
 * same quote, the same exact order with the engine's checks, the same signature record shared with every trade
 * surface, the same read-back by signature. Nothing new moves money here: this store only picks the pair (SOL → the
 * LST) and keeps what the window shows.
 */

export type SaverDone = Readonly<{ lst: LstId; signature: string; lstRaw: string | null; lamports: string | null }>;

export type SaverEnv = Readonly<{
  engine: Engine;
  attempts: AttemptStore;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  sign: (connection: Connection, unsignedWireBase64: string) => Promise<SignResult>;
  wallet: () => Readonly<{ connection: Connection | null; holdings: Holdings | null }>;
  refreshHoldings: (delaysMs?: readonly number[]) => void;
  /** A purchase landed with its amounts: kept on the device for «Mine». */
  keep: (owner: string, lot: SaverLot) => void;
}>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let env: SaverEnv = {
  engine: createEngine(),
  attempts: browserAttempts,
  now: () => Date.now(),
  sleep,
  sign: (connection, wire) => citySigner.signTransaction({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: wire, chain: 'solana:mainnet' }),
  wallet: () => useWallet.getState(),
  refreshHoldings: (delays) => useWallet.getState().refreshHoldings(delays),
  keep: () => undefined,
};

/** For tests, and for the window to say where a lot is kept. */
export function setSaverEnv(next: Partial<SaverEnv>): void {
  env = { ...env, ...next };
}

const AFTER_READS_MS = [1_500, 7_000];
export const TYPING_MS = 450;
/** A first purchase starts small: 0.1 SOL, or less when the wallet holds less. */
const START_TEXT = '0.1';

/** The phases with a signature out or bytes on their way: the window holds still under them. */
export const SAVER_BUSY: ReadonlySet<Phase> = new Set(['wallet', 'sending', 'checking']);

export type Exit = Readonly<{ key: string; lamports: string | null }>;

type SaverState = {
  lst: LstId;
  typed: string;
  quote: QuoteState;
  /** The swap straight back for what the quote brings: the exit spread's other half. */
  exit: Exit | null;
  review: Review | null;
  phase: Phase;
  notice: Readonly<{ tone: 'info' | 'warn' | 'error'; text: string }> | null;
  done: SaverDone | null;
  failed: string | null;
  unknown: Readonly<{ signature: string; message: string }> | null;
  setLst: (lst: LstId) => void;
  setTyped: (text: string) => void;
  refreshQuote: () => Promise<void>;
  prepare: (auto: boolean) => Promise<void>;
  /** The one action: build the exact order when none is on screen, else open the wallet on it. */
  press: () => Promise<'ok' | 'connect'>;
  recover: () => Promise<void>;
  again: () => void;
};

export function towerOf(lst: Lst) {
  return { mint: lst.mint, symbol: lst.symbol, name: lst.symbol, icon: `/api/icon/${lst.mint}` };
}

/** The amount on screen, checked against the wallet the way the trade card checks a buy paid in SOL. */
export function saverChoice(lst: LstId, typed: string, holdings: Holdings | null) {
  return choiceOf(towerOf(lstOf(lst) ?? LSTS[0]!), 'buy', holdings, { pay: SOL.symbol, typed });
}

let actionTicket = 0;
let quoteTicket = 0;
let typingTicket = 0;

export const useSaver = create<SaverState>((set, get) => {
  const current = () => saverChoice(get().lst, get().typed, env.wallet().holdings);
  const keyOf = () => {
    const choice = current();
    return choice.key ? `${get().lst}:${choice.key}` : null;
  };
  const intentOf = (connection: Connection): Intent | null => {
    const choice = current();
    return choice.amountRaw ? { side: 'buy', inputMint: choice.inputMint, outputMint: choice.outputMint, amountRaw: choice.amountRaw, taker: connection.address } : null;
  };
  const deps = (connection: Connection): FlowDeps => ({
    engine: env.engine,
    sign: (wire) => env.sign(connection, wire),
    attempts: env.attempts,
    now: env.now,
    sleep: env.sleep,
    onPhase: (phase: FlowPhase) => {
      set({ phase });
      useEarn.getState().setBusy(SAVER_BUSY.has(phase));
    },
  });
  const idle = (patch: Partial<SaverState>) => {
    useEarn.getState().setBusy(false);
    set({ phase: 'idle', ...patch });
  };

  const settle = (outcome: TradeOutcome, my: number, key: string | null, connection: Connection) => {
    if (my !== actionTicket) return;
    switch (outcome.kind) {
      case 'ready':
        idle({ review: { key: key ?? '', order: outcome.order, receivedAt: outcome.receivedAt, renewals: 0 } });
        return;
      case 'review':
        idle({ notice: { tone: 'warn', text: outcome.note }, review: { key: key ?? '', order: outcome.order, receivedAt: outcome.receivedAt, renewals: 0 } });
        return;
      case 'refused':
        idle({ review: null, notice: { tone: 'error', text: outcome.refusal.message } });
        return;
      case 'cancelled':
        idle({ notice: { tone: 'info', text: earnWords().saver.cancelled } });
        return;
      case 'locked':
        void get().recover();
        return;
      case 'nothing':
        idle({ review: null, notice: { tone: 'info', text: outcome.message } });
        return;
      case 'unknown':
        useEarn.getState().setBusy(false);
        set({ phase: 'unknown', unknown: { signature: outcome.signature, message: outcome.message } });
        return;
      case 'failed':
        env.refreshHoldings(AFTER_READS_MS);
        useEarn.getState().setBusy(false);
        set({ phase: 'failed', review: null, failed: outcome.signature });
        return;
      case 'settled': {
        env.refreshHoldings(AFTER_READS_MS);
        const trade = outcome.trade;
        const lst = get().lst;
        const lstMint = lstOf(lst)?.mint;
        // Only this purchase's own receipt with both amounts is kept as a lot: a signature read back by recovery may be
        // another surface's swap (recovery names no pair), and without amounts «Mine» says the cost is not measured.
        if (trade.inputRaw && trade.outputRaw && trade.inputMint === SOL.mint && trade.outputMint === lstMint) {
          env.keep(connection.address, { mint: lstMint!, lstRaw: trade.outputRaw, lamports: trade.inputRaw, at: env.now(), signature: trade.signature });
        }
        useEarn.getState().setBusy(false);
        set({ phase: 'done', review: null, notice: null, done: { lst, signature: trade.signature, lstRaw: trade.outputRaw, lamports: trade.inputRaw } });
        return;
      }
    }
  };

  return {
    lst: LSTS[0]!.id,
    typed: START_TEXT,
    quote: { status: 'none' },
    exit: null,
    review: null,
    phase: 'idle',
    notice: null,
    done: null,
    failed: null,
    unknown: null,

    setLst: (lst) => {
      if (get().phase !== 'idle' || lst === get().lst || !lstOf(lst)) return;
      actionTicket += 1;
      set({ lst, review: null, notice: null, quote: { status: 'none' }, exit: null });
      void get().refreshQuote();
    },

    setTyped: (text) => {
      const typed = text.replace(/[^\d.,]/g, '').slice(0, 18);
      if (get().phase !== 'idle' || typed === get().typed) return;
      actionTicket += 1;
      const my = ++typingTicket;
      set({ typed, review: null, notice: null, quote: { status: 'none' }, exit: null });
      void env.sleep(TYPING_MS).then(() => {
        if (my === typingTicket) void get().refreshQuote();
      });
    },

    refreshQuote: async () => {
      const choice = current();
      const key = keyOf();
      if (!choice.amountRaw || !key) return set({ quote: { status: 'none' }, exit: null });
      const my = ++quoteTicket;
      const before = get().quote;
      if (!(before.status === 'ready' && before.key === key)) set({ quote: { status: 'loading', key } });
      const answer = await env.engine.quote({ inputMint: choice.inputMint, outputMint: choice.outputMint, amountRaw: choice.amountRaw });
      if (my !== quoteTicket || keyOf() !== key) return;
      if (!answer.ok) return set({ quote: { status: 'error', key, refusal: quoteRefusal(answer.failure.code) } });
      set({ quote: { status: 'ready', key, body: answer.value, at: env.now() } });
      // The spread back to SOL, priced the same way, for what this quote brings.
      const back = await env.engine.quote({ inputMint: choice.outputMint, outputMint: SOL.mint, amountRaw: answer.value.order.outAmountRaw });
      if (my !== quoteTicket || keyOf() !== key) return;
      set({ exit: { key, lamports: back.ok ? back.value.order.outAmountRaw : null } });
    },

    prepare: async (auto) => {
      const state = get();
      const connection = env.wallet().connection;
      const key = keyOf();
      if (!connection || !key || state.phase !== 'idle' || state.review?.key === key) return;
      if (auto && !(state.quote.status === 'ready' && state.quote.key === key)) return;
      const intent = intentOf(connection);
      if (!intent) return;
      const my = ++actionTicket;
      set({ phase: 'preparing', notice: auto ? state.notice : null });
      settle(await prepareOrder(intent, deps(connection)), my, key, connection);
    },

    press: async () => {
      const state = get();
      if (state.phase === 'done' || state.phase === 'failed') {
        get().again();
        return 'ok';
      }
      if (state.phase === 'unknown') {
        void get().recover();
        return 'ok';
      }
      if (state.phase !== 'idle') return 'ok';
      const connection = env.wallet().connection;
      if (!connection) return 'connect';
      const intent = intentOf(connection);
      const key = keyOf();
      if (!intent || !key) return 'ok';
      const review = state.review?.key === key ? state.review : null;
      if (!review) {
        await get().prepare(false);
        return 'ok';
      }
      const my = ++actionTicket;
      set({ notice: null });
      settle(await confirmTrade({ intent, order: review.order, receivedAt: review.receivedAt }, deps(connection)), my, key, connection);
      return 'ok';
    },

    recover: async () => {
      const connection = env.wallet().connection;
      const attempt = env.attempts.read();
      if (!connection || !attempt || attempt.state === 'SETTLED' || attempt.taker !== connection.address) return;
      const my = ++actionTicket;
      set({ phase: 'checking', notice: null });
      useEarn.getState().setBusy(true);
      settle(await recoverTrade(attempt, deps(connection), null), my, null, connection);
    },

    again: () => {
      actionTicket += 1;
      idle({ done: null, failed: null, unknown: null, review: null, notice: null, quote: { status: 'none' }, exit: null });
      void get().refreshQuote();
    },
  };
});

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __saver: useSaver });
