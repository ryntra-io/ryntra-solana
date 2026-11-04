import type { HangarAnswer } from '../../../lib/bots/hangar/hangar.ts';
import { createNextLineage, createRootLineage } from '../../../lib/strategy-lab/lineage.ts';
import { defaultDraft, type BotDraft, type DraftKind } from './draft.ts';
import type { PaperBot } from './hangar.ts';
import { HOUR_MS, WEEK_BARS, positive, type Bar } from './path.ts';
import type { Strategy } from './strategies.ts';

/**
 * The review stand (the shots and the tests only): a hangar and a strategies list that show every state — running,
 * paused, stopped, not finished, orphaned; yours and shared, young and old, closed and losing — and a sample week of
 * prices to serve as the engine's candles. Every figure here is a fixture; the person's own bots and strategies are
 * what they started and saved.
 */

export type DemoCoin = Readonly<{ mint: string; symbol: string; price: number }>;

const H = 3_600_000;
const D = 24 * H;

/** A coin that is no longer in the city: its bot is orphaned. */
export const GONE: DemoCoin = { mint: 'Gone1111111111111111111111111111111111111111', symbol: 'WEN', price: 0.00012 };

const ids = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;

function draftOf(kind: DraftKind, coin: DemoCoin, amountUsd: number, over: Partial<BotDraft> = {}): BotDraft {
  return { ...defaultDraft(kind, { mint: coin.mint, symbol: coin.symbol }, coin.price, null, amountUsd), ...over } as BotDraft;
}

function shared(n: number, input: Readonly<{ name: string; author: string; kind: DraftKind; coin: DemoCoin; ageDays: number; returnPct: number; maxDrawdownPct: number; trades: number; closedDaysAgo?: number; versions?: number }>, now: number): Strategy {
  const createdAt = now - input.ageDays * D;
  const draft = draftOf(input.kind, input.coin, 250);
  const versions: Strategy['versions'][number][] = [{ id: ids(n * 10), at: createdAt, draft, lineage: createRootLineage(), note: '' }];
  for (let v = 1; v < (input.versions ?? 1); v += 1) {
    const parent = versions[versions.length - 1]!;
    versions.push({
      id: ids(n * 10 + v),
      at: createdAt + v * 3 * D,
      draft: { ...parent.draft, amountUsd: parent.draft.amountUsd + 50 },
      lineage: createNextLineage({ parentRunId: parent.id, parentIteration: parent.lineage.iterationNumber, hypothesis: 'More per level', changedFields: ['amountUsd'], parentTestWindowStatus: 'sealed' }),
      note: 'More per level',
    });
  }
  return {
    id: ids(n),
    name: input.name,
    owner: 'shared',
    author: input.author,
    createdAt,
    closedAt: input.closedDaysAgo !== undefined ? now - input.closedDaysAgo * D : null,
    versions,
    forkOf: null,
    record: { returnPct: input.returnPct, maxDrawdownPct: input.maxDrawdownPct, days: input.ageDays, trades: input.trades },
    twinFrom: now - Math.min(input.ageDays, 6) * D,
  };
}

export function botsDemo(coins: Readonly<{ sol: DemoCoin; jup: DemoCoin; bonk: DemoCoin }>, now: number): { bots: PaperBot[]; strategies: Strategy[] } {
  const hour = Math.floor(now / H) * H;
  const { sol, jup, bonk } = coins;
  const mine: Strategy = {
    id: ids(900),
    name: `${sol.symbol} calm grid`,
    owner: 'me',
    author: null,
    createdAt: hour - 6 * D,
    closedAt: null,
    versions: [
      { id: ids(9000), at: hour - 6 * D, draft: draftOf('grid', sol, 200, { levels: 10 }), lineage: createRootLineage(), note: '' },
      {
        id: ids(9001),
        at: hour - 2 * D,
        draft: draftOf('grid', sol, 200, { levels: 16 }),
        lineage: createNextLineage({ parentRunId: ids(9000), parentIteration: 1, hypothesis: 'Tighter levels', changedFields: ['levels'], parentTestWindowStatus: 'sealed' }),
        note: 'Tighter levels',
      },
    ],
    forkOf: null,
    record: null,
    twinFrom: hour - 6 * D,
  };
  const bots: PaperBot[] = [
    { id: ids(101), draft: mine.versions[1]!.draft, createdAt: hour - 5 * D, spans: [[hour - 5 * D, null]], stoppedAt: null, strategyId: mine.id, mode: 'paper' },
    { id: ids(102), draft: draftOf('recurring', jup, 100, { everyHours: 24, buys: 5 }), createdAt: hour - 4 * D, spans: [[hour - 4 * D, null]], stoppedAt: null, strategyId: null, mode: 'paper' },
    { id: ids(103), draft: draftOf('exitLadder', bonk, 150), createdAt: hour - 6 * D, spans: [[hour - 6 * D, hour - 1 * D]], stoppedAt: null, strategyId: null, mode: 'paper' },
    { id: ids(104), draft: draftOf('buyLadder', sol, 250), createdAt: hour - 3 * H, spans: [], stoppedAt: null, strategyId: null, mode: 'paper' },
    { id: ids(105), draft: draftOf('grid', GONE, 80), createdAt: hour - 3 * D, spans: [[hour - 3 * D, null]], stoppedAt: null, strategyId: null, mode: 'paper' },
    { id: ids(106), draft: draftOf('rebalancer', jup, 300), createdAt: hour - 7 * D, spans: [[hour - 7 * D, hour - 2 * D]], stoppedAt: hour - 2 * D, strategyId: null, mode: 'paper' },
  ];
  const strategies: Strategy[] = [
    mine,
    shared(1, { name: `Slow ${sol.symbol} grid`, author: 'kestrel', kind: 'grid', coin: sol, ageDays: 128, returnPct: 8.4, maxDrawdownPct: 6.1, trades: 412, versions: 4 }, hour),
    shared(2, { name: `${jup.symbol} dip ladder`, author: 'mira', kind: 'buyLadder', coin: jup, ageDays: 46, returnPct: -3.6, maxDrawdownPct: 14.2, trades: 38, closedDaysAgo: 5 }, hour),
    shared(3, { name: `${sol.symbol} weekly stack`, author: 'ostap', kind: 'recurring', coin: sol, ageDays: 64, returnPct: 2.1, maxDrawdownPct: 9.8, trades: 9 }, hour),
    shared(4, { name: `${bonk.symbol} exit steps`, author: 'lin', kind: 'exitLadder', coin: bonk, ageDays: 9, returnPct: 11.2, maxDrawdownPct: 3.4, trades: 4 }, hour),
    shared(5, { name: 'Half and half', author: 'vera', kind: 'rebalancer', coin: jup, ageDays: 21, returnPct: 0.8, maxDrawdownPct: 4.9, trades: 7, versions: 2 }, hour),
  ];
  return { bots, strategies };
}

