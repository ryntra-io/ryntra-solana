import { create } from 'zustand';
import { dollarsFromMicro, MIN_COLLATERAL_MICRO } from '../../../lib/phoenix/collateral-model.ts';
import type { HistoryKind } from '../../../lib/phoenix/history.ts';
import { symbolKey, type FuturesBook, type FuturesCandles, type FuturesFunding, type FuturesMarket, type FuturesMarkets } from '../../../lib/phoenix/market-data.ts';
import type { PerpSide } from '../../../lib/phoenix/orders-model.ts';
import { MAX_SIGNABLE_WINDOW_MS } from '../../../lib/solana/blockhash-life.ts';
import { walletSignsV1 } from '../../../lib/solana/wallet.client.ts';
import { citySigner } from '../app-bridge/route.ts';
import { wordsNow } from '../i18n/dict.ts';
import type { AccountRead } from './account.ts';
import { EXCHANGE_EXIT } from './flag.ts';
import {
  createExchangeEngine,
  type CollateralBody,
  type CollateralReview,
  type CollateralStates,
  type ExchangeEngine,
  type History,
  type OrderBody,
  type OrderReview,
  type OrderStates,
  type TicketFigures,
  type TicketQuery,
} from './engine.ts';
import { checkCollateral, checkOrder, collateralReceipt, orderReceipt, reviewFresh, sendCollateral, sendOrder, type CollateralReceipt, type OrderReceipt, type SignOne } from './flow.ts';
import { clampLeverage } from './markets.ts';
import { AGAIN, refusalWords } from './refusals.ts';
import { CHART_DEFAULT, type ChartTimeframe } from './candles.ts';
import { draftFor, draftIssue, feeBpsOf, figuresKeyOf, maxKeyOf, microOf, newDraft, openBody, sizeLotsOf, ticketQuery, type Draft, type DraftIssue } from './ticket.ts';
import { EX_NOTICES } from './words.ts';

/**
 * The Exchange's state: which market is open, Phoenix's markets and the funding now, the connected wallet's account,
 * what the engine's gates let it do, the ticket and the engine's figures for it, the one Review on screen, and where
 * an action is. A Review is built only from a tap and every figure the person signs is on it before the one amber
 * tap; a tap on a Review too old to sign builds it again and shows it first.
 */

export type Connection = Readonly<{ wallet: string; address: string }>;

/** The phone's tabs; on a desk the ticket stands beside the other four. */
export type Tab = 'trade' | 'book' | 'positions' | 'orders' | 'history';

export type Phase = 'idle' | 'reviewing' | 'wallet' | 'sending' | 'done';
export const BUSY: ReadonlySet<Phase> = new Set(['reviewing', 'wallet', 'sending']);
/** What holds the window in place: a signature in the wallet or bytes on their way. A Review being built is a read. */
export const LOCKED: ReadonlySet<Phase> = new Set(['wallet', 'sending']);

/** What a Review is of, so the card can name it. */
export type Intent =
  | Readonly<{ kind: 'open' }>
  | Readonly<{ kind: 'close'; symbol: string }>
  | Readonly<{ kind: 'protect'; symbol: string }>
  | Readonly<{ kind: 'cancel'; symbol: string; leg: 'tp' | 'sl' | null }>
  | Readonly<{ kind: 'cancelAll'; symbol: string }>
  | Readonly<{ kind: 'deposit' | 'withdraw' }>;

export type Pending =
  | Readonly<{ kind: 'order'; intent: Intent; owner: string; body: OrderBody; review: OrderReview; at: number }>
  | Readonly<{ kind: 'collateral'; intent: Intent; owner: string; body: CollateralBody; review: CollateralReview; at: number }>;

export type Result =
  | Readonly<{ kind: 'order'; intent: Intent; owner: string; review: OrderReview; receipt: OrderReceipt }>
  | Readonly<{ kind: 'collateral'; intent: Intent; owner: string; review: CollateralReview; receipt: CollateralReceipt }>;

/** One line under the figures: a fresh Review to read again, or why nothing happened. */
export type Notice = Readonly<{ tone: 'warn' | 'error'; text: string; again: boolean }>;

