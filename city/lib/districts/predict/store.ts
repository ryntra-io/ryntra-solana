import { create } from 'zustand';
import { chartPlan, within, type Point, type Range } from './chart.ts';
import { pickRow, tradable, type Detail } from './detail.ts';
import { createPredictEngine, type PredictEngine } from './engine.ts';
import { PREDICT_REAL } from './flag.ts';
import { headSide, marketsOf, searchTab, tabsOf, TRENDING, type Market, type Tab } from './markets.ts';
import {
  buy,
  carryOracle,
  emptyBook,
  GONE,
  ORACLE_KEY,
  parseBook,
  REFUSAL,
  resetCash,
  sell,
  settle,
  STORAGE_KEY,
  verdictOf,
  type PracticeBook,
  type Refusal,
} from './practice.ts';

/**
 * The Predictions window's state: which page is open (the markets, one market, your positions, money), the tab and
 * its cards as last read, the open market with its chance over time, the ticket (buy or sell, the side, the amount),
 * the mode (Practice or Real) and the practice book kept on this device. Real money lives in `real-store.ts`; this
 * store holds nothing that moves money.
 */

export type Mode = 'practice' | 'real';
export type Page = Readonly<{ kind: 'markets' }> | Readonly<{ kind: 'market'; eventId: string }> | Readonly<{ kind: 'positions' }> | Readonly<{ kind: 'money'; tab: 'deposit' | 'withdraw' }>;

export type ListState =
  | Readonly<{ status: 'idle' | 'loading' }>
  /** `failed`: the last refresh did not come back, so the cards are the read before it. */
  | Readonly<{ status: 'ready'; markets: readonly Market[]; readAt: string; failed: boolean }>
  | Readonly<{ status: 'error' }>;

export type DetailState = Readonly<{ status: 'idle' | 'loading' }> | Readonly<{ status: 'ready'; detail: Detail; readAt: string }> | Readonly<{ status: 'error'; gone: boolean }>;
export type ChartState = Readonly<{ key: string; status: 'loading' | 'ready' | 'error'; points: readonly Point[] }>;

/** The last buy taken in this visit, so its ticket says so and its market shows it: what, where, and how it stands. */
export type Bought = Readonly<{ eventId: string; marketId: string; outcomeId: string; label: string; spendUsd: number; at: number }>;

export type Notice = Readonly<{ tone: 'ok' | 'warn'; text: string }>;
export type Storage = Readonly<{ load: (key: string) => unknown; save: (key: string, value: unknown) => void }>;
export type PredictEnv = Readonly<{ engine: PredictEngine; storage: Storage; now: () => number }>;

/** The amount picked first: the third tile, as the window's mock shows it. */
export const FIRST_AMOUNT = 25;
/** A chart that answers no points is asked again this many times, a little later each time: AGG may be building it. */
export const CHART_RETRIES = 2;
export const CHART_RETRY_MS = 2_500;
/** Markets with a practice holding are asked about their winner at most this often, the closed ones first. */
export const SETTLE_GAP_MS = 60_000;
export const EARLY_GAP_MS = 10 * 60_000;
export const SETTLE_BATCH = 6;

const deviceStorage = (): Storage => ({
  load: (key) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      // Storage refused (a private window) or a saved book that no longer parses: a fresh book.
      return null;
    }
  },
  save: (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage refused: the book lasts this visit.
    }
  },
});

let env: PredictEnv | null = null;
export const predictEnv = (): PredictEnv => (env ??= { engine: createPredictEngine(), storage: deviceStorage(), now: () => Date.now() });

/** Tests and the stand put their own reach here. */
export function setPredictEnv(next: Partial<PredictEnv>): void {
  env = { ...predictEnv(), ...next };
}

