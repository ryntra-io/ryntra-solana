import { create } from 'zustand';
import { fetchCandles, type CandlesFetch } from '../chart/candles.ts';
import { CHAIN_FRESH_MS, fetchChain, type ChainFetch, type ChainRead } from './chain.ts';
import { defaultDraft, draftIssues, isDraftKind, type BotDraft, type DraftKind, type Pair } from './draft.ts';
import { pause, start, stop, type PaperBot } from './hangar.ts';
import { isBotKind, isGoal, type Goal, type NextKind } from './kinds.ts';
import { BOT_TABS, PAPER_KEY, isBotTab, runningIn, useBotsWindow, type BotTab } from './open.ts';
import { barsFromCandles, type Bar } from './path.ts';
import { recommend } from './recommend.ts';
import { closeStrategy, copyDraft, copyGate, type Strategy } from './strategies.ts';
import { weatherOf, type Weather } from './weather.ts';

/**
 * The bots window's store (B4): the page open on «Start», the draft being edited, the person's paper bots and
 * strategies — kept in this browser (every read and write in try/catch: storage that refuses means a fresh hangar,
 * never a broken window) — and the bots the connected wallet really runs, read from the engine's Hangar. Paper only:
 * no action here signs, sends or asks the wallet anything.
 *
 * Whether the window is open and on which tab is the light `open.ts`: the Deck's «Agents» tray opens it with
 * `openBots(tab)` without loading any of this.
 */

export { BOT_TABS, isBotTab, type BotTab };

export type Page =
  | Readonly<{ kind: 'home' }>
  | Readonly<{ kind: 'detail' }>
  | Readonly<{ kind: 'flow'; goal: Goal; step: 'pick' | 'confirm' }>;

/** A coin's week: its hourly bars and their weather; `ready` with no bars is a coin without a price history yet. */
export type PathEntry = Readonly<{ status: 'loading' | 'ready'; bars: readonly Bar[]; weather: Weather | null; at: number }>;

/** What a coin is, as the window needs it: the tower it stands for and its price now. */
export type Coin = Readonly<{ mint: string; symbol: string; price: number }>;

export type Notice = Readonly<{ text: 'started' | 'saved'; at: number }>;

export const STORAGE = { bots: PAPER_KEY, strategies: 'ryntra.city.bots.strategies.v1', notified: 'ryntra.city.bots.notify.v1' } as const;

/** A path is read again after this long. */
export const PATH_FRESH_MS = 5 * 60_000;
/** How long the hub waits for the candles; past it the coin has no week to try a bot on, and the hub says so. */
export const PATH_WAIT_MS = 10_000;
/** Fewer hourly bars than this is no week to try a bot on. */
export const MIN_BARS = 24;

export type BotsState = {
  page: Page;
  /** The coin the hub is on; null follows the tower picked in the city. */
  mint: string | null;
  draft: BotDraft | null;
  /** The strategy the draft was opened from, to save a version of it. */
  editing: string | null;
  /** The amount the newcomer's flow starts with. */
  flowAmount: number;
  bots: PaperBot[];
  strategies: Strategy[];
  notified: NextKind[];
  paths: Readonly<Record<string, PathEntry>>;
  /** The bot the hangar shows open. */
  focus: string | null;
  notice: Notice | null;
  /** The connected wallet's own bots, as the engine's Hangar reads them. */
  chain: ChainRead;
  hydrated: boolean;
};

type Actions = {
  go: (page: Page) => void;
  back: () => void;
  pickCoin: (mint: string | null) => void;
  /** Opens a bot on a coin with the draft its weather suggests. */
  openKind: (kind: DraftKind, coin: Coin) => void;
  setDraft: (draft: BotDraft) => void;
  startFlow: (goal: Goal) => void;
  setFlowAmount: (amount: number) => void;
  /** The flow's second tap: the recommended bot's draft for the chosen amount. */
  useRecommended: (coin: Coin) => void;
  /** Starts the draft as a paper bot; the hangar opens on it. */
  startPaper: (now?: number) => PaperBot | null;
  pauseBot: (id: string, now?: number) => void;
  resumeBot: (id: string, now?: number) => void;
  stopBot: (id: string, now?: number) => void;
  finishBot: (id: string) => void;
  focusBot: (id: string | null) => void;
  /** Saving loads Strategy Lab's lineage first (`lineage.ts`): it stays out of the city's first frame. */
  saveAsStrategy: (name: string, now?: number) => Promise<Strategy | null>;
  saveVersion: (note?: string, now?: number) => Promise<void>;
  fork: (id: string, now?: number) => Promise<void>;
  copySettings: (id: string, now?: number) => boolean;
  closeStrategy: (id: string, now?: number) => void;
  notify: (id: NextKind) => void;
  loadPath: (coin: Coin, force?: boolean) => Promise<void>;
  say: (text: Notice['text'] | null) => void;
  /** Reads the wallet's own bots from the engine's Hangar; null — no wallet connected — clears them. */
  loadChain: (wallet: string | null, force?: boolean) => Promise<void>;
  /** Reads the hangar and the strategies kept in this browser, once. */
  hydrate: () => void;
};

