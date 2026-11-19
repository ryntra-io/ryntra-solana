import type { BotDraft, DraftKind, Pair } from '../../city/lib/bots/draft.ts';
import { defaultDraft, draftIssues } from '../../city/lib/bots/draft.ts';
import { runOf, sortBots, statusOf, type BotStatus, type PaperBot } from '../../city/lib/bots/hangar.ts';
import type { LiveLadder } from '../../city/lib/bots/ladder.ts';
import type { Bar } from '../../city/lib/bots/path.ts';
import { simulate, tradesOf } from '../../city/lib/bots/sim.ts';
import type { Weather } from '../../city/lib/bots/weather.ts';
import type { LadderNetwork } from '../../lib/bots/ladder/network.ts';
import { PAPER_KIND, type PaperBotId } from './kinds.ts';

/**
 * What the bots' screens read and draw, pure: the drafts their forms make — the city's own (`city/lib/bots/draft.ts`),
 * from the coin, the amount and the few fields a form shows — the paper bots of one kind with what each did on the
 * market's hours since it started, and the wallet's placed ladders. Nothing here signs, sends or stores.
 */

/** A number as a person types it: a comma or a point; anything else is not a number. */
export function typedNumber(text: string): number | null {
  const plain = text.trim().replace(',', '.');
  if (!/^\d+(\.\d*)?$|^\.\d+$/u.test(plain)) return null;
  const value = Number(plain);
  return Number.isFinite(value) ? value : null;
}

/* ---------------------------------------------------------------- the coin's list */

/** A coin of a bot's list: the market's row, or one the catalogue found (no day's trading: 0). */
export type ChoiceCoin = Readonly<{ id: string; symbol: string; name: string; icon: string | null; verified: boolean; volume24h: number }>;

/** How many coins a bot's list holds at most: it scrolls inside its menu. */
export const CHOICES_MOST = 60;

/** A search worth asking the engine's catalogue: two characters at least, a ticker or an address, not more than 64. */
export function searchable(query: string): boolean {
  const text = query.trim().replace(/^\$/u, '');
  return text.length >= 2 && text.length <= 64;
}

/**
 * The coins a bot's list shows. Without a search: the first coins in their order (SOL, then the ones an example names),
 * the wallet's own, then the whole market by its day's trading. With one: the market's coins by the exact address or
 * ticker, then the tickers that start with it, then the names that hold it — the checked ones first in each — and then
 * what the catalogue found that the market does not hold. Each coin once, never more than `most`.
 */
export function coinChoices(input: Readonly<{ market: readonly ChoiceCoin[]; first: readonly string[]; held: readonly string[]; found: readonly ChoiceCoin[]; query: string; most?: number }>): ChoiceCoin[] {
  const most = input.most ?? CHOICES_MOST;
  const byMint = new Map(input.market.map((coin) => [coin.id, coin]));
  const seen = new Set<string>();
  const out: ChoiceCoin[] = [];
  const add = (coin: ChoiceCoin | undefined) => {
    if (!coin || seen.has(coin.id) || out.length >= most) return;
    seen.add(coin.id);
    out.push(coin);
  };
  const byTrade = (x: ChoiceCoin, y: ChoiceCoin) => Number(y.verified) - Number(x.verified) || y.volume24h - x.volume24h;
  const typed = input.query.trim();
  const q = typed.toLowerCase().replace(/^\$/u, '');
  if (!q) {
    for (const mint of input.first) add(byMint.get(mint));
    for (const mint of input.held) add(byMint.get(mint));
    for (const coin of [...input.market].sort((x, y) => y.volume24h - x.volume24h)) add(coin);
    return out;
  }
  const bare = (coin: ChoiceCoin) => coin.symbol.toLowerCase().replace(/^\$/u, '');
  const exact = input.market.filter((coin) => coin.id === typed || bare(coin) === q).sort(byTrade);
  const starts = input.market.filter((coin) => bare(coin).startsWith(q)).sort(byTrade);
  const named = input.market.filter((coin) => bare(coin).includes(q) || coin.name.toLowerCase().includes(q)).sort(byTrade);
  for (const coin of [...exact, ...starts, ...named]) add(coin);
  for (const coin of input.found) if (coin.symbol) add(coin);
  return out;
}

/* ---------------------------------------------------------------- the grid's venue */

/** Where a coin's grid would rest: a DLMM Pro pool, a classic DLMM pool that takes orders, none. */
export type CoinVenue = 'pro' | 'dlmm' | 'none';

/** A read of one venue for one coin, as the grid's store keeps it. */
export type VenueRead = Readonly<{ status: 'loading' | 'ready' | 'failed'; value: unknown; code: string | null }>;

/**
 * A coin's venue from the two reads, as the grid's form chooses it: DLMM Pro first, the classic pool otherwise. «None»
 * only once every open venue answered and none has a pool; a read under way, or one that failed, is not known (null) —
 * a coin is never marked «no pool» because the engine was late.
 */
export function venueOf(pro: VenueRead | undefined, classic: VenueRead | undefined, open: Readonly<{ pro: boolean; classic: boolean }>): CoinVenue | null {
  if (open.pro && pro?.value) return 'pro';
  if (open.classic && classic?.value) return 'dlmm';
  if (!open.pro && !open.classic) return null;
  /* A DLMM Pro read the lane refused as closed says «not here», as an empty one does. */
  const proSaid = !open.pro || (pro !== undefined && (pro.status === 'ready' || (pro.status === 'failed' && pro.code === 'CAPABILITY_UNAVAILABLE')));
  const classicSaid = !open.classic || classic?.status === 'ready';
  return proSaid && classicSaid ? 'none' : null;
}