type Store = {
  open: boolean;
  mode: Mode;
  page: Page;
  tab: string;
  tabs: readonly Tab[];
  /** The search open as a tab of its own; null when none is. */
  search: Tab | null;
  lists: Readonly<Record<string, ListState>>;
  detail: DetailState;
  range: Range;
  chart: ChartState | null;
  action: 'buy' | 'sell';
  side: string | null;
  amount: number;
  /** The share of a holding a sale takes. */
  fraction: number;
  book: PracticeBook;
  /** The live prices of the sides held, from the last read of each held market: positions are priced off its page too. */
  quotes: Readonly<Record<string, Readonly<{ p: number; readAt: string }>>>;
  hydrated: boolean;
  notice: Notice | null;
  bought: Bought | null;
  show: (page?: Page) => void;
  hide: () => void;
  setMode: (mode: Mode) => void;
  go: (page: Page) => void;
  back: () => void;
  setTab: (tab: string) => void;
  /** Search the markets: the words become a tab of their own; fewer than two letters close it. */
  find: (q: string) => void;
  /** Read the open tab again; a failed refresh keeps the cards read before and says so. */
  loadList: (tab?: string) => Promise<void>;
  /** Open a market's page, on a side when one is tapped on its card; on Sell to close a position. */
  openMarket: (eventId: string, sideId?: string | null, action?: 'buy' | 'sell', marketId?: string | null) => void;
  loadDetail: () => Promise<void>;
  /** Show another market of the page's event — one of its rows — on a side when one is tapped. */
  pickMarket: (marketId: string, sideId?: string | null) => void;
  setRange: (range: Range) => void;
  loadChart: () => Promise<void>;
  setAction: (action: 'buy' | 'sell') => void;
  setSide: (sideId: string) => void;
  setAmount: (amount: number) => void;
  setFraction: (fraction: number) => void;
  /** Practice: buy the ticket's side at the page's fresh price. */
  practiceBuy: () => Refusal | null;
  /** Practice: sell the ticket's share of the holding at the page's fresh price. */
  practiceSell: (holdingId: string) => Refusal | null;
  /** Ask the venues about the practice holdings: the closed markets first, the others at a slower pace. Reading only. */
  settleDue: () => Promise<void>;
  /** Read the markets of the open practice holdings again, so each is priced by a fresh read wherever it is shown. */
  priceHeld: () => Promise<void>;
  restart: () => void;
  hydrate: () => void;
  say: (notice: Notice | null) => void;
};

/** The last time each event was asked about its winner, in this visit. */
const asked = new Map<string, number>();
/** One read of a tab at a time: a second ask while it runs waits for the same answer. */
const reading = new Map<string, Promise<void>>();
/** When each held market was last read for its price, in this visit. */
const pricedAt = new Map<string, number>();
/** One chart read of a side and range at a time: a page read again while its chart is asked waits for that one. */
const charting = new Map<string, Promise<void>>();

/** For tests: forget the reads in flight and when markets were asked about. */
export function forgetReads(): void {
  asked.clear();
  reading.clear();
  charting.clear();
  pricedAt.clear();
  chosenMarket = null;
}

/** The market a page was opened on, or picked on it since: a later read of the event keeps it. */
let chosenMarket: string | null = null;

/** The freshest card of an event across the tabs read, with its read's time. */
export function cardOf(lists: Readonly<Record<string, ListState>>, eventId: string): Readonly<{ market: Market; readAt: string }> | null {
  let best: { market: Market; readAt: string } | null = null;
  for (const list of Object.values(lists)) {
    if (list.status !== 'ready') continue;
    const market = list.markets.find((m) => m.eventId === eventId);
    if (market && (!best || Date.parse(list.readAt) > Date.parse(best.readAt))) best = { market, readAt: list.readAt };
  }
  return best;
}

/** The market the page prices now: the event read for the page, or its card while the page is read. */
export function pageMarket(st: Pick<Store, 'page' | 'detail' | 'lists'>): Readonly<{ market: Market; readAt: string; detail: Detail | null }> | null {
  if (st.page.kind !== 'market') return null;
  const id = st.page.eventId;
  if (st.detail.status === 'ready' && st.detail.detail.eventId === id) return { market: st.detail.detail, readAt: st.detail.readAt, detail: st.detail.detail };
  const card = cardOf(st.lists, id);
  return card ? { ...card, detail: null } : null;
}

/** Held markets read again at most this many at a time, and not more often than this. */
export const HELD_BATCH = 8;
export const HELD_GAP_MS = 30_000;

/** The live price of a side, from the freshest read of its market; null when no read holds it. */
export function priceOf(st: Pick<Store, 'detail' | 'lists'> & Partial<Pick<Store, 'quotes'>>, eventId: string, marketId: string, outcomeId: string): Readonly<{ p: number; readAt: string }> | null {
  if (st.detail.status === 'ready' && st.detail.detail.eventId === eventId) {
    // Any row of the page's event: a holding on a bracket the page is not showing is priced by the same read.
    const row = st.detail.detail.marketId === marketId ? st.detail.detail : st.detail.detail.rows.find((r) => r.marketId === marketId);
    const side = row?.sides.find((s) => s.id === outcomeId);
    if (side) return { p: side.p, readAt: st.detail.readAt };
  }
  const card = cardOf(st.lists, eventId);
  if (card && card.market.marketId === marketId) {
    const side = card.market.sides.find((s) => s.id === outcomeId);
    if (side) return { p: side.p, readAt: card.readAt };
  }
  return st.quotes?.[`${marketId}:${outcomeId}`] ?? null;
}