export type BotsStore = BotsState & Actions;

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

const storage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

export function readList<T>(store: Storage | null, key: string, ok: (value: unknown) => value is T): T[] {
  try {
    const raw = store?.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(ok) : [];
  } catch {
    return [];
  }
}

export function writeList(store: Storage | null, key: string, list: readonly unknown[]): void {
  try {
    store?.setItem(key, JSON.stringify(list));
  } catch {
    /* A full or refused storage: the hangar lives until the page closes. */
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isPair = (value: unknown): value is Pair => isRecord(value) && typeof value.mint === 'string' && typeof value.symbol === 'string';
export const isDraft = (value: unknown): value is BotDraft =>
  isRecord(value) && isBotKind(value.kind) && isDraftKind(value.kind) && isPair(value.pair) && typeof value.amountUsd === 'number' && typeof value.exit === 'string';
export const isPaperBot = (value: unknown): value is PaperBot =>
  isRecord(value) && typeof value.id === 'string' && isDraft(value.draft) && typeof value.createdAt === 'number' && Array.isArray(value.spans) && value.mode === 'paper';
export const isStrategy = (value: unknown): value is Strategy =>
  isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && Array.isArray(value.versions) && value.versions.length > 0 && value.versions.every((v) => isRecord(v) && isDraft(v.draft));

export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export type StoreOptions = Readonly<{
  storage?: () => Storage | null;
  fetch?: CandlesFetch;
  chainFetch?: ChainFetch;
  now?: () => number;
}>;

/** The tab the window shows: the light store's, so the Deck and the window agree. */
const setTab = (tab: BotTab) => useBotsWindow.getState().setTab(tab);

export function createBotsStore(options: StoreOptions = {}) {
  const store = options.storage ?? storage;
  const now = options.now ?? Date.now;
  const fetcher: CandlesFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const chainFetcher: ChainFetch = options.chainFetch ?? ((url, init) => fetch(url, init));

  return create<BotsStore>((set, get) => {
    const saveBots = (bots: PaperBot[]) => {
      set({ bots });
      writeList(store(), STORAGE.bots, bots);
      // The drones over the quarter follow the hangar.
      useBotsWindow.setState({ counted: true, running: runningIn(JSON.stringify(bots)) });
    };
    const saveStrategies = (strategies: Strategy[]) => {
      set({ strategies });
      writeList(store(), STORAGE.strategies, strategies);
    };
    const mapBot = (id: string, change: (bot: PaperBot) => PaperBot) => saveBots(get().bots.map((b) => (b.id === id ? change(b) : b)));

    return {
      page: { kind: 'home' },
      mint: null,
      draft: null,
      editing: null,
      flowAmount: 100,
      bots: [],
      strategies: [],
      notified: [],
      paths: {},
      focus: null,
      notice: null,
      chain: { status: 'idle' },
      hydrated: false,

      go: (page) => set({ page }),
      back: () => {
        const page = get().page;
        if (page.kind === 'flow' && page.step === 'confirm') set({ page: { ...page, step: 'pick' } });
        else set({ page: { kind: 'home' } });
      },
      pickCoin: (mint) => set({ mint }),
      openKind: (kind, coin) => {
        const path = get().paths[coin.mint];
        set({ draft: defaultDraft(kind, { mint: coin.mint, symbol: coin.symbol }, coin.price, path?.weather ?? null), editing: null, page: { kind: 'detail' } });
        setTab('launch');
      },
      setDraft: (draft) => set({ draft }),
      startFlow: (goal) => {
        if (!isGoal(goal)) return;
        set({ page: { kind: 'flow', goal, step: 'pick' } });
        setTab('launch');
      },
      setFlowAmount: (amount) => set({ flowAmount: amount }),
      useRecommended: (coin) => {
        const page = get().page;
        if (page.kind !== 'flow') return;
        const weather = get().paths[coin.mint]?.weather ?? null;
        const { kind } = recommend(page.goal, weather);
        set({ draft: defaultDraft(kind, { mint: coin.mint, symbol: coin.symbol }, coin.price, weather, get().flowAmount), editing: null, page: { ...page, step: 'confirm' } });
      },
      startPaper: (at = now()) => {
        const draft = get().draft;
        if (!draft || draftIssues(draft).length) return null;
        const strategyId = draft.copiedFrom?.strategyId ?? get().editing;
        const bot = start({ id: uuid(), draft, createdAt: at, spans: [], stoppedAt: null, strategyId: strategyId && get().strategies.some((s) => s.id === strategyId) ? strategyId : null, mode: 'paper' }, at);
        saveBots([bot, ...get().bots]);
        set({ page: { kind: 'home' }, focus: bot.id, notice: { text: 'started', at } });
        setTab('hangar');
        return bot;
      },
      pauseBot: (id, at = now()) => mapBot(id, (b) => pause(b, at)),
      resumeBot: (id, at = now()) => mapBot(id, (b) => start(b, at)),
      stopBot: (id, at = now()) => mapBot(id, (b) => stop(b, at)),
      finishBot: (id) => {
        const bot = get().bots.find((b) => b.id === id);
        if (!bot) return;
        // The unfinished bot leaves the hangar and comes back as the draft it was, to be checked and started.
        saveBots(get().bots.filter((b) => b.id !== id));
        set({ draft: bot.draft, editing: bot.strategyId, page: { kind: 'detail' }, mint: bot.draft.pair.mint });
        setTab('launch');
      },
      focusBot: (focus) => set({ focus }),
      saveAsStrategy: async (name, at = now()) => {
        const draft = get().draft;
        if (!draft || draftIssues(draft).length) return null;
        const { saveStrategy } = await import('./lineage.ts');
        const strategy = saveStrategy({ id: uuid(), versionId: uuid(), name, draft, now: at });
        saveStrategies([strategy, ...get().strategies]);
        set({ editing: strategy.id, notice: { text: 'saved', at } });
        return strategy;
      },
      saveVersion: async (note = '', at = now()) => {
        const { draft, editing } = get();
        if (!draft || !editing) return;
        const { addVersion } = await import('./lineage.ts');
        saveStrategies(get().strategies.map((s) => (s.id === editing ? addVersion(s, { versionId: uuid(), draft, note, now: at }) : s)));
        set({ notice: { text: 'saved', at } });
      },
      fork: async (id, at = now()) => {
        const source = get().strategies.find((s) => s.id === id);
        if (!source || copyGate(source, at).ok === false) return;
        const { forkStrategy } = await import('./lineage.ts');
        const forked = forkStrategy(source, { id: uuid(), versionId: uuid(), now: at });
        saveStrategies([forked, ...get().strategies]);
        set({ draft: forked.versions[0]!.draft, editing: forked.id, page: { kind: 'detail' }, mint: forked.versions[0]!.draft.pair.mint });
        setTab('launch');
      },
      copySettings: (id, at = now()) => {
        const strategy = get().strategies.find((s) => s.id === id);
        if (!strategy || !copyGate(strategy, at).ok) return false;
        const draft = copyDraft(strategy);
        set({ draft, editing: strategy.owner === 'me' ? strategy.id : null, page: { kind: 'detail' }, mint: draft.pair.mint });
        setTab('launch');
        return true;
      },
      closeStrategy: (id, at = now()) => saveStrategies(get().strategies.map((s) => (s.id === id ? closeStrategy(s, at) : s))),
      notify: (id) => {
        const notified = get().notified.includes(id) ? get().notified : [...get().notified, id];
        set({ notified });
        writeList(store(), STORAGE.notified, notified);
      },
      loadPath: async (coin, force = false) => {
        const have = get().paths[coin.mint];
        const at = now();
        if (have && !force && (have.status === 'loading' || at - have.at < PATH_FRESH_MS)) return;
        set({ paths: { ...get().paths, [coin.mint]: { status: 'loading', bars: have?.bars ?? [], weather: have?.weather ?? null, at } } });
        let bars: Bar[] = [];
        try {
          // A read that hangs never holds the hub: past the limit the coin simply has no week yet.
          const abort = new AbortController();
          const timer = setTimeout(() => abort.abort(), PATH_WAIT_MS);
          const read = await fetchCandles(coin.mint, '1h', { fetch: fetcher, now, signal: abort.signal }).finally(() => clearTimeout(timer));
          if (read.status === 'ready') bars = barsFromCandles(read.candles);
        } catch {
          bars = [];
        }
        // No week of the coin's own prices: nothing is tried on it — a week is never made up.
        if (bars.length < MIN_BARS) bars = [];
        // A read that came back after a newer one started keeps the newer one's place.
        if (get().paths[coin.mint]?.at !== at) return;
        set({ paths: { ...get().paths, [coin.mint]: { status: 'ready', bars, weather: weatherOf(bars), at } } });
      },
      say: (text) => set({ notice: text ? { text, at: now() } : null }),
      loadChain: async (wallet, force = false) => {
        if (!wallet) return set({ chain: { status: 'idle' } });
        const have = get().chain;
        if (!force && have.status !== 'idle' && have.wallet === wallet && (have.status === 'loading' || (have.status === 'ready' && now() - have.answer.at < CHAIN_FRESH_MS))) return;
        set({ chain: { status: 'loading', wallet } });
        const answer = await fetchChain(wallet, { fetch: chainFetcher });
        // The wallet changed while the read was out: its answer is not this wallet's.
        const current = get().chain;
        if (current.status === 'idle' || current.wallet !== wallet) return;
        set({ chain: answer ? { status: 'ready', wallet, answer: { ...answer, at: answer.at || now() } } : { status: 'error', wallet } });
      },
      hydrate: () => {
        if (get().hydrated) return;
        const s = store();
        const bots = readList(s, STORAGE.bots, isPaperBot);
        set({
          hydrated: true,
          bots,
          strategies: readList(s, STORAGE.strategies, isStrategy),
          notified: readList(s, STORAGE.notified, (v): v is NextKind => v === 'flipGrid' || v === 'stocksFunding'),
        });
        useBotsWindow.setState({ counted: true, running: runningIn(JSON.stringify(bots)) });
      },
    };
  });
}

export const useBots = createBotsStore();

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __bots: useBots });
