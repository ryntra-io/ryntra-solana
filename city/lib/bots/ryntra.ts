import { create } from 'zustand';
import type { AssistantBotDraft } from '../../../lib/assistant/bots/schema.ts';
import type { BotsToolAnswer, DraftAnswer, ExplainAnswer, SimulateAnswer, SuggestAnswer } from '../../../lib/assistant/bots/tools.ts';
import { draftIssues, type BotDraft } from './draft.ts';
import type { Lang } from './format.ts';
import { useBotsWindow } from './open.ts';
import { useBots, type Coin } from './store.ts';

/**
 * Ryntra in the bots window (CITY-133): the assistant line's bot tools (`POST /api/v1/assistant/bots`) — the week's
 * pick for the coin with its alternative and reasons, the replay over 7, 30 and 180 days, two lines on a bot of the
 * wallet's own, the wallet's report, and the draft «set it up for me» opens in the window's own review.
 *
 * One assistant in the city: no second ask box here — the window asks the tools with the person's taps (a coin, a
 * horizon, an amount), never with words. Drafts only: nothing here signs, sends or asks the wallet anything; the
 * person starts the bot in the review, on paper.
 */

export const RYNTRA_BOTS_ROUTE = '/api/v1/assistant/bots';
export const HORIZONS = ['week', 'month', 'half_year'] as const;
export type Horizon = (typeof HORIZONS)[number];
/** A read that hangs gives up: the hub stands without Ryntra's line. */
export const ASK_WAIT_MS = 15_000;
/** An answer is asked again after this long while the window is open. */
export const ANSWER_FRESH_MS = 5 * 60_000;

export type AskFetch = (url: string, init: RequestInit) => Promise<Readonly<{ ok: boolean; json: () => Promise<unknown> }>>;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** The tools' answer, checked as far as the window reads it: anything else is no answer, never a guess. */
export function readAnswer(body: unknown): BotsToolAnswer | null {
  if (!isObject(body) || body.signs !== false || body.source !== 'engine' || typeof body.tool !== 'string' || typeof body.ok !== 'boolean') return null;
  if (body.ok === false) return typeof body.line === 'string' ? (body as BotsToolAnswer) : null;
  if (body.tool === 'suggest') return typeof body.line === 'string' ? (body as BotsToolAnswer) : null;
  if (body.tool === 'simulate') return Array.isArray(body.windows) ? (body as BotsToolAnswer) : null;
  if (body.tool === 'explain') return Array.isArray(body.lines) && body.lines.every((l) => typeof l === 'string') ? (body as BotsToolAnswer) : null;
  if (body.tool === 'draft') return isObject(body.draft) && body.draft.status === 'draft' && body.draft.signs === false ? (body as BotsToolAnswer) : null;
  if (body.tool === 'weather') return isObject(body.weather) ? (body as BotsToolAnswer) : null;
  return null;
}