type Read<T> = Readonly<{ status: 'idle' | 'loading' | 'ready' | 'failed'; value: T | null; at: number | null }>;
const IDLE = { status: 'idle', value: null, at: null } as const;

export type CollateralForm = Readonly<{ action: 'deposit' | 'withdraw'; text: string }>;
export type ProtectForm = Readonly<{ symbol: string; side: PerpSide; tp: string; sl: string }>;

export type ExchangeEnv = Readonly<{
  engine: ExchangeEngine;
  sign: (connection: Connection) => SignOne;
  /** Whether this wallet signs v1 transactions: the engine then builds that format. */
  v1: (connection: Connection) => boolean;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** After a move of collateral: the wallet's coins are read again, for an RPC that lags. */
  refreshHoldings: (delaysMs?: readonly number[]) => void;
  followMs?: number;
  followEveryMs?: number;
}>;

/** How long the wallet is waited for: the longest life of a Review's bytes, and a little more. */
const WALLET_WAIT_MS = MAX_SIGNABLE_WINDOW_MS + 10_000;

const browserEnv = (): ExchangeEnv => ({
  engine: createExchangeEngine(),
  sign: (connection) => async (unsigned) => {
    // A wallet that never answers would hold the window for good: past the bytes' life an answer can no longer be sent.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<{ ok: false; timedOut: true }>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, timedOut: true }), WALLET_WAIT_MS);
    });
    const asked = citySigner
      .signTransaction({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: unsigned, chain: 'solana:mainnet' })
      .then((signed) => (signed.ok ? { ok: true as const, signed: signed.signedWireBase64 } : { ok: false as const }));
    try {
      return await Promise.race([asked, late]);
    } finally {
      clearTimeout(timer);
    }
  },
  v1: (connection) => {
    try {
      return walletSignsV1(connection.wallet);
    } catch {
      return false;
    }
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  refreshHoldings: () => {},
});

let env: ExchangeEnv | null = null;
const exchangeEnv = (): ExchangeEnv => (env ??= browserEnv());

/** Tests and the layer put their own reach here. */
export function setExchangeEnv(next: Partial<ExchangeEnv>): void {
  env = { ...exchangeEnv(), ...next };
}

/** The market the dock opens on before any other was chosen. */
export const DEFAULT_SYMBOL = 'SOL';

/** The markets are read again after this long, when someone asks for them. */
export const MARKETS_FRESH_MS = 60_000;

type Store = {
  open: boolean;
  symbol: string | null;
  tab: Tab;
  picking: boolean;
  markets: Read<FuturesMarkets>;
  funding: Read<FuturesFunding>;
  /** The open market's order book, while its tab is on screen. */
  book: Read<FuturesBook>;
  /** The open market's bars at the chart's interval, while the chart is on screen. */
  candles: Read<FuturesCandles>;
  chartTimeframe: ChartTimeframe;
  /** The wallet every read below is for; another wallet starts from nothing. */
  owner: string | null;
  account: AccountRead;
  orderStates: OrderStates | null;
  collateralStates: CollateralStates | null;
  historyKind: HistoryKind;
  history: Read<History>;
  draft: Draft;
  figures: Readonly<{ key: string; value: TicketFigures; at: number }> | null;
  figuresRead: 'idle' | 'loading' | 'failed';
  maxFor: Readonly<{ key: string; maxLots: string | null; at: number }> | null;
  /** The action a Review is being built for, or was refused for: the card names it while it waits or says no. */
  asking: Intent | null;
  pending: Pending | null;
  phase: Phase;
  result: Result | null;
  notice: Notice | null;
  collateralForm: CollateralForm | null;
  protectForm: ProtectForm | null;

  show: (symbol?: string | null) => void;
  /** Close, unless a signature or a send holds the window. */
  hide: () => void;
  setTab: (tab: Tab) => void;
  setPicking: (on: boolean) => void;
  choose: (symbol: string) => void;
  loadMarkets: (force?: boolean) => Promise<void>;
  loadFunding: () => Promise<void>;
  loadBook: () => Promise<void>;
  loadCandles: () => Promise<void>;
  setChartTimeframe: (timeframe: ChartTimeframe) => void;
  /** The wallet the reads are for: another one forgets the last one's account, gates, history and Review. */
  follow: (owner: string | null) => void;
  loadAccount: () => Promise<void>;
  loadGates: () => Promise<void>;
  setHistoryKind: (kind: HistoryKind) => void;
  loadHistory: () => Promise<void>;
  setDraft: (patch: Partial<Draft>) => void;
  readFigures: () => Promise<void>;
  /** Build the Review of an order — the ticket's open, or a position's close, TP/SL or a cancel. */
  review: (connection: Connection, intent: Intent, body?: OrderBody | null) => Promise<void>;
  /** The one amber tap: sign what the Review shows, or build it again when it is too old to sign. */
  confirm: (connection: Connection) => Promise<void>;
  /** Ask the chain again about an action whose outcome it has not said yet. Reading only. */
  recheck: () => Promise<void>;
  /** Away from a Review or an outcome, back to the ticket. */
  back: () => void;
  openCollateral: (action: 'deposit' | 'withdraw' | null) => void;
  setCollateralText: (text: string) => void;
  reviewCollateral: (connection: Connection) => Promise<void>;
  openProtect: (form: ProtectForm | null) => void;
  setProtect: (patch: Partial<Pick<ProtectForm, 'tp' | 'sl'>>) => void;
};