/** The review wallet: an address of the shots only, never a real person's. */
export const REVIEW_WALLET = 'Rev1ew1111111111111111111111111111111111111';

/**
 * The engine's Hangar as it would answer for the review wallet (`GET /api/bots/hangar`): a grid working in its range, a
 * ladder of buys at Jupiter Trigger V1 partly filled, and a range position out of its range; one order left behind.
 */
export function chainDemo(coins: Readonly<{ sol: DemoCoin; jup: DemoCoin }>, now: number): HangarAnswer {
  const iso = (ms: number) => new Date(ms).toISOString();
  const receipt = (signature: string) => `https://solscan.io/tx/${signature}`;
  return {
    wallet: REVIEW_WALLET,
    at: now,
    bots: [
      {
        id: 'review-grid',
        kind: 'grid',
        venue: 'meteora_dlmm',
        name: `${coins.sol.symbol}/USDC`,
        status: 'working',
        detail: null,
        vsHold: { usd: 4.18, pct: 1.7, from: iso(now - 9 * D), to: iso(now) },
        feesUsd: 2.06,
        lastFill: { at: iso(now - 2 * H), signature: 'review-sig-1', receipt: receipt('review-sig-1') },
        filler: 'pool_swaps',
        noRyntraSignature: true,
        legs: null,
        refs: {},
      },
      {
        id: 'review-ladder',
        kind: 'ladder',
        venue: 'jupiter_trigger_v1',
        name: `${coins.jup.symbol}/USDC`,
        status: 'partial',
        detail: null,
        vsHold: null,
        feesUsd: null,
        lastFill: { at: iso(now - 26 * H), signature: 'review-sig-2', receipt: receipt('review-sig-2') },
        filler: 'jupiter_keeper',
        noRyntraSignature: true,
        legs: { total: 4, filled: 1, pending: 3, closed: 0 },
        refs: {},
      },
      {
        id: 'review-range',
        kind: 'range_lp',
        venue: 'meteora_dlmm',
        name: `${coins.jup.symbol}/${coins.sol.symbol}`,
        status: 'out_of_range',
        detail: 'above',
        vsHold: { usd: -1.4, pct: -0.9, from: iso(now - 20 * D), to: iso(now) },
        feesUsd: 0.62,
        lastFill: null,
        filler: 'pool_swaps',
        noRyntraSignature: true,
        legs: null,
        refs: {},
      },
    ],
    issues: [{ kind: 'orphan', venue: 'trigger', order: 'review-order', reason: 'expired_open' }],
    sunset: null,
    read: { positions: true, orders: true, rules: false },
  };
}

/** A string's 32-bit hash: the same tower walks the same sample week on every run of the review. */
export function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A small seeded generator (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The review's sample week for a tower (fixtures only — the shots and the tests serve it as the engine's candles; the
 * window itself never makes up a price): a mean-reverting walk with the tower's 24 h move over its last day, ending
 * exactly at `price` at `end`. Swing size grows with how far the coin moved today.
 */
export function sampleBars(key: string, price: number, change24h: number, end: number, count = WEEK_BARS): Bar[] {
  if (!positive(price) || count < 2) return [];
  const rand = seeded(hashOf(key));
  const move = Number.isFinite(change24h) ? Math.max(-60, Math.min(60, change24h)) : 0;
  const sigma = Math.min(0.06, 0.006 + Math.abs(move) / 100 / 6);
  const logs: number[] = [0];
  let level = 0;
  for (let i = 1; i < count; i += 1) {
    const gauss = (rand() + rand() + rand() + rand() - 2) * 1.2;
    // Pulled back toward the week's middle, so the walk swings inside a range rather than running away.
    level += -0.04 * level + sigma * gauss;
    logs.push(level);
  }
  // The last day carries today's move.
  const day = Math.min(24, count - 1);
  const want = Math.log(1 + move / 100);
  const have = logs[count - 1]! - logs[count - 1 - day]!;
  for (let i = count - day; i < count; i += 1) logs[i] = logs[i]! + ((want - have) * (i - (count - 1 - day))) / day;
  const shift = Math.log(price) - logs[count - 1]!;
  const closes = logs.map((v) => Math.exp(v + shift));
  const bars: Bar[] = [];
  for (let i = 0; i < count; i += 1) {
    const c = closes[i]!;
    const o = i === 0 ? c : closes[i - 1]!;
    const wick = 1 + sigma * 0.6 * rand();
    bars.push({ t: end - (count - 1 - i) * HOUR_MS, o, c, h: Math.max(o, c) * wick, l: Math.min(o, c) / wick });
  }
  return bars;
}