/* ---------------------------------------------------------------- the ladder */

export type LadderSide = 'buy' | 'exit';

/** The prices a ladder spreads over, one tap each (the city's own steps). */
export const LADDER_STEP_CHOICES = [3, 4, 5, 8] as const;

export type LadderFields = Readonly<{ side: LadderSide; amountUsd: number; steps: number; firstPct: number; lastPct: number }>;

/** The ladder's form as the city's draft: a buy ladder under the price, an exit ladder over it. */
export function ladderDraft(pair: Pair, fields: LadderFields, price: number): BotDraft {
  const kind = fields.side === 'buy' ? 'buyLadder' : 'exitLadder';
  const base = defaultDraft(kind, pair, price, null, fields.amountUsd);
  return { ...base, kind, steps: fields.steps, firstPct: fields.firstPct, lastPct: fields.lastPct } as BotDraft;
}

/** Where a new ladder starts: the city's own distances for a day's move of the coin, on its side. */
export function ladderStart(side: LadderSide, weather: Pick<Weather, 'dayMovePct'> | null): Pick<LadderFields, 'steps' | 'firstPct' | 'lastPct'> {
  const draft = defaultDraft(side === 'buy' ? 'buyLadder' : 'exitLadder', { mint: '', symbol: '' }, 1, weather as Weather | null);
  return draft.kind === 'buyLadder' || draft.kind === 'exitLadder' ? { steps: draft.steps, firstPct: draft.firstPct, lastPct: draft.lastPct } : { steps: 5, firstPct: 2, lastPct: 12 };
}

/** The wallet's ladders on the network, those still standing first, then the newest. */
export function ladderRows(ladders: readonly LiveLadder[], owner: string | null, network: LadderNetwork | null): LiveLadder[] {
  if (!owner || !network) return [];
  return ladders
    .filter((ladder) => ladder.owner === owner && ladder.network === network)
    .sort((a, b) => Number(a.closedAt !== null) - Number(b.closedAt !== null) || b.placedAt - a.placedAt);
}

/* ---------------------------------------------------------------- on paper */

/** The signals' pace: the fast and the slow average, in hours (the city's draft keeps the two numbers). */
export const PACES = { fast: { fast: 6, slow: 13 }, steady: { fast: 12, slow: 26 }, slow: { fast: 24, slow: 52 } } as const;
export type Pace = keyof typeof PACES;

export function paceOf(draft: Pick<Extract<BotDraft, { kind: 'signal' }>, 'fast' | 'slow'>): Pace | null {
  const found = (Object.keys(PACES) as Pace[]).find((pace) => PACES[pace].fast === draft.fast && PACES[pace].slow === draft.slow);
  return found ?? null;
}

/** A paper bot's first draft on a coin: the city's own, sized for the coin's week. */
export function paperStart(id: PaperBotId, pair: Pair, price: number, weather: Weather | null, amountUsd: number): BotDraft {
  return defaultDraft(PAPER_KIND[id] as DraftKind, pair, price, weather, amountUsd);
}

export type WeekOnPaper = Readonly<{ pnlUsd: number; holdUsd: number; trades: number }>;

/** What a draft would have done on the coin's last week, hour by hour; null — no week to play it on, or not a draft that starts. */
export function weekOnPaper(draft: BotDraft | null, bars: readonly Bar[]): WeekOnPaper | null {
  if (!draft || !bars.length || draftIssues(draft).length) return null;
  const run = simulate(draft, bars);
  return run ? { pnlUsd: run.pnlUsd, holdUsd: run.holdPnlUsd, trades: tradesOf(run).length } : null;
}

export type PaperRow = Readonly<{
  key: string;
  bot: PaperBot;
  status: BotStatus;
  /** What it did on paper since it started: trades and the result in dollars; null — no hours read yet. */
  trades: number | null;
  pnlUsd: number | null;
}>;

/**
 * The person's paper bots of one kind, as the city's hangar orders them — the ones that need her first, then working,
 * paused, stopped — each with what it did on the coin's hours since it started.
 */
export function paperRows(bots: readonly PaperBot[], id: PaperBotId, bars: (mint: string) => readonly Bar[] | null, mints: ReadonlySet<string> | null): PaperRow[] {
  const kind = PAPER_KIND[id];
  const rows = bots
    .filter((bot) => bot.draft.kind === kind)
    .map((bot) => {
      const status = statusOf(bot, { mints, strategies: new Set(bot.strategyId ? [bot.strategyId] : []) });
      const hours = bars(bot.draft.pair.mint);
      const run = hours && hours.length ? runOf(bot, hours) : null;
      return { key: bot.id, bot, status, trades: run ? tradesOf(run).length : null, pnlUsd: run ? run.pnlUsd : null };
    });
  return sortBots(rows);
}

/** The paper bots of one kind at work now. */
export const paperWorking = (bots: readonly PaperBot[], id: PaperBotId): number => bots.filter((bot) => bot.draft.kind === PAPER_KIND[id] && bot.stoppedAt === null && bot.spans.at(-1)?.[1] === null).length;