let marketsTicket = 0;
let fundingTicket = 0;
let bookTicket = 0;
let candlesTicket = 0;
let accountTicket = 0;
let gatesTicket = 0;
let historyTicket = 0;
let figuresTicket = 0;
let reviewTicket = 0;
let checking = false;
let marketsRead: Promise<void> | null = null;

/** The market whose window is open, from the markets read. */
export function currentMarket(st: Pick<Store, 'symbol' | 'markets'>): FuturesMarket | null {
  if (!st.symbol) return null;
  const key = symbolKey(st.symbol);
  return st.markets.value?.markets.find((market) => symbolKey(market.symbol) === key) ?? null;
}

export type TicketView = Readonly<{
  market: FuturesMarket | null;
  /** The order's size in base lots, from what is typed or the share of the engine's most. */
  lots: bigint | null;
  query: TicketQuery | null;
  /** The engine's figures for exactly this question; null while they are being read or the question changed. */
  figures: TicketFigures | null;
  /** The engine's most for this question without its size. */
  maxLots: string | null;
  issue: DraftIssue | null;
}>;

/** The ticket as it stands now, and the engine's figures only when they answer this very question. */
export function ticketView(st: Pick<Store, 'symbol' | 'markets' | 'owner' | 'draft' | 'figures' | 'maxFor' | 'orderStates'>): TicketView {
  const market = currentMarket(st);
  if (!market) return { market: null, lots: null, query: null, figures: null, maxLots: null, issue: null };
  const fee = feeBpsOf(market, st.orderStates?.builderBps);
  const base = ticketQuery(st.owner, market, st.draft, null, fee);
  const maxLots = base && st.maxFor?.key === maxKeyOf(base) ? st.maxFor.maxLots : null;
  const lots = sizeLotsOf(st.draft, market, maxLots);
  const query = ticketQuery(st.owner, market, st.draft, lots, fee);
  const figures = query && st.figures?.key === figuresKeyOf(query) ? st.figures.value : null;
  return { market, lots, query, figures, maxLots, issue: draftIssue(st.draft, market, lots) };
}

/** What a collateral form may move, and why not, by the engine's figures: its least, the wallet, the account, the check. */
export type CollateralCheck = Readonly<{ amount: bigint | null; issue: 'MIN' | 'WALLET' | 'WITHDRAWABLE' | 'CANARY' | null; maxMicro: bigint | null }>;