export const usePredict = create<Store>((set, get) => {
  const save = (book: PracticeBook) => {
    set({ book });
    predictEnv().storage.save(STORAGE_KEY, book);
  };
  const readList = async (tabId: string) => {
    const tab = get().tabs.find((t) => t.id === tabId) ?? (get().search?.id === tabId ? get().search! : TRENDING);
    const before = get().lists[tabId];
    if (before?.status !== 'ready') set({ lists: { ...get().lists, [tabId]: { status: 'loading' } } });
    const got = await predictEnv().engine.discover(tab.category, { sort: tab.sort, q: tab.q });
    const now = predictEnv().now();
    if (!got.ok) {
      const last = get().lists[tabId];
      set({ lists: { ...get().lists, [tabId]: last?.status === 'ready' ? { ...last, failed: true } : { status: 'error' } } });
      return;
    }
    // The tabs come with the first read and stand for the visit: a tab never vanishes under a finger.
    if (tabId === TRENDING.id && get().tabs.length <= 1) set({ tabs: tabsOf(got.value.categories, got.value.categoriesUnavailable) });
    set({ lists: { ...get().lists, [tabId]: { status: 'ready', markets: marketsOf(got.value.events, now), readAt: got.value.readAt, failed: false } } });
  };
  const readChart = async (key: string, outcomeId: string, matched: readonly string[], range: Range) => {
    if (get().chart?.key !== key) set({ chart: { key, status: 'loading', points: [] } });
    // A refresh of a line already drawn keeps it when the venues answer nothing new: a chart never blanks under a finger.
    const drawn = () => (get().chart?.key === key && (get().chart?.points.length ?? 0) >= 2 ? get().chart : null);
    // The market's own outcome at each bar size of the range, then the same outcome at the venues the engine matched.
    const plan = chartPlan(outcomeId, matched, range);
    for (let round = 0; round <= CHART_RETRIES; round++) {
      if (round > 0) await new Promise((resolve) => setTimeout(resolve, CHART_RETRY_MS * round));
      let failed = 0;
      for (const step of plan) {
        if (get().chart?.key !== key) return;
        const got = await predictEnv().engine.chart(step.outcomeId, step.ask);
        if (get().chart?.key !== key) return;
        if (!got.ok) {
          failed++;
          continue;
        }
        const points = within(got.value, range, predictEnv().now());
        if (points.length >= 2) return set({ chart: { key, status: 'ready', points } });
      }
      // Nothing answered at all: a failure, said once, not asked over and over.
      if (failed === plan.length) return drawn() ? undefined : set({ chart: { key, status: 'error', points: [] } });
      // A refresh that found nothing new keeps the line drawn, and is not asked again until the next refresh.
      if (drawn()) return;
    }
    if (get().chart?.key === key && !drawn()) set({ chart: { key, status: 'ready', points: [] } });
  };
  return {
    open: false,
    mode: 'practice',
    page: { kind: 'markets' },
    tab: TRENDING.id,
    tabs: [TRENDING],
    search: null,
    lists: {},
    detail: { status: 'idle' },
    range: '1D',
    chart: null,
    action: 'buy',
    side: null,
    amount: FIRST_AMOUNT,
    fraction: 1,
    book: emptyBook(),
    quotes: {},
    hydrated: false,
    notice: null,
    bought: null,
    show: (page = { kind: 'markets' }) => {
      get().hydrate();
      set({ open: true, page, notice: null });
    },
    hide: () => set({ open: false, notice: null }),
    // Real only where its switch is open: with the switch closed nothing reaches the real account, whoever asks.
    setMode: (mode) => set({ mode: mode === 'real' && !PREDICT_REAL ? 'practice' : mode, notice: null }),
    go: (page) => {
      set({ page, notice: null, ...(page.kind === 'market' ? {} : { action: 'buy' as const }) });
      if (page.kind === 'positions' && get().mode === 'practice') void get().priceHeld();
    },
    back: () => set({ page: { kind: 'markets' }, notice: null, action: 'buy' }),
    setTab: (tab) => {
      set({ tab, notice: null, ...(get().search?.id === tab ? {} : { search: null }) });
      void get().loadList(tab);
    },
    find: (q) => {
      const tab = searchTab(q);
      if (!tab) {
        if (get().search) set({ search: null, tab: TRENDING.id });
        return;
      }
      if (get().search?.id === tab.id && get().tab === tab.id) return;
      set({ search: tab, tab: tab.id, page: { kind: 'markets' }, notice: null });
      void get().loadList(tab.id);
    },
    loadList: (tab = get().tab) => {
      const running = reading.get(tab);
      if (running) return running;
      const run = readList(tab).finally(() => reading.delete(tab));
      reading.set(tab, run);
      return run;
    },
    openMarket: (eventId, sideId = null, action = 'buy', marketId = null) => {
      const card = cardOf(get().lists, eventId);
      const was = get().detail;
      const sameEvent = was.status === 'ready' && was.detail.eventId === eventId;
      chosenMarket = marketId;
      const side = sideId ?? (card && (!marketId || card.market.marketId === marketId) ? headSide(card.market).id : null);
      const detail = sameEvent && marketId ? { ...was, detail: pickRow(was.detail, marketId) } : was;
      set({
        page: { kind: 'market', eventId },
        detail: sameEvent ? detail : { status: 'loading' },
        chart: sameEvent && (!marketId || was.detail.marketId === marketId) ? get().chart : null,
        action,
        side,
        fraction: 1,
        notice: null,
      });
      void get().loadDetail();
    },
    loadDetail: async () => {
      const page = get().page;
      if (page.kind !== 'market') return;
      const card = cardOf(get().lists, page.eventId)?.market ?? null;
      const got = await predictEnv().engine.event(page.eventId, card);
      const now = get().page;
      if (now.kind !== 'market' || now.eventId !== page.eventId) return;
      if (!got.ok) {
        if (get().detail.status !== 'ready') set({ detail: { status: 'error', gone: got.failure.code === 'NOT_FOUND' } });
        return;
      }
      // The row picked on the page stays picked through every later read of the event.
      const detail = chosenMarket ? pickRow(got.value, chosenMarket) : got.value;
      const side = get().side && detail.sides.some((s) => s.id === get().side) ? get().side : headSide(detail).id;
      set({ detail: { status: 'ready', detail, readAt: new Date(predictEnv().now()).toISOString() }, side });
      void get().loadChart();
    },
    pickMarket: (marketId, sideId = null) => {
      const was = get().detail;
      if (was.status !== 'ready') return;
      const detail = pickRow(was.detail, marketId);
      if (detail === was.detail && was.detail.marketId !== marketId) return;
      chosenMarket = marketId;
      const side = sideId && detail.sides.some((x) => x.id === sideId) ? sideId : headSide(detail).id;
      set({ detail: { ...was, detail }, side, fraction: 1, notice: null });
      void get().loadChart();
    },
    setRange: (range) => {
      set({ range });
      void get().loadChart();
    },
    loadChart: () => {
      const at = pageMarket(get());
      if (!at) return Promise.resolve();
      // The chance over time is the head side's: Yes on a yes/no market, the leading outcome otherwise.
      const outcomeId = headSide(at.market).id;
      const range = get().range;
      const key = `${outcomeId}:${range}`;
      const running = charting.get(key);
      if (running) return running;
      const run = readChart(key, outcomeId, at.detail?.matched ?? [], range).finally(() => charting.delete(key));
      charting.set(key, run);
      return run;
    },
    setAction: (action) => set({ action, notice: null, fraction: 1, bought: null }),
    setSide: (side) => set({ side, notice: null, bought: null }),
    setAmount: (amount) => set({ amount: Number.isFinite(amount) && amount >= 0 ? Math.min(amount, 1_000_000) : 0, notice: null, bought: null }),
    setFraction: (fraction) => set({ fraction, notice: null }),
    practiceBuy: () => {
      const st = get();
      const at = pageMarket(st);
      if (!at || !st.side) return 'side';
      if (at.detail && !tradable(at.detail, predictEnv().now())) {
        set({ notice: { tone: 'warn', text: REFUSAL.closed } });
        return 'closed';
      }
      const placed = buy(st.book, { market: at.market, sideId: st.side, spendUsd: st.amount, readAt: at.readAt }, predictEnv().now());
      if (!placed.ok) {
        set({ notice: { tone: 'warn', text: REFUSAL[placed.why] } });
        return placed.why;
      }
      save(placed.book);
      set({
        notice: { tone: 'ok', text: `Bought ${placed.holding.label}` },
        bought: { eventId: at.market.eventId, marketId: at.market.marketId, outcomeId: placed.holding.outcomeId, label: placed.holding.label, spendUsd: st.amount, at: predictEnv().now() },
      });
      return null;
    },
    practiceSell: (holdingId) => {
      const st = get();
      const holding = st.book.holdings.find((h) => h.id === holdingId);
      if (!holding) return 'holding';
      const price = priceOf(st, holding.eventId, holding.marketId, holding.outcomeId);
      const sold = sell(st.book, { holdingId, fraction: st.fraction, p: price?.p ?? null, readAt: price?.readAt ?? null }, predictEnv().now());
      if (!sold.ok) {
        set({ notice: { tone: 'warn', text: REFUSAL[sold.why] } });
        return sold.why;
      }
      save(sold.book);
      set({ notice: { tone: 'ok', text: `Sold ${holding.label}` }, fraction: 1 });
      return null;
    },
    settleDue: async () => {
      get().hydrate();
      const now = predictEnv().now();
      const closed = (closes: string | null) => !closes || !(Date.parse(closes) > now);
      const late = new Set<string>();
      const early = new Set<string>();
      for (const h of get().book.holdings) if (h.state === 'open') (closed(h.closes) ? late : early).add(h.eventId);
      const since = (id: string) => now - (asked.get(id) ?? -Infinity);
      const events = [...[...late].filter((id) => since(id) >= SETTLE_GAP_MS), ...[...early].filter((id) => !late.has(id) && since(id) >= EARLY_GAP_MS)].slice(0, SETTLE_BATCH);
      if (!events.length) return;
      for (const id of events) asked.set(id, now);
      const answers = await Promise.all(events.map(async (id) => [id, await predictEnv().engine.settle(id)] as const));
      let book = get().book;
      let won = 0;
      let lost = 0;
      let voided = 0;
      for (const [id, got] of answers) {
        // A failed read says nothing; only an event the provider no longer has (NOT_FOUND) is the venue's word that it is gone.
        if (!got.ok && got.failure.code !== 'NOT_FOUND') continue;
        for (const holding of book.holdings.filter((h) => h.eventId === id && h.state === 'open')) {
          const market = got.ok ? (got.value.markets.find((m) => m.id === holding.marketId) ?? null) : GONE;
          const verdict = verdictOf(holding, market, now);
          if (verdict === 'pending') continue;
          book = settle(book, holding.id, verdict, now);
          if (verdict === 'won') won++;
          else if (verdict === 'lost') lost++;
          else voided++;
        }
      }
      if (!won && !lost && !voided) return;
      save(book);
      const parts = [won && `${won} won`, lost && `${lost} lost`, voided && `${voided} void`].filter(Boolean);
      set({ notice: { tone: 'ok', text: `Practice settled: ${parts.join(', ')}` } });
    },
    priceHeld: async () => {
      get().hydrate();
      const now = predictEnv().now();
      const events = [...new Set(get().book.holdings.filter((h) => h.state === 'open').map((h) => h.eventId))].filter((id) => now - (pricedAt.get(id) ?? -Infinity) >= HELD_GAP_MS).slice(0, HELD_BATCH);
      if (!events.length) return;
      for (const id of events) pricedAt.set(id, now);
      const answers = await Promise.all(events.map((id) => predictEnv().engine.event(id, cardOf(get().lists, id)?.market ?? null)));
      const readAt = new Date(predictEnv().now()).toISOString();
      const quotes = { ...get().quotes };
      for (const got of answers) {
        if (!got.ok) continue;
        for (const row of got.value.rows) for (const side of row.sides) quotes[`${row.marketId}:${side.id}`] = { p: side.p, readAt };
      }
      set({ quotes });
    },
    restart: () => {
      const next = resetCash(get().book);
      if (next !== get().book) save(next);
    },
    hydrate: () => {
      if (get().hydrated) return;
      const storage = predictEnv().storage;
      const saved = parseBook(storage.load(STORAGE_KEY));
      if (saved) return set({ hydrated: true, book: saved });
      // The paper Oracle's book carries over once, the first time Practice opens on this device.
      const carried = carryOracle(storage.load(ORACLE_KEY));
      const book = carried ?? emptyBook();
      set({ hydrated: true, book });
      if (carried) storage.save(STORAGE_KEY, book);
    },
    say: (notice) => set({ notice }),
  };
});

// The stand and the screens' script read the window as the city's other stores are read: development builds only.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __predict: usePredict });
