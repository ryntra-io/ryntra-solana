import { create } from 'zustand';
import { MAX_SIGNABLE_WINDOW_MS } from '../../../lib/solana/blockhash-life.ts';
import { parseSwapClientAttempt, type SwapClientAttempt } from '../../../lib/solana/swap-client-safety.ts';
import { renewAtMs, WORSE_FIGURES_SETTLE_MS } from '../../../lib/solana/swap-press.ts';
import { citySigner } from '../app-bridge/route.ts';
import type { Tower } from '../market/types.ts';
import { makeTradeCard, type CardOutcome, type CardRequest, type TradeCardFace } from './card.ts';
import { createEngine, type Engine, type OrderBody, type QuoteBody } from './engine.ts';
import { orderMatchesReview, orderWarnings, warningLine } from './figures.ts';
import {
  confirmTrade,
  prepareOrder,
  recoverTrade,
  type AttemptStore,
  type FlowDeps,
  type FlowPhase,
  type Intent,
  type Refusal,
  type SettledTrade,
  type SignResult,
  type TradeOutcome,
} from './flow.ts';
import { proveWallet, type ProofOutcome } from './proof.ts';
import { wordsNow } from '../i18n/dict.ts';
import { FLOW } from './words.ts';
import { cleanAmountInput, typedAmount, type AmountProblem } from './amount.ts';
import { ticker } from './format.ts';
import { quoteLine } from './quote-copy.ts';
import { amountText, sizingOf, slideAmount, spendMax, startAmount, type Sizing } from './size.ts';
import { isBase, payAssetFor, payOptionsFor, SOL, unitOf, type Balance, type PayAsset, type Side } from './tiles.ts';
import { useWallet, type Holdings } from './wallet.ts';

/**
 * The trade card's state: which tower, which side and amount, the engine's price for it, the exact order the wallet
 * would sign, and where a trade is. A price is asked as soon as the card opens; once a wallet is connected the exact
 * order is built while the person looks at the card, so all its figures — the least you get among them — are on
 * screen before the one tap that opens the wallet. A tap on a price alone never opens the wallet: it builds the order
 * and shows it first.
 */

export type TowerRef = Readonly<{ mint: string; symbol: string; name: string; icon: string | null }>;

export type QuoteState =
  | Readonly<{ status: 'none' }>
  | Readonly<{ status: 'loading'; key: string }>
  | Readonly<{ status: 'ready'; key: string; body: QuoteBody; at: number }>
  | Readonly<{ status: 'error'; key: string; refusal: Refusal }>;

/** The exact order on the card: what the wallet will be asked to sign. */
export type Review = Readonly<{ key: string; order: OrderBody; receivedAt: number; renewals: number }>;

export type Phase = 'idle' | 'preparing' | 'wallet' | 'sending' | 'checking' | 'done' | 'failed' | 'unknown';

export type Notice = Readonly<{ tone: 'info' | 'warn' | 'error'; text: string }>;

/** A finished trade, with the decimals the engine read for its two coins so the card can write the amounts. */
export type Done = Readonly<{ trade: SettledTrade; side: Side; tower: TowerRef; pay: PayAsset; decimals: Readonly<Record<string, number>> }>;

export type CardState =
  | Readonly<{ status: 'none' }>
  | Readonly<{ status: 'proving' }>
  | Readonly<{ status: 'making' }>
  | Readonly<{ status: 'ready'; card: TradeCardFace }>
  | Readonly<{ status: 'error'; message: string }>;

export type Connection = Readonly<{ wallet: string; address: string }>;

/** Everything the card reaches outside itself; tests put stubs here. */
export type TradeEnv = Readonly<{
  engine: Engine;
  attempts: AttemptStore;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  sign: (connection: Connection, unsignedWireBase64: string) => Promise<SignResult>;
  wallet: () => Readonly<{ connection: Connection | null; holdings: Holdings | null }>;
  refreshHoldings: (delaysMs?: readonly number[]) => void;
  card: (request: CardRequest) => Promise<CardOutcome>;
  prove: (connection: Connection) => Promise<ProofOutcome>;
}>;