export function collateralCheck(form: CollateralForm, states: CollateralStates | null, withdrawableMicro: bigint | null): CollateralCheck {
  const amount = microOf(form.text);
  const wallet = states?.walletUsdc && /^\d+$/.test(states.walletUsdc) ? BigInt(states.walletUsdc) : null;
  const canary = states?.maxMicro && /^\d+$/.test(states.maxMicro) ? BigInt(states.maxMicro) : null;
  const room = form.action === 'deposit' ? wallet : withdrawableMicro;
  const maxMicro = room === null ? canary : canary === null ? room : room < canary ? room : canary;
  if (amount === null) return { amount, issue: null, maxMicro };
  if (amount < MIN_COLLATERAL_MICRO) return { amount, issue: 'MIN', maxMicro };
  if (form.action === 'deposit' && wallet !== null && amount > wallet) return { amount, issue: 'WALLET', maxMicro };
  if (form.action === 'withdraw' && withdrawableMicro !== null && amount > withdrawableMicro) return { amount, issue: 'WITHDRAWABLE', maxMicro };
  if (canary !== null && amount > canary) return { amount, issue: 'CANARY', maxMicro };
  return { amount, issue: null, maxMicro };
}

export const maxText = (micro: bigint | null): string => (micro === null ? '' : dollarsFromMicro(micro));

/* The moments' words, read in the language of the moment they are said (`words.ts`). */
const LOST = () => wordsNow(EX_NOTICES).lost;
const OLD = () => wordsNow(EX_NOTICES).old;
const AGED = () => wordsNow(EX_NOTICES).aged;
const BROKEN = () => wordsNow(EX_NOTICES).broken;
/** After an action the account is read again at once and once more this much later, for Phoenix's record to catch up. */
const AFTER_MS = 6_000;

// The engine's own message is for developers: a person reads the code's words (`refusals.ts`).
const refusal = (code: string): Notice => ({ tone: 'error', text: refusalWords(code), again: AGAIN.has(code) });

