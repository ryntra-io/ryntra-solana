import { create } from 'zustand';

import { PRO_LIMITS_CHAINS, proLimitsWindow, type ProLimitsNetwork } from '../../../lib/pro-limits/gate.ts';
import type { ProIntent } from '../../../lib/pro-limits/service.ts';
import { citySigner } from '../app-bridge/route.ts';
import { createLadderEngine, type LadderEngine, type ReviewAsk } from './pro-engine.ts';
import { SLIDER_START_BPS, bpsAt, endsOf, positionOf, problemOf, quoteKey, rawOfText, spendable, textOfRaw, type Held, type LadderAction, type Market, type Order, type Problem, type Quote } from './pro-ladder.ts';
import type { LadderAsk } from './pro-read.ts';
import { SOL } from './tiles.ts';
import { useWallet, type Holdings } from './wallet.ts';

/**
 * «Buy cheaper», «sell higher» in the coin's window: what the panel holds and what its one button does.
 *
 * - The window's switch (`NEXT_PUBLIC_RYNTRA_CITY_PRO_LIMITS`) names the network the panel is drawn for; closed, the
 *   panel is not drawn and nothing here asks the engine anything. The switch opens nothing by itself: the engine's own
 *   gate answers, and a closed engine reads as «no market».
 * - One slider, one amount. The ladder — its prices, what it pays, the bonus — is the engine's quote, asked once the
 *   slider and the amount rest.
 * - The button: a Review from the engine, the wallet's one approval, the relay. The wallet signs; nothing here does.
 * - The person's ladders of this coin, with «Take» and «Cancel» — each again a Review, an approval, the relay.
 *
 * On devnet the wallet's balances are not read (the holdings the city knows are mainnet's): the amount is typed
 * freely and the engine's Review says whether the wallet holds it.
 */

export const LADDER_NETWORK: ProLimitsNetwork | null = proLimitsWindow(process.env.NEXT_PUBLIC_RYNTRA_CITY_PRO_LIMITS);
export const LADDER_OPEN = LADDER_NETWORK !== null;
/** The most prices one ladder has: the program's own limit (`MAX_ORDER_TICKS`). */
export const LADDER_MAX_RUNGS = 25;

export type LadderPhase = 'idle' | 'reviewing' | 'wallet' | 'sending' | 'done' | 'failed';
export const LADDER_BUSY: ReadonlySet<LadderPhase> = new Set(['reviewing', 'wallet', 'sending']);

type Read<T> = Readonly<{ status: 'none' | 'loading' | 'ready' | 'failed'; value: T | null; code: string | null }>;
const NONE = { status: 'none', value: null, code: null } as const;

export type OrderStep = 'collect' | 'close' | 'agent-on' | 'agent-off';

type State = Readonly<{
  mint: string | null;
  symbol: string;
  market: Read<Market>;
  action: LadderAction;
  /** How far the ladder reaches, basis points of the coin's price; null until the market's slider is known. */
  farBps: number | null;
  /** How many prices: one where a sentence said a multiple on its own, or the count a screen chose (up to 25); null — as many as fit. */
  rungs: number | null;
  typed: string;
  /** A share of what the wallet holds, said in a sentence and waiting for the balance. */
  share: number | null;
  /** Whether Ryntra's agent may collect the ladder. */
  agent: boolean;
  quote: Read<Quote> & Readonly<{ key: string | null }>;
  phase: LadderPhase;
  failure: string | null;
  /** `whole` — every transaction of the approval landed; false — the action did, and the person's accounts after it did not (the agent cannot collect yet). */
  placed: Readonly<{ nftMint: string; signature: string | null; quote: Quote | null; whole: boolean; agent: boolean }> | null;
  orders: Read<readonly Order[]>;
  /** The order a «Take», a «Cancel» or the agent's leave is under way for, and how it ended. */
  acting: Readonly<{ nftMint: string; step: OrderStep; phase: LadderPhase; failure: string | null }> | null;
  /** Whether the panel is unfolded: on a tap of its line, or by a sentence that asked for a ladder. */
  shown: boolean;
}>;

type Actions = Readonly<{
  open: (coin: Readonly<{ mint: string; symbol: string }>, ask?: LadderAsk | null) => void;
  show: () => void;
  setAction: (action: LadderAction) => void;
  /** `keepRungs` — the count the person chose stays (the terminal's ticket); without it a moved slider fits as many as it can. */
  setReach: (position: number, keepRungs?: boolean) => void;
  /** How many prices the ladder has: 1 to 25, or null — as many as fit. */
  setRungs: (rungs: number | null) => void;
  setTyped: (text: string) => void;
  setShare: (share: number) => void;
  setAgent: (on: boolean) => void;
  place: () => Promise<void>;
  again: () => void;
  loadOrders: () => Promise<void>;
  act: (order: Order, step: OrderStep) => Promise<void>;
}>;