/** The one record of an open signature, shared with every other trade surface of Ryntra in this tab. */
const ATTEMPT_KEY = 'ryntra.solana.m2.swap-client-attempt.v1';

/** The open signature record every trade surface of the city shares (the SOL Saver in Earn reads the same one). */
export const browserAttempts: AttemptStore = {
  read: () => {
    try {
      return parseSwapClientAttempt(window.sessionStorage.getItem(ATTEMPT_KEY));
    } catch {
      return null;
    }
  },
  write: (attempt) => {
    try {
      window.sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
    } catch {
      // Without storage the server's own lock still holds the signature.
    }
  },
  clear: () => {
    try {
      window.sessionStorage.removeItem(ATTEMPT_KEY);
    } catch {
      // Nothing to clear.
    }
  },
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let env: TradeEnv = {
  engine: createEngine(),
  attempts: browserAttempts,
  now: () => Date.now(),
  sleep,
  sign: (connection, wire) => citySigner.signTransaction({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: wire, chain: 'solana:mainnet' }),
  wallet: () => useWallet.getState(),
  refreshHoldings: (delays) => useWallet.getState().refreshHoldings(delays),
  card: (request) => makeTradeCard(request, { fetch: (url, init) => fetch(url, init), sleep }),
  prove: proveWallet,
};

/** Swap what the card reaches: for tests, and nothing else. */
export function setTradeEnv(next: Partial<TradeEnv>): void {
  env = { ...env, ...next };
}

/** After a trade the chain is read again a little later, for an RPC that lags. */
const AFTER_TRADE_READS_MS = [1_500, 7_000];
/** A glow set by a trade waits this long for the wallet's balances to say the same. */
const OPTIMISTIC_MS = 60_000;
/** A typed amount, or one the slider is dragged to, is priced once it rests for this long. */
export const TYPING_MS = 450;

/** A price that did not come, in the card's own calm words: the engine's English never reaches the screen (`quote-copy.ts`). */
export function quoteRefusal(code: string): Refusal {
  const line = quoteLine(code);
  return { code, message: line.text, retryable: line.retryable };
}

/** What the wallet can spend of a mint, SOL from its native balance; null while the balances are unknown. */
export function balanceOf(holdings: Holdings | null, mint: string): Balance | null {
  if (!holdings) return null;
  if (mint === SOL.mint) return holdings.sol;
  return holdings.tokens.get(mint) ?? (holdings.complete ? { spendableRaw: '0', decimals: 0 } : null);
}

export type Choice = Readonly<{
  /** What is spent on a buy and received on a sale. */
  pay: PayAsset;
  /** What this tower can be paid with: SOL, USDC and the other coin the person picked, never the tower itself. */
  options: readonly PayAsset[];
  /** What the wallet holds of the coin spent; null while unknown. */
  holding: Balance | null;
  /** The chips and the slider: shares of what can be spent (`size.ts`). */
  sizing: Sizing;
  /** The amount in the field, raw units of what is spent; null while it holds none, or a wrong one. */
  amountRaw: string | null;
  /** What is wrong with the amount in the field, in plain words. */
  problem: AmountProblem | null;
  /** A sale of the whole holding. */
  all: boolean;
  inputMint: string;
  outputMint: string;
  /** How the spent coin is written, and its decimals when known: what a limit's amount is said in. */
  spendUnit: string;
  spendDecimals: number | null;
  /** Binds a price or an order to the side and amount on screen. */
  key: string | null;
}>;

/**
 * What the person picked beyond the side: the asset to pay with (SOL or USDC by symbol, the other coin by mint), the
 * other coin itself, and the amount in the field.
 */
export type Picks = Readonly<{ pay?: string | null; typed?: string; other?: PayAsset | null }>;

/** How a pay asset is picked: SOL and USDC by their symbol, any other coin by its mint. */
export function payKey(asset: PayAsset): string {
  return isBase(asset) ? asset.symbol : asset.mint;
}

/** The side and amount on the card, from the tower, the wallet's balances and the field. */
export function choiceOf(tower: TowerRef, side: Side, holdings: Holdings | null, picks: Picks = {}): Choice {
  const other = picks.other ?? null;
  const pay = payAssetFor(tower.mint, picks.pay, other);
  const inputMint = side === 'buy' ? pay.mint : tower.mint;
  const outputMint = side === 'buy' ? tower.mint : pay.mint;
  const spending = balanceOf(holdings, inputMint);
  // SOL spent leaves what the swap needs to land, and the rent of the account the coin got opens in a wallet without it.
  const spendsSol = inputMint === SOL.mint;
  const opensAccount = Boolean(holdings) && outputMint !== SOL.mint && !holdings?.tokens.has(outputMint);
  const max = spendMax(spending, spendsSol, opensAccount);
  // A sale is typed in the coin's own units, which only its balance tells; so is a coin of the wallet paid with.
  const spendUnit = side === 'buy' ? unitOf(pay) : ticker(tower.symbol);
  const spendDecimals = side === 'buy' ? (pay.decimals ?? (spending && spending.spendableRaw !== '0' ? spending.decimals : null)) : (spending?.decimals ?? null);
  const asset = spendDecimals === null ? null : { symbol: spendUnit, decimals: spendDecimals };
  const limit = spendsSol && spending && max !== null ? { spendableRaw: max.toString(), decimals: spending.decimals } : spending;
  const typed = picks.typed && asset ? typedAmount(picks.typed, asset, limit, spendsSol && max !== null) : null;
  const amountRaw = typed?.ok ? typed.amountRaw : null;
  return {
    pay,
    options: payOptionsFor(tower.mint, other),
    holding: spending,
    sizing: sizingOf(asset ? max : null, amountRaw),
    amountRaw,
    problem: typed && !typed.ok ? typed.problem : null,
    all: side === 'sell' && Boolean(amountRaw && spending && amountRaw === spending.spendableRaw),
    inputMint,
    outputMint,
    spendUnit,
    spendDecimals,
    key: amountRaw ? `${side}:${inputMint}>${outputMint}:${amountRaw}` : null,
  };
}

/** The field's text a card starts with for this side and what pays (`startAmount`): empty when nothing can be spent. */
function startTyped(tower: TowerRef, side: Side, holdings: Holdings | null, picks: Picks): string {
  const choice = choiceOf(tower, side, holdings, { ...picks, typed: '' });
  if (choice.spendDecimals === null) return '';
  return amountText(startAmount(side, choice.pay, choice.sizing.max === null ? null : BigInt(choice.sizing.max)), choice.spendDecimals);
}

/** The card's three ways to trade: at the market price now, a limit order that waits at its price, a stop. */
export type Mode = 'market' | 'limit' | 'stop';

/**
 * Which window the card is: `swap` — what you
 * pay, what you get and one flip between them, nothing else; `spot` — the coin's price and chart in the window, Market ·
 * Limit · Stop and Buy · Sell. A tower opens Spot; the menu's Swap door opens Swap.
 */
export type View = 'swap' | 'spot';

/** A coin to open the card on: a tower of the city, or any coin the search named. */
export type CoinRef = Readonly<{ id: string; symbol: string; name: string; icon: string | null }>;

type TradeStore = {
  open: boolean;
  tower: TowerRef | null;
  side: Side;
  /** The asset the person pays with — SOL or USDC by symbol, the other coin by mint — kept from one card to the next. */
  pay: string;
  /** The coin beyond SOL and USDC the person picked to pay with or be paid in, kept with `pay`. */
  other: PayAsset | null;
  /** Market, Limit or Stop; limit and stop live in `spot-store.ts` and show only behind their switch. */
  mode: Mode;
  view: View;
  /**
   * A Ryntra launch's tower (CITY-138): the window shows its Buy and Sell on its own curve or pool, through the Launch
   * engine (`city/components/launch/LaunchTradePanel.tsx`), and this card asks Jupiter for nothing.
   */
  launch: boolean;
  /** A limit's signature is out (`spot-store.ts`): the card cannot be closed or changed under it. */
  held: boolean;
  /** The amount in the field, as typed or written there by a chip or the slider; empty for none. */
  typed: string;
  quote: QuoteState;
  review: Review | null;
  phase: Phase;
  /** The order being built was asked by the card itself, not by a tap. */
  auto: boolean;
  /** The last choice the card built an order for by itself: never twice on its own. */
  autoKey: string | null;
  notice: Notice | null;
  /** When the figures on screen last got worse: a tap right after is not taken as agreeing to them. */
  worseAt: number;
  done: Done | null;
  failed: string | null;
  unknown: Readonly<{ signature: string; message: string }> | null;
  card: CardState;
  /** Towers a trade just lit or let go, until the wallet's balances say the same. */
  optimistic: Readonly<Record<string, Readonly<{ held: boolean; at: number }>>>;
  /** The tower that just got bought: the city celebrates it for a moment. */
  celebrate: Readonly<{ mint: string; at: number }> | null;

  /**
   * The card for a tower or any coin, on buying unless `side` says otherwise: «Mine» opens it on selling. The way to
   * trade stays the card's own (Market unless `mode` says otherwise).
   */
  openFor: (tower: Tower | CoinRef, side?: Side, options?: Readonly<{ mode?: Mode; launch?: boolean; view?: View }>) => void;
  close: () => void;
  setSide: (side: Side) => void;
  /**
   * A share of what can be spent, 0–100: a chip's, priced at once, or the slider's, priced once it rests. The field
   * takes the amount it is.
   */
  setShare: (share: number, settle?: 'now' | 'rest') => void;
  setMode: (mode: Mode) => void;
  /** The plain swap or spot with its chart; a swap is always at the market price. */
  setView: (view: View) => void;
  /** SOL or USDC by symbol, or the other coin by mint: what to pay with, and what a sale is paid in. */
  setPay: (key: string) => void;
  /** Any coin to pay with (from the wallet) or to be paid in (from the search); SOL and USDC are their own chips. */
  pickCoin: (asset: PayAsset) => void;
  /** The amount field; priced once the typing pauses. */
  setTyped: (text: string) => void;
  refreshQuote: () => Promise<void>;
  /** Build the exact order for the wallet while the person looks; never opens the wallet. */
  prepare: (auto: boolean) => Promise<void>;
  /** Rebuild the order's bytes before they run out, while the card is read. */
  renew: () => Promise<void>;
  /** The card's one button. 'connect' asks the card to show the wallets. */
  press: () => Promise<'connect' | 'ok'>;
  /** Read the open signature back, on the card. */
  recover: (attempt?: SwapClientAttempt | null) => Promise<void>;
  /** Read an open signature back quietly, when its wallet comes back after a reload. */
  recoverQuietly: () => Promise<void>;
  shareCard: () => Promise<void>;
  /** After a finished trade: the card again, for the next one. */
  again: () => void;
};

const initial = {
  open: false,
  tower: null,
  side: 'buy' as Side,
  view: 'spot' as View,
  launch: false,
  typed: '',
  quote: { status: 'none' } as QuoteState,
  review: null,
  phase: 'idle' as Phase,
  auto: false,
  autoKey: null,
  notice: null,
  worseAt: 0,
  done: null,
  failed: null,
  unknown: null,
  card: { status: 'none' } as CardState,
};

/** The phases where a signature may be out: the card cannot be closed or changed under them. */
export const BUSY: ReadonlySet<Phase> = new Set(['wallet', 'sending', 'checking']);

let actionTicket = 0;
let quoteTicket = 0;
let typingTicket = 0;
let quietRecovery: string | null = null;

export const useTrade = create<TradeStore>((set, get) => {
  const current = () => {
    const state = get();
    return state.tower ? choiceOf(state.tower, state.side, env.wallet().holdings, { pay: state.pay, typed: state.typed, other: state.other }) : null;
  };

  const intentOf = (choice: Choice, connection: Connection): Intent | null =>
    choice.amountRaw && choice.key ? { side: get().side, inputMint: choice.inputMint, outputMint: choice.outputMint, amountRaw: choice.amountRaw, taker: connection.address } : null;

  /** A new amount in the field: the price and the order on screen were for another one and go. */
  const amountTo = (typed: string, settle: 'now' | 'rest') => {
    const state = get();
    // An amount changes over an order the card is building by itself: that order is dropped (the ticket below).
    const building = state.phase === 'preparing' && state.auto;
    if (!state.tower || (state.phase !== 'idle' && !building) || state.held || typed === state.typed) return;
    actionTicket += 1;
    const my = ++typingTicket;
    // The price on screen was for another amount: it goes, so nothing is ordered on it.
    set({ typed, review: null, notice: null, quote: { status: 'none' }, ...(building ? { phase: 'idle' as Phase, auto: false, autoKey: null } : {}) });
    if (settle === 'now') {
      void get().refreshQuote();
      return;
    }
    // Priced when the typing or the slider rests, never for every step.
    void env.sleep(TYPING_MS).then(() => {
      if (my === typingTicket) void get().refreshQuote();
    });
  };

  const deps = (connection: Connection, quiet = false): FlowDeps => ({
    engine: env.engine,
    sign: (wire) => env.sign(connection, wire),
    attempts: env.attempts,
    now: env.now,
    sleep: env.sleep,
    onPhase: quiet ? undefined : (phase: FlowPhase) => set(phase === 'preparing' ? { phase } : { phase, auto: false }),
  });

  const glow = (mint: string, held: boolean) => set((state) => ({ optimistic: { ...state.optimistic, [mint]: { held, at: env.now() } } }));

  /** An order is bound to the choice it was built for, never to whatever the card shows when it arrives. */
  const reviewOf = (order: OrderBody, receivedAt: number, key: string | null): Review => ({ key: key ?? current()?.key ?? '', order, receivedAt, renewals: 0 });

  /** What a finished step means on the card; `key` is the choice the step was asked for. */
  const settle = (outcome: TradeOutcome, my: number, key: string | null = null) => {
    if (my !== actionTicket) return;
    const state = get();
    switch (outcome.kind) {
      case 'ready':
        set({ phase: 'idle', auto: false, review: reviewOf(outcome.order, outcome.receivedAt, key) });
        return;
      case 'review':
        set({ phase: 'idle', auto: false, notice: { tone: 'warn', text: outcome.note }, worseAt: env.now(), review: reviewOf(outcome.order, outcome.receivedAt, key) });
        return;
      case 'refused':
        set({ phase: 'idle', auto: false, review: null, notice: { tone: 'error', text: outcome.refusal.message } });
        return;
      case 'cancelled':
        set({ phase: 'idle', auto: false, notice: { tone: 'info', text: wordsNow(FLOW).cancelledInWallet } });
        return;
      case 'locked':
        void get().recover(outcome.attempt);
        return;
      case 'nothing':
        set({ phase: 'idle', auto: false, review: null, autoKey: null, notice: { tone: 'info', text: outcome.message } });
        void get().refreshQuote();
        return;
      case 'unknown':
        set({ phase: 'unknown', auto: false, unknown: { signature: outcome.signature, message: outcome.message } });
        return;
      case 'failed':
        env.refreshHoldings(AFTER_TRADE_READS_MS);
        set({ phase: 'failed', auto: false, review: null, failed: outcome.signature });
        return;
      case 'settled': {
        env.refreshHoldings(AFTER_TRADE_READS_MS);
        const choice = current();
        if (!state.tower || !choice) {
          set({ phase: 'idle', auto: false, review: null });
          return;
        }
        const trade = { ...outcome.trade, inputMint: outcome.trade.inputMint || choice.inputMint, outputMint: outcome.trade.outputMint || choice.outputMint };
        const bought = state.side === 'buy';
        // Your tower lights up at once; the wallet's balances confirm it a moment later.
        if (bought) glow(state.tower.mint, true);
        else if (choice.all) glow(state.tower.mint, false);
        set({
          phase: 'done',
          auto: false,
          review: null,
          notice: null,
          done: {
            trade,
            side: state.side,
            tower: state.tower,
            pay: choice.pay,
            decimals: { [SOL.mint]: SOL.decimals, ...(state.quote.status === 'ready' ? state.quote.body.decimals : {}), ...(state.review?.order.decimals ?? {}) },
          },
          card: { status: 'none' },
          celebrate: bought ? { mint: state.tower.mint, at: env.now() } : null,
        });
        return;
      }
    }
  };

  return {
    ...initial,
    pay: SOL.symbol,
    other: null,
    mode: 'market' as Mode,
    held: false,
    optimistic: {},
    celebrate: null,

    openFor: (tower, side = 'buy', options = {}) => {
      if (get().open && (BUSY.has(get().phase) || get().held)) return;
      const ref: TowerRef = { mint: tower.id, symbol: tower.symbol, name: tower.name, icon: tower.icon };
      const typed = startTyped(ref, side, env.wallet().holdings, { pay: get().pay, other: get().other });
      actionTicket += 1;
      typingTicket += 1;
      const view = options.view ?? 'spot';
      set({ ...initial, open: true, tower: ref, side, mode: view === 'swap' ? 'market' : (options.mode ?? 'market'), view, typed, launch: options.launch === true });
      void get().refreshQuote();
    },

    close: () => {
      if (BUSY.has(get().phase) || get().held) return;
      actionTicket += 1;
      set({ ...initial });
    },

    setSide: (side) => {
      const state = get();
      if (!state.tower || state.side === side || state.phase !== 'idle' || state.held) return;
      // A coin found to be paid in is not one to pay with until the wallet holds it: buying falls back to SOL.
      const holdings = env.wallet().holdings;
      const chosen = payAssetFor(state.tower.mint, state.pay, state.other);
      const held = balanceOf(holdings, chosen.mint);
      const pay = side === 'buy' && !isBase(chosen) && held !== null && held.spendableRaw === '0' ? SOL.symbol : state.pay;
      const typed = startTyped(state.tower, side, holdings, { pay, other: state.other });
      actionTicket += 1;
      typingTicket += 1;
      set({ side, pay, typed, review: null, notice: null, quote: { status: 'none' } });
      void get().refreshQuote();
    },

    setShare: (share, settle = 'now') => {
      const choice = current();
      if (!choice || choice.sizing.max === null || choice.spendDecimals === null) return;
      amountTo(amountText(slideAmount(BigInt(choice.sizing.max), share), choice.spendDecimals), settle);
    },

    setView: (view) => {
      const state = get();
      if (!state.tower || state.view === view || state.phase !== 'idle' || state.held) return;
      set({ view, ...(view === 'swap' && state.mode !== 'market' ? { mode: 'market' as Mode, review: null, notice: null, autoKey: null } : {}) });
    },

    setMode: (mode) => {
      const state = get();
      if (!state.tower || state.mode === mode || state.phase !== 'idle' || state.held) return;
      // The market order on screen belongs to the market tab; a limit or a stop has its own Review.
      actionTicket += 1;
      set({ mode, review: null, notice: null, autoKey: null });
    },

    setPay: (key) => {
      const state = get();
      if (!state.tower || state.phase !== 'idle' || state.held) return;
      const pay = payAssetFor(state.tower.mint, key, state.other);
      if (payKey(pay) !== key || payKey(pay) === payKey(payAssetFor(state.tower.mint, state.pay, state.other))) return;
      // A buy starts again in the new asset; a sale keeps its amount of the coin.
      const typed = state.side === 'buy' ? startTyped(state.tower, 'buy', env.wallet().holdings, { pay: key, other: state.other }) : state.typed;
      actionTicket += 1;
      typingTicket += 1;
      set({ pay: key, typed, review: null, notice: null, quote: { status: 'none' } });
      void get().refreshQuote();
    },

    pickCoin: (asset) => {
      const state = get();
      if (!state.tower || state.phase !== 'idle' || state.held || asset.mint === state.tower.mint) return;
      if (isBase(asset)) return get().setPay(asset.symbol);
      set({ other: asset });
      get().setPay(asset.mint);
    },

    setTyped: (text) => amountTo(cleanAmountInput(text), 'rest'),

    refreshQuote: async () => {
      const choice = current();
      if (get().launch || !choice?.amountRaw || !choice.key) {
        set({ quote: { status: 'none' } });
        return;
      }
      const key = choice.key;
      const my = ++quoteTicket;
      const previous = get().quote;
      // A refresh of the same price keeps the old figures on screen until the new ones arrive.
      if (!(previous.status === 'ready' && previous.key === key)) set({ quote: { status: 'loading', key } });
      const answer = await env.engine.quote({ inputMint: choice.inputMint, outputMint: choice.outputMint, amountRaw: choice.amountRaw });
      if (my !== quoteTicket || current()?.key !== key) return;
      set({
        quote: answer.ok
          ? { status: 'ready', key, body: answer.value, at: env.now() }
          : { status: 'error', key, refusal: quoteRefusal(answer.failure.code) },
      });
    },

    prepare: async (auto) => {
      const state = get();
      const connection = env.wallet().connection;
      const choice = current();
      if (state.launch || !connection || !choice?.key || state.phase !== 'idle' || state.mode !== 'market' || state.review?.key === choice.key) return;
      // By itself the card orders only the amount whose price is on screen.
      if (auto && (state.autoKey === choice.key || state.quote.status !== 'ready' || state.quote.key !== choice.key)) return;
      const intent = intentOf(choice, connection);
      if (!intent) return;
      const key = choice.key;
      const my = ++actionTicket;
      set({ phase: 'preparing', auto, autoKey: auto ? key : state.autoKey, notice: auto ? state.notice : null });
      settle(await prepareOrder(intent, deps(connection)), my, key);
    },

    renew: async () => {
      const state = get();
      const connection = env.wallet().connection;
      const review = state.review;
      const choice = current();
      if (!connection || !review || !choice?.key || review.key !== choice.key || state.phase !== 'idle' || state.mode !== 'market') return;
      const intent = intentOf(choice, connection);
      if (!intent) return;
      const my = ++actionTicket;
      set({ phase: 'preparing', auto: true });
      const fresh = await prepareOrder(intent, deps(connection));
      if (my !== actionTicket) return;
      if (fresh.kind !== 'ready') {
        // The shown order stays readable; a tap builds fresh bytes itself.
        set({ phase: 'idle', auto: false, review: { ...review, renewals: review.renewals + 1 } });
        if (fresh.kind === 'locked') void get().recover(fresh.attempt);
        return;
      }
      const same = orderMatchesReview(review.order, fresh.order);
      set({
        phase: 'idle',
        auto: false,
        review: { key: review.key, order: fresh.order, receivedAt: fresh.receivedAt, renewals: review.renewals + 1 },
        ...(same ? {} : { worseAt: env.now(), notice: { tone: 'warn' as const, text: wordsNow(FLOW).priceMoved } }),
      });
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
      if (state.phase !== 'idle' || state.mode !== 'market') return 'ok';
      const connection = env.wallet().connection;
      if (!connection) return 'connect';
      const choice = current();
      if (!choice) return 'ok';
      const intent = intentOf(choice, connection);
      if (!intent) return 'ok';
      const review = state.review?.key === choice.key ? state.review : null;
      if (!review) {
        // A price alone: build the exact order and show it; the wallet opens on the next tap.
        await get().prepare(false);
        return 'ok';
      }
      // Figures that just got worse are read before they are agreed to.
      if (env.now() - state.worseAt < WORSE_FIGURES_SETTLE_MS) return 'ok';
      const my = ++actionTicket;
      // A tap is never the card building by itself: the field stays shut until the wallet step is over.
      set({ notice: null, auto: false });
      settle(await confirmTrade({ intent, order: review.order, receivedAt: review.receivedAt }, deps(connection)), my, review.key);
      return 'ok';
    },

    recover: async (given) => {
      const connection = env.wallet().connection;
      const attempt = given ?? env.attempts.read();
      if (!connection || !attempt || attempt.state === 'SETTLED' || attempt.taker !== connection.address) return;
      const my = ++actionTicket;
      set({ phase: 'checking', notice: null });
      const choice = current();
      settle(await recoverTrade(attempt, deps(connection), choice ? { inputMint: choice.inputMint, outputMint: choice.outputMint } : null), my);
    },

    recoverQuietly: async () => {
      const connection = env.wallet().connection;
      const attempt = env.attempts.read();
      if (!connection || !attempt || attempt.state === 'SETTLED' || attempt.taker !== connection.address) return;
      if (quietRecovery === attempt.signature || BUSY.has(get().phase)) return;
      quietRecovery = attempt.signature;
      // Reading only: the record is let go when the chain answers, and the balances follow.
      const outcome = await recoverTrade(attempt, deps(connection, true));
      if (outcome.kind === 'settled' || outcome.kind === 'failed') env.refreshHoldings(AFTER_TRADE_READS_MS);
    },

    shareCard: async () => {
      const state = get();
      const connection = env.wallet().connection;
      if (!state.done || !connection || state.card.status === 'making' || state.card.status === 'proving') return;
      const request: CardRequest = {
        address: connection.address,
        mint: state.done.tower.mint,
        signature: state.done.trade.signature,
        kind: state.done.side === 'buy' ? 'BUY' : 'SELL',
      };
      set({ card: { status: 'making' } });
      let made = await env.card(request);
      if (!made.ok && made.code === 'PROOF_REQUIRED') {
        set({ card: { status: 'proving' } });
        const proof = await env.prove(connection);
        if (!proof.ok) {
          set({ card: proof.state === 'declined' ? { status: 'none' } : { status: 'error', message: proof.message } });
          return;
        }
        set({ card: { status: 'making' } });
        made = await env.card(request);
      }
      if (made.ok) {
        set({ card: { status: 'ready', card: made.card } });
        return;
      }
      const w = wordsNow(FLOW);
      const message =
        made.code === 'NOT_FOUND'
          ? request.kind === 'SELL'
            ? w.noCardForSale
            : w.stillRecorded
          : made.code === 'PROOF_REQUIRED'
            ? w.walletNotConfirmed
            : w.cardsUnavailable;
      set({ card: { status: 'error', message } });
    },

    again: () => {
      const state = get();
      if (!state.tower) return;
      actionTicket += 1;
      // After a sale the balances are a moment behind the chain: the next trade starts from buying, at its start.
      const side: Side = state.done?.side === 'sell' ? 'buy' : state.side;
      const typed = side === state.side ? state.typed : startTyped(state.tower, side, env.wallet().holdings, { pay: state.pay, other: state.other });
      typingTicket += 1;
      set({ phase: 'idle', side, typed, done: null, failed: null, unknown: null, card: { status: 'none' }, review: null, autoKey: null, notice: null });
      void get().refreshQuote();
    },
  };
});

/** When the shown order's bytes should be rebuilt, or null when they should not be any more. */
export function renewAt(review: Review | null): number | null {
  if (!review) return null;
  const signableMs = typeof review.order.signableMs === 'number' ? review.order.signableMs : MAX_SIGNABLE_WINDOW_MS;
  return renewAtMs({ receivedAtMs: review.receivedAt, signableMs, renewals: review.renewals });
}

/** The warnings of the order on the card, in words. */
export function reviewNotes(review: Review | null): readonly string[] {
  return review ? orderWarnings(review.order).map((rule) => warningLine(rule, review.order)) : [];
}

/** The towers that glow in your colour: what the wallet holds, and what a trade just changed. */
export function glowingMints(owned: ReadonlySet<string>, optimistic: TradeStore['optimistic'], now: number): ReadonlySet<string> {
  const mints = new Set(owned);
  for (const [mint, mark] of Object.entries(optimistic)) {
    if (now - mark.at > OPTIMISTIC_MS) continue;
    if (mark.held) mints.add(mint);
    else mints.delete(mint);
  }
  return mints;
}

// Development hook: lets the screenshot scripts stage the trade card (a finished trade and its moment) without a wallet.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __trade: useTrade });