export const useExchange = create<Store>((set, get) => ({
  open: false,
  symbol: null,
  tab: 'trade',
  picking: false,
  markets: IDLE,
  funding: IDLE,
  book: IDLE,
  candles: IDLE,
  chartTimeframe: CHART_DEFAULT,
  owner: null,
  account: IDLE,
  orderStates: null,
  collateralStates: null,
  historyKind: 'trades',
  history: IDLE,
  draft: newDraft(),
  figures: null,
  figuresRead: 'idle',
  maxFor: null,
  asking: null,
  pending: null,
  phase: 'idle',
  result: null,
  notice: null,
  collateralForm: null,
  protectForm: null,

  show: (symbol) => {
    const st = get();
    // From a tower: its market. From the dock: the market last open, else Solana's own.
    const want = symbol ?? st.symbol ?? DEFAULT_SYMBOL;
    if ((!st.symbol || symbolKey(want) !== symbolKey(st.symbol)) && !LOCKED.has(st.phase)) get().choose(want);
    set({ open: true, picking: false, tab: symbol ? 'trade' : get().tab });
    void get().loadMarkets();
  },
  hide: () => {
    if (LOCKED.has(get().phase)) return;
    reviewTicket += 1;
    set({ open: false, picking: false, asking: null, pending: null, result: null, notice: null, collateralForm: null, protectForm: null, phase: 'idle' });
  },
  setTab: (tab) => set({ tab }),
  setPicking: (picking) => set({ picking }),
  choose: (symbol) => {
    // A Review being built for the last market is let go; only a signature holds the market in place.
    if (LOCKED.has(get().phase)) return;
    const st = get();
    const market = st.markets.value?.markets.find((entry) => symbolKey(entry.symbol) === symbolKey(symbol)) ?? null;
    reviewTicket += 1;
    set({
      symbol: market?.symbol ?? symbol,
      picking: false,
      draft: market ? draftFor(market, st.draft) : newDraft(),
      figures: null,
      figuresRead: 'idle',
      maxFor: null,
      asking: null,
      pending: null,
      result: null,
      notice: null,
      phase: 'idle',
      funding: IDLE,
      book: IDLE,
      candles: IDLE,
      protectForm: null,
    });
    bookTicket += 1;
    candlesTicket += 1;
    void get().loadFunding();
  },

  loadMarkets: async (force) => {
    const st = get();
    if (!force && st.markets.status === 'ready' && st.markets.at !== null && exchangeEnv().now() - st.markets.at < MARKETS_FRESH_MS) return;
    // One read at a time: a tower card and the window asking together share it.
    if (marketsRead) return marketsRead;
    const ticket = ++marketsTicket;
    set({ markets: { ...st.markets, status: st.markets.value ? st.markets.status : 'loading' } });
    marketsRead = exchangeEnv()
      .engine.markets()
      .then((answer) => {
        if (ticket !== marketsTicket) return;
        if (!answer.ok || !Array.isArray(answer.value.markets)) {
          // A refused read keeps the last markets on screen with their own time, marked as delayed.
          set((now) => ({ markets: { ...now.markets, status: 'failed' } }));
          return;
        }
        set({ markets: { status: 'ready', value: answer.value, at: exchangeEnv().now() } });
        settleChoice();
      })
      .finally(() => {
        marketsRead = null;
      });
    return marketsRead;
  },

  loadFunding: async () => {
    const symbol = get().symbol;
    if (!symbol) return;
    const ticket = ++fundingTicket;
    const answer = await exchangeEnv().engine.funding(symbol);
    if (ticket !== fundingTicket || get().symbol !== symbol) return;
    set(answer.ok ? { funding: { status: 'ready', value: answer.value, at: exchangeEnv().now() } } : (now) => ({ funding: { ...now.funding, status: 'failed' } }));
  },

  loadBook: async () => {
    const symbol = get().symbol;
    if (!symbol) return;
    const ticket = ++bookTicket;
    const answer = await exchangeEnv().engine.book(symbol);
    if (ticket !== bookTicket || get().symbol !== symbol) return;
    // A refused read keeps the last book on screen with its own time; the tab then says it is delayed.
    set(answer.ok && Array.isArray(answer.value?.bids) && Array.isArray(answer.value?.asks) ? { book: { status: 'ready', value: answer.value, at: exchangeEnv().now() } } : (now) => ({ book: { ...now.book, status: 'failed' } }));
  },

  loadCandles: async () => {
    const { symbol, chartTimeframe } = get();
    if (!symbol) return;
    const ticket = ++candlesTicket;
    const answer = await exchangeEnv().engine.candles(symbol, chartTimeframe);
    if (ticket !== candlesTicket || get().symbol !== symbol || get().chartTimeframe !== chartTimeframe) return;
    // A refused read keeps the last bars on screen; the chart draws only a read of its own market and interval.
    set(answer.ok && Array.isArray(answer.value?.last) ? { candles: { status: 'ready', value: answer.value, at: exchangeEnv().now() } } : (now) => ({ candles: { ...now.candles, status: 'failed' } }));
  },

  setChartTimeframe: (chartTimeframe) => {
    if (get().chartTimeframe === chartTimeframe) return;
    candlesTicket += 1;
    set({ chartTimeframe, candles: IDLE });
    void get().loadCandles();
  },

  follow: (owner) => {
    if (get().owner === owner) return;
    accountTicket += 1;
    gatesTicket += 1;
    historyTicket += 1;
    figuresTicket += 1;
    const st = get();
    // A Review or an outcome of the last wallet is not this one's; one under a signature stays to its end.
    const keep = LOCKED.has(st.phase);
    if (!keep) reviewTicket += 1;
    set({
      owner,
      account: IDLE,
      orderStates: null,
      collateralStates: null,
      history: IDLE,
      figures: null,
      figuresRead: 'idle',
      maxFor: null,
      ...(keep ? {} : { asking: null, pending: null, result: null, notice: null, phase: 'idle' as const, collateralForm: null, protectForm: null }),
    });
  },

  loadAccount: async () => {
    const owner = get().owner;
    if (!owner) return;
    const ticket = ++accountTicket;
    set((now) => ({ account: { ...now.account, status: now.account.value ? now.account.status : 'loading' } }));
    const answer = await exchangeEnv().engine.account(owner);
    if (ticket !== accountTicket || get().owner !== owner) return;
    if (answer.ok && answer.value && answer.value.wallet === owner) set({ account: { status: 'ready', value: answer.value, at: exchangeEnv().now() } });
    // A failed read keeps the last account on screen with its own time; the health then says the data is old.
    else set((now) => ({ account: { ...now.account, status: 'failed' } }));
  },

  loadGates: async () => {
    const owner = get().owner;
    if (!owner) return;
    const ticket = ++gatesTicket;
    const engine = exchangeEnv().engine;
    const [orders, collateral] = await Promise.all([engine.orderStates(owner), engine.collateralStates(owner)]);
    if (ticket !== gatesTicket || get().owner !== owner) return;
    // An answer that did not come is never read as «open»: the gate stays as it was, closed until the engine says so.
    set((now) => ({ orderStates: orders.ok ? orders.value : now.orderStates, collateralStates: collateral.ok ? collateral.value : now.collateralStates }));
  },

  setHistoryKind: (historyKind) => {
    if (historyKind === get().historyKind) return;
    historyTicket += 1;
    set({ historyKind, history: IDLE });
    void get().loadHistory();
  },
  loadHistory: async () => {
    const { owner, historyKind } = get();
    if (!owner) return;
    const ticket = ++historyTicket;
    set((now) => ({ history: { ...now.history, status: now.history.value ? now.history.status : 'loading' } }));
    const answer = await exchangeEnv().engine.history(owner, historyKind, null);
    if (ticket !== historyTicket || get().owner !== owner || get().historyKind !== historyKind) return;
    set(answer.ok ? { history: { status: 'ready', value: answer.value, at: exchangeEnv().now() } } : (now) => ({ history: { ...now.history, status: 'failed' } }));
  },

  setDraft: (patch) => {
    const st = get();
    if (BUSY.has(st.phase)) return;
    const market = currentMarket(st);
    const draft = { ...st.draft, ...patch };
    const leverage = market ? clampLeverage(draft.leverage, market.maxLeverage) : draft.leverage;
    // A new choice drops a Review of the old one: what is signed is always what the ticket shows.
    if (st.pending?.kind === 'order' && st.pending.intent.kind === 'open') reviewTicket += 1;
    set({
      draft: { ...draft, leverage, tpsl: draft.type === 'limit' ? false : draft.tpsl },
      ...(st.pending?.kind === 'order' && st.pending.intent.kind === 'open' ? { pending: null } : {}),
      notice: null,
    });
  },

  readFigures: async () => {
    const owner = get().owner;
    if (!owner) return;
    const engine = exchangeEnv().engine;
    let view = ticketView(get());
    if (!view.market || !view.query) return;
    const ticket = ++figuresTicket;
    // A share of the most needs the most first: the question without its size.
    if (get().draft.size.kind === 'share' && view.maxLots === null) {
      const base = { ...view.query, sizeLots: null };
      set({ figuresRead: 'loading' });
      const most = await engine.ticket(base);
      if (ticket !== figuresTicket) return;
      if (!most.ok) return set({ figuresRead: 'failed' });
      set({ maxFor: { key: maxKeyOf(base), maxLots: most.value.maxLots, at: exchangeEnv().now() }, figures: { key: figuresKeyOf(base), value: most.value, at: exchangeEnv().now() } });
      view = ticketView(get());
      if (!view.query || view.query.sizeLots === null) return set({ figuresRead: 'idle' });
    }
    const query = view.query!;
    set({ figuresRead: 'loading' });
    const answer = await engine.ticket(query);
    if (ticket !== figuresTicket) return;
    if (!answer.ok) return set({ figuresRead: 'failed' });
    const at = exchangeEnv().now();
    set({ figures: { key: figuresKeyOf(query), value: answer.value, at }, maxFor: { key: maxKeyOf(query), maxLots: answer.value.maxLots, at }, figuresRead: 'idle' });
  },

  review: async (connection, intent, given) => {
    const st = get();
    if (BUSY.has(st.phase)) return;
    // Closing out (decision 86): nothing new opens from the city, whatever asks.
    if (EXCHANGE_EXIT && intent.kind === 'open') return;
    let body: OrderBody | null = given ?? null;
    if (!body && intent.kind === 'open') {
      const view = ticketView(st);
      body = view.market ? openBody(connection.address, view.market, st.draft, view.lots, exchangeEnv().v1(connection)) : null;
    }
    if (!body) return;
    const ticket = ++reviewTicket;
    set({ phase: 'reviewing', asking: intent, notice: null, result: null, pending: null });
    const answer = await exchangeEnv().engine.reviewOrder(body);
    if (ticket !== reviewTicket) return;
    // A refused open is said under the ticket it came from; any other on the card of its own action.
    if (!answer.ok) return set({ phase: 'idle', asking: intent.kind === 'open' ? null : intent, notice: refusal(answer.failure.code) });
    set({ phase: 'idle', asking: null, pending: { kind: 'order', intent, owner: connection.address, body, review: answer.value, at: exchangeEnv().now() } });
  },

  reviewCollateral: async (connection) => {
    const st = get();
    const form = st.collateralForm;
    if (!form || BUSY.has(st.phase) || (EXCHANGE_EXIT && form.action === 'deposit')) return;
    const withdrawable = st.account.value?.margin?.withdrawableMicro;
    const check = collateralCheck(form, st.collateralStates, typeof withdrawable === 'string' && /^\d+$/.test(withdrawable) ? BigInt(withdrawable) : null);
    if (check.amount === null || check.issue) return;
    const body: CollateralBody = { action: form.action, owner: connection.address, amount: check.amount.toString(), ...(exchangeEnv().v1(connection) ? { format: 'v1' as const } : {}) };
    const intent: Intent = { kind: form.action };
    const ticket = ++reviewTicket;
    set({ phase: 'reviewing', asking: intent, notice: null, result: null, pending: null });
    const answer = await exchangeEnv().engine.reviewCollateral(body);
    if (ticket !== reviewTicket) return;
    if (!answer.ok) return set({ phase: 'idle', asking: intent, notice: refusal(answer.failure.code) });
    set({ phase: 'idle', asking: null, pending: { kind: 'collateral', intent, owner: connection.address, body, review: answer.value, at: exchangeEnv().now() } });
  },

  confirm: async (connection) => {
    const st = get();
    const pending = st.pending;
    if (!pending || BUSY.has(st.phase) || pending.owner !== connection.address) return;
    const run = exchangeEnv();
    const rebuild = async (text: string) => {
      const ticket = ++reviewTicket;
      set({ phase: 'reviewing', notice: null });
      const again = pending.kind === 'order' ? await run.engine.reviewOrder(pending.body) : await run.engine.reviewCollateral(pending.body);
      if (ticket !== reviewTicket) return;
      if (!again.ok) return set({ phase: 'idle', pending: null, asking: pending.intent, notice: refusal(again.failure.code) });
      set({ phase: 'idle', pending: { ...pending, review: again.value, at: run.now() } as Pending, notice: { tone: 'warn', text, again: false } });
    };
    // The wallet said no: the same Review stays to sign again. Any other refusal ends this Review.
    const refused = (code: string) => set({ phase: 'idle', ...(code === 'WALLET_REFUSED' ? {} : { pending: null, asking: pending.intent }), notice: refusal(code) });
    // A Review too old to sign never opens the wallet: it is built again and shown first.
    if (!reviewFresh(pending.review, pending.at, run.now())) return rebuild(OLD());
    const ticket = ++reviewTicket;
    set({ phase: 'wallet', notice: null });
    let signed = false;
    const deps = {
      engine: run.engine,
      sign: run.sign(connection),
      now: run.now,
      sleep: run.sleep,
      followMs: run.followMs,
      followEveryMs: run.followEveryMs,
      onSigned: () => {
        signed = true;
        set({ phase: 'sending' });
      },
    };
    let result: Result;
    try {
      if (pending.kind === 'order') {
        const sent = await sendOrder(pending.review, pending.at, connection.address, deps);
        if (ticket !== reviewTicket) return;
        // Another wallet took over while this one signed: nothing of this Review or its receipt is shown to it.
        if (get().owner !== pending.owner) return set({ phase: 'idle', asking: null, pending: null, result: null, notice: null });
        if (sent.kind === 'aged') return rebuild(AGED());
        if (sent.kind === 'refused') return refused(sent.code);
        result = { kind: 'order', intent: pending.intent, owner: pending.owner, review: pending.review, receipt: orderReceipt(pending.review, sent.relay) };
      } else {
        const sent = await sendCollateral(pending.review, pending.at, connection.address, deps);
        if (ticket !== reviewTicket) return;
        if (get().owner !== pending.owner) return set({ phase: 'idle', asking: null, pending: null, result: null, notice: null });
        if (sent.kind === 'aged') return rebuild(AGED());
        if (sent.kind === 'refused') return refused(sent.code);
        result = { kind: 'collateral', intent: pending.intent, owner: pending.owner, review: pending.review, receipt: collateralReceipt(sent.relay) };
      }
    } catch {
      // Nothing is ever left holding the window. Once the wallet signed, what happened is the chain's to say: the
      // positions and the history show it; the same Review is not offered again.
      if (ticket !== reviewTicket) return;
      return set({ phase: 'idle', pending: signed ? null : pending, asking: signed ? pending.intent : null, notice: { tone: 'error', text: signed ? LOST() : BROKEN(), again: false } });
    }
    set({ phase: 'done', pending: null, result, collateralForm: null, protectForm: null });
    // What changed is read again: the account now and once more a little later, the gates and the wallet's coins.
    void get().loadAccount();
    void get().loadGates();
    void run.sleep(AFTER_MS).then(() => {
      if (get().owner === pending.owner) void get().loadAccount();
    });
    if (pending.kind === 'collateral') run.refreshHoldings([4_000, 12_000]);
  },

  recheck: async () => {
    const result = get().result;
    if (!result || BUSY.has(get().phase) || !result.receipt.signature || checking) return;
    // One read at a time: taps on «Check again» never stack against the status route's limit.
    checking = true;
    try {
      const engine = exchangeEnv().engine;
      const signature = result.receipt.signature;
      if (result.kind === 'order') {
        const state = result.receipt.outcome === 'pending' ? ('UNKNOWN' as const) : ('LANDED' as const);
        const relay = await checkOrder({ results: [{ signature, state, reason: null, fills: null }], settled: false }, result.owner, engine);
        if (get().result === result) set({ result: { ...result, receipt: orderReceipt(result.review, relay) } });
      } else {
        const relay = await checkCollateral({ results: [{ signature, state: 'UNKNOWN', reason: null }], settled: false }, engine);
        if (get().result === result) set({ result: { ...result, receipt: collateralReceipt(relay) } });
      }
    } finally {
      checking = false;
    }
    void get().loadAccount();
  },

  back: () => {
    if (BUSY.has(get().phase)) return;
    reviewTicket += 1;
    set({ asking: null, pending: null, result: null, notice: null, phase: 'idle' });
  },

  openCollateral: (action) => {
    if (BUSY.has(get().phase) || (EXCHANGE_EXIT && action === 'deposit')) return;
    set({ collateralForm: action ? { action, text: '' } : null, pending: get().pending?.kind === 'collateral' ? null : get().pending, notice: null });
  },
  setCollateralText: (text) => {
    const form = get().collateralForm;
    if (!form || BUSY.has(get().phase)) return;
    set({ collateralForm: { ...form, text }, ...(get().pending?.kind === 'collateral' ? { pending: null } : {}), notice: null });
  },

  openProtect: (protectForm) => {
    if (BUSY.has(get().phase)) return;
    set({ protectForm, notice: null });
  },
  setProtect: (patch) => {
    const form = get().protectForm;
    if (!form || BUSY.has(get().phase)) return;
    // New prices drop a Review of the old ones, as the ticket's and the collateral form's do: what is signed is what is typed.
    const stale = get().pending?.intent.kind === 'protect';
    if (stale) reviewTicket += 1;
    set({ protectForm: { ...form, ...patch }, notice: null, ...(stale ? { pending: null } : {}) });
  },
}));

/** The market chosen before the list came takes the listed spelling and a draft that fits its leverage. */
function settleChoice(): void {
  const after = useExchange.getState();
  const market = currentMarket(after);
  if (!market) return;
  if (market.symbol !== after.symbol) useExchange.setState({ symbol: market.symbol });
  const leverage = clampLeverage(after.draft.leverage, market.maxLeverage);
  if (after.draft.leverage !== leverage) useExchange.setState({ draft: { ...after.draft, leverage } });
}