export async function askBots(body: Record<string, unknown>, fetcher: AskFetch = (url, init) => fetch(url, init)): Promise<BotsToolAnswer | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ASK_WAIT_MS);
  try {
    const response = await fetcher(RYNTRA_BOTS_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Ryntra-API': '1' },
      credentials: 'omit',
      signal: abort.signal,
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return readAnswer(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Ryntra's draft as the window's own: the same kinds, the same fields; a draft the window would refuse is no draft. */
export function toCityDraft(draft: AssistantBotDraft): BotDraft | null {
  const pair = { mint: draft.mint, symbol: draft.symbol };
  const common = { pair, amountUsd: draft.amountUsd, exit: draft.exit } as const;
  let out: BotDraft | null = null;
  if (draft.kind === 'grid' && draft.grid) out = { ...common, kind: 'grid', lower: draft.grid.lower, upper: draft.grid.upper, levels: draft.grid.levels };
  else if ((draft.kind === 'buyLadder' || draft.kind === 'exitLadder') && draft.ladder) out = { ...common, kind: draft.kind, steps: draft.ladder.steps, firstPct: draft.ladder.firstPct, lastPct: draft.ladder.lastPct };
  else if (draft.kind === 'recurring' && draft.recurring) out = { ...common, kind: 'recurring', everyHours: draft.recurring.everyHours, buys: draft.recurring.buys };
  return out && draftIssues(out).length === 0 ? out : null;
}

/* ------------------------------------------------------------------ the store */

export type Entry<T> = Readonly<{ status: 'loading'; at: number }> | Readonly<{ status: 'ready'; at: number; answer: T }> | Readonly<{ status: 'none'; at: number; line: string | null }>;

type Refusal = Extract<BotsToolAnswer, { ok: false }>;

export type RyntraState = {
  horizon: Horizon;
  suggestions: Readonly<Record<string, Entry<SuggestAnswer>>>;
  simulations: Readonly<Record<string, Entry<SimulateAnswer>>>;
  explains: Readonly<Record<string, Entry<ExplainAnswer>>>;
  drafting: boolean;
  setHorizon: (horizon: Horizon) => void;
  suggest: (coin: Coin, amountUsd: number, lang: Lang, force?: boolean) => Promise<void>;
  simulate: (coin: Coin, kind: string, amountUsd: number, horizon: Horizon, lang: Lang) => Promise<void>;
  /** Two lines on one of the wallet's bots, or the wallet's report (`botId` null). */
  explain: (wallet: string, botId: string | null, lang: Lang) => Promise<void>;
  /** Ryntra drafts the bot and the window opens it in its review: the person checks it and starts it there. */
  draft: (coin: Coin, kind: string, amountUsd: number, horizon: Horizon, lang: Lang) => Promise<boolean>;
};

export const suggestKey = (mint: string, horizon: Horizon, amountUsd: number, lang: Lang) => `${mint}:${horizon}:${amountUsd}:${lang}`;
export const simulateKey = (mint: string, kind: string, amountUsd: number, horizon: Horizon, lang: Lang) => `${mint}:${kind}:${amountUsd}:${horizon}:${lang}`;
export const explainKey = (wallet: string, botId: string | null, lang: Lang) => `${wallet}:${botId ?? '*'}:${lang}`;

const fresh = (entry: Entry<unknown> | undefined, now: number) => entry !== undefined && (entry.status === 'loading' || now - entry.at < ANSWER_FRESH_MS);
const noneOf = (answer: BotsToolAnswer | null, at: number): Entry<never> => ({ status: 'none', at, line: answer && answer.ok === false ? (answer as Refusal).line : null });

export function createRyntraStore(options: Readonly<{ fetch?: AskFetch; now?: () => number }> = {}) {
  const now = options.now ?? Date.now;
  const ask = (body: Record<string, unknown>) => askBots(body, options.fetch);
  return create<RyntraState>((set, get) => ({
    horizon: 'month',
    suggestions: {},
    simulations: {},
    explains: {},
    drafting: false,
    setHorizon: (horizon) => set({ horizon }),
    suggest: async (coin, amountUsd, lang, force = false) => {
      const horizon = get().horizon;
      const key = suggestKey(coin.mint, horizon, amountUsd, lang);
      const at = now();
      if (!force && fresh(get().suggestions[key], at)) return;
      set({ suggestions: { ...get().suggestions, [key]: { status: 'loading', at } } });
      const answer = await ask({ tool: 'suggest', locale: lang, mint: coin.mint, horizon, amountUsd });
      const entry: Entry<SuggestAnswer> = answer && answer.tool === 'suggest' && answer.ok && answer.ask === null ? { status: 'ready', at, answer } : noneOf(answer, at);
      set({ suggestions: { ...get().suggestions, [key]: entry } });
    },
    simulate: async (coin, kind, amountUsd, horizon, lang) => {
      const key = simulateKey(coin.mint, kind, amountUsd, horizon, lang);
      const at = now();
      if (fresh(get().simulations[key], at)) return;
      set({ simulations: { ...get().simulations, [key]: { status: 'loading', at } } });
      const answer = await ask({ tool: 'simulate', locale: lang, mint: coin.mint, kind, amountUsd, horizon });
      const entry: Entry<SimulateAnswer> = answer && answer.tool === 'simulate' && answer.ok ? { status: 'ready', at, answer } : noneOf(answer, at);
      set({ simulations: { ...get().simulations, [key]: entry } });
    },
    explain: async (wallet, botId, lang) => {
      const key = explainKey(wallet, botId, lang);
      const at = now();
      if (fresh(get().explains[key], at)) return;
      set({ explains: { ...get().explains, [key]: { status: 'loading', at } } });
      const subject = botId ? { about: 'bot', wallet, botId } : { about: 'hangar', wallet };
      const answer = await ask({ tool: 'explain', locale: lang, subject });
      const entry: Entry<ExplainAnswer> = answer && answer.tool === 'explain' && answer.ok ? { status: 'ready', at, answer } : noneOf(answer, at);
      set({ explains: { ...get().explains, [key]: entry } });
    },
    draft: async (coin, kind, amountUsd, horizon, lang) => {
      if (get().drafting) return false;
      set({ drafting: true });
      const answer = await ask({ tool: 'draft', locale: lang, mint: coin.mint, kind, amountUsd, horizon });
      set({ drafting: false });
      const draft = answer && answer.tool === 'draft' && answer.ok ? toCityDraft((answer as DraftAnswer).draft) : null;
      if (!draft || draft.pair.mint !== coin.mint) return false;
      // The window's own review opens on it: «Start» there, on paper, is the person's tap.
      useBots.setState({ draft, editing: null, page: { kind: 'detail' }, mint: coin.mint });
      useBotsWindow.getState().setTab('launch');
      return true;
    },
  }));
}

export const useRyntraBots = createRyntraStore();

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __ryntraBots: useRyntraBots });