export type LadderEnv = Readonly<{
  engine: LadderEngine;
  /** The wallet's one approval of a Review's transactions: the signed bytes in the same order, or null where it declined. */
  sign: (unsigned: readonly string[]) => Promise<readonly string[] | null>;
  refreshHoldings: () => void;
  quoteDelayMs: number;
}>;

let env: LadderEnv | null = null;
const browserEnv = (): LadderEnv => ({
  engine: createLadderEngine(),
  sign: async (unsigned) => {
    const connection = useWallet.getState().connection;
    if (!connection || LADDER_NETWORK === null) return null;
    const signed = await citySigner.signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: [...unsigned], chain: PRO_LIMITS_CHAINS[LADDER_NETWORK] });
    return signed.ok ? signed.signedWireBase64 : null;
  },
  refreshHoldings: () => useWallet.getState().refreshHoldings([1_500, 5_000]),
  quoteDelayMs: 350,
});
const ladderEnv = (): LadderEnv => (env ??= browserEnv());
/** For a test: the engine, the signer and the clock's delays. */
export function setLadderEnv(next: LadderEnv | null): void {
  env = next;
}

/** What the wallet holds of the ladder's coins; null where it is not known — never zero. Unknown whole on devnet. */
export function heldOf(holdings: Holdings | null, market: Market, network: ProLimitsNetwork | null = LADDER_NETWORK): Held | null {
  if (!holdings) return null;
  if (network !== 'mainnet') return { sol: null, quote: null, coin: null };
  const token = (mint: string) => {
    if (mint === SOL.mint) return holdings.sol ? BigInt(holdings.sol.spendableRaw) : null;
    const held = holdings.tokens.get(mint);
    return held ? BigInt(held.spendableRaw) : holdings.complete ? 0n : null;
  };
  return { sol: holdings.sol ? BigInt(holdings.sol.spendableRaw) : null, quote: token(market.quote.mint), coin: token(market.coin.mint) };
}

/** The ladder as it stands in the panel: what would be asked of the engine, and why it cannot be yet. */
export function choiceOf(state: Pick<State, 'market' | 'action' | 'farBps' | 'rungs' | 'typed' | 'agent' | 'quote' | 'mint'>, holdings: Holdings | null, network: ProLimitsNetwork | null = LADDER_NETWORK): Readonly<{ intent: ProIntent | null; amountRaw: bigint | null; decimals: number; unit: 'quote' | 'coin'; max: bigint | null; problem: Problem | null; key: string | null; agent: boolean }> | null {
  const market = state.market.value;
  if (!market || state.farBps === null || !state.mint) return null;
  const decimals = state.action === 'buy' ? market.quote.decimals : market.coin.decimals;
  const amountRaw = rawOfText(state.typed, decimals);
  const held = heldOf(holdings, market, network);
  const solQuote = market.quote.mint === SOL.mint;
  const agent = state.agent && market.collector !== null;
  const key = amountRaw === null ? null : quoteKey(state.mint, state.action, state.farBps, state.rungs, amountRaw);
  const quote = state.quote.status === 'ready' && state.quote.key === key ? state.quote.value : null;
  const problem = problemOf({ market, action: state.action, amountRaw, held, solQuote, agent, quote });
  const intent: ProIntent | null = amountRaw === null ? null : { action: state.action, farBps: state.farBps, ...(state.rungs ? { rungs: state.rungs } : {}), amountRaw: amountRaw.toString() };
  return { intent, amountRaw, decimals, unit: state.action === 'buy' ? 'quote' : 'coin', max: held ? spendable(state.action, market, held, solQuote) : null, problem, key, agent };
}

const START: State = {
  mint: null,
  symbol: '',
  market: NONE,
  action: 'buy',
  farBps: null,
  rungs: null,
  typed: '',
  share: null,
  agent: true,
  quote: { ...NONE, key: null },
  phase: 'idle',
  failure: null,
  placed: null,
  orders: NONE,
  acting: null,
  shown: false,
};

let quoteTimer: ReturnType<typeof setTimeout> | null = null;
let opened = 0;

export const useLadder = create<State & Actions>((set, get) => {
  /** The reach for a side on the market: what was said, or where the slider starts — held to the slider's ends. */
  const reachFor = (action: LadderAction, market: Market, said: number | null) => {
    const ends = endsOf(action, market);
    return ends ? bpsAt(positionOf(said ?? SLIDER_START_BPS[action], action, ends), action, ends) : null;
  };
  /** A share of what the wallet holds, as the field's text; null while the balance is not known. */
  const shareText = (share: number) => {
    const state = get();
    const choice = choiceOf(state, useWallet.getState().holdings);
    if (!choice || choice.max === null) return null;
    return textOfRaw((choice.max * BigInt(Math.round(share))) / 100n, choice.decimals);
  };
  /** Asks the engine for the ladder once the slider and the amount rest. */
  const requote = () => {
    if (quoteTimer) clearTimeout(quoteTimer);
    const state = get();
    const choice = choiceOf(state, useWallet.getState().holdings);
    if (!choice?.intent || !choice.key || !state.mint) {
      set({ quote: { ...NONE, key: null } });
      return;
    }
    if (state.quote.key === choice.key && state.quote.status !== 'failed') return;
    const { key, intent } = choice;
    const mint = state.mint;
    set({ quote: { status: 'loading', value: null, code: null, key } });
    quoteTimer = setTimeout(async () => {
      const answer = await ladderEnv().engine.quote(mint, intent);
      if (get().quote.key !== key) return;
      set({ quote: answer.ok ? { status: 'ready', value: answer.value, code: null, key } : { status: 'failed', value: null, code: answer.failure.code, key } });
    }, ladderEnv().quoteDelayMs);
  };

  /** A Review, the wallet's approval, the relay: the three steps every action of the panel is. */
  const carry = async (ask: ReviewAsk, step: (phase: LadderPhase, failure?: string | null) => void): Promise<Readonly<{ nftMint: string; signature: string | null; quote: Quote | null; whole: boolean; agent: boolean }> | null> => {
    step('reviewing');
    const review = await ladderEnv().engine.review(ask);
    if (!review.ok) {
      step('failed', review.failure.code);
      return null;
    }
    step('wallet');
    const signed = await ladderEnv().sign(review.value.transactions);
    if (!signed) {
      step('failed', 'WALLET_DECLINED');
      return null;
    }
    step('sending');
    const relay = await ladderEnv().engine.submit(review.value.ticket, signed);
    if (!relay.ok) {
      step('failed', relay.failure.code);
      return null;
    }
    /* The first transaction is the action itself; one after it only opens the person's own accounts. */
    const first = relay.value.results[0];
    if (first?.state !== 'LANDED') {
      step('failed', first?.state === 'UNKNOWN' ? 'UNKNOWN' : 'PRO_LIMIT_SUBMIT_FAILED');
      return null;
    }
    ladderEnv().refreshHoldings();
    return { nftMint: relay.value.nftMint, signature: first.signature, quote: review.value.quote, whole: relay.value.results.every((result) => result.state === 'LANDED'), agent: review.value.agent };
  };

  return {
    ...START,

    open: (coin, ask = null) => {
      const same = get().mint === coin.mint;
      if (same && !ask && get().market.status !== 'failed') return;
      const ticket = (opened += 1);
      const action = ask?.action ?? (same ? get().action : 'buy');
      set({ ...START, mint: coin.mint, symbol: coin.symbol, action, agent: get().agent, shown: ask !== null || (same && get().shown), market: { status: 'loading', value: null, code: null } });
      void (async () => {
        const answer = await ladderEnv().engine.market(coin.mint);
        if (ticket !== opened) return;
        if (!answer.ok || !answer.value) {
          set({ market: answer.ok ? { status: 'ready', value: null, code: null } : { status: 'failed', value: null, code: answer.failure.code } });
          return;
        }
        const market = answer.value;
        /* A sentence's amount is taken only where it is said in the coin the ladder rests: a word is never turned into another money. */
        const typed = ask?.amount && (ask.action === 'sell' || ask.pay === null || ask.pay === market.quote.symbol) ? ask.amount : '';
        set({ market: { status: 'ready', value: market, code: null }, farBps: reachFor(action, market, ask?.farBps ?? null), rungs: ask?.rungs ?? null, typed, share: typed ? null : (ask?.share ?? null) });
        const pending = get().share;
        if (pending !== null) {
          const text = shareText(pending);
          if (text !== null) set({ typed: text, share: null });
        }
        requote();
        void get().loadOrders();
      })();
    },

    show: () => set({ shown: true }),

    setAction: (action) => {
      const { market, phase } = get();
      if (LADDER_BUSY.has(phase) || !market.value) return;
      set({ action, farBps: reachFor(action, market.value, null), rungs: null, typed: '', share: null, phase: 'idle', failure: null, placed: null });
      requote();
    },

    setReach: (position, keepRungs = false) => {
      const { market, action, phase, rungs } = get();
      const ends = market.value ? endsOf(action, market.value) : null;
      if (LADDER_BUSY.has(phase) || !ends) return;
      set({ farBps: bpsAt(position, action, ends), rungs: keepRungs ? rungs : null, phase: 'idle', failure: null });
      requote();
    },

    setRungs: (rungs) => {
      if (LADDER_BUSY.has(get().phase)) return;
      const count = rungs === null ? null : Math.min(LADDER_MAX_RUNGS, Math.max(1, Math.round(rungs)));
      if (count === get().rungs) return;
      set({ rungs: count, phase: 'idle', failure: null });
      requote();
    },

    setTyped: (typed) => {
      if (LADDER_BUSY.has(get().phase)) return;
      set({ typed, share: null, phase: 'idle', failure: null });
      requote();
    },

    setShare: (share) => {
      if (LADDER_BUSY.has(get().phase)) return;
      const text = shareText(share);
      if (text === null) return;
      set({ typed: text, share: null, phase: 'idle', failure: null });
      requote();
    },

    setAgent: (agent) => {
      if (LADDER_BUSY.has(get().phase)) return;
      set({ agent });
    },

    place: async () => {
      const state = get();
      const owner = useWallet.getState().connection?.address;
      const choice = choiceOf(state, useWallet.getState().holdings);
      /* An order's own action asking the wallet now: one approval at a time. */
      if (LADDER_BUSY.has(state.phase) || (state.acting && LADDER_BUSY.has(state.acting.phase)) || !owner || !state.mint || !choice?.intent || choice.problem) return;
      /* The coin may change while the wallet is up: what comes back after it belongs to no panel on screen. */
      const ticket = opened;
      const done = await carry({ action: 'place', owner, mint: state.mint, intent: choice.intent, agent: choice.agent }, (phase, failure = null) => {
        if (opened === ticket) set({ phase, failure });
      });
      if (!done || opened !== ticket) return;
      set({ phase: 'done', failure: null, placed: done, typed: '', quote: { ...NONE, key: null } });
      void get().loadOrders();
    },

    again: () => {
      if (LADDER_BUSY.has(get().phase)) return;
      set({ phase: 'idle', failure: null, placed: null });
    },

    loadOrders: async () => {
      const owner = useWallet.getState().connection?.address;
      const mint = get().mint;
      if (!owner || !mint) {
        set({ orders: NONE });
        return;
      }
      if (get().orders.status === 'none') set({ orders: { status: 'loading', value: null, code: null } });
      const answer = await ladderEnv().engine.orders(owner, mint);
      if (get().mint !== mint) return;
      /* A read that failed keeps what was on screen: orders are never shown as none because the engine was late. */
      set({ orders: answer.ok ? { status: 'ready', value: answer.value, code: null } : { status: 'failed', value: get().orders.value, code: answer.failure.code } });
    },

    act: async (order, step) => {
      const owner = useWallet.getState().connection?.address;
      const { acting, phase } = get();
      if (!owner || LADDER_BUSY.has(phase) || (acting && LADDER_BUSY.has(acting.phase))) return;
      const ask: ReviewAsk = step === 'collect' || step === 'close' ? { action: step, owner, pool: order.pool, nftMint: order.nftMint } : { action: 'delegate', owner, pool: order.pool, nftMint: order.nftMint, agent: step === 'agent-on' };
      const ticket = opened;
      const done = await carry(ask, (stepPhase, failure = null) => {
        if (opened === ticket) set({ acting: { nftMint: order.nftMint, step, phase: stepPhase, failure } });
      });
      if (!done || opened !== ticket) return;
      set({ acting: { nftMint: order.nftMint, step, phase: 'done', failure: null } });
      await get().loadOrders();
    },
  };
});

/** A ladder a sentence asked for, kept until the coin's window draws its panel. */
let asked: Readonly<{ mint: string; ask: LadderAsk }> | null = null;

/**
 * A ladder a sentence asked for (`pro-read.ts`): put into the panel at once where the coin's window already shows it,
 * kept for that window otherwise. It fills the panel's fields and unfolds it; the person reads the ladder and signs
 * there — nothing is asked of the wallet here.
 */
export function askLadder(ask: LadderAsk): void {
  const state = useLadder.getState();
  if (LADDER_BUSY.has(state.phase)) return;
  if (state.mint === ask.coin.mint && state.market.status === 'ready') {
    state.open({ mint: ask.coin.mint, symbol: ask.coin.symbol }, ask);
    return;
  }
  asked = { mint: ask.coin.mint, ask };
}

/** The ladder asked for this coin, once: the window that draws the panel takes it. */
export function takeLadderAsk(mint: string): LadderAsk | null {
  const ask = asked?.mint === mint ? asked.ask : null;
  asked = null;
  return ask;
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __ladder: useLadder });
