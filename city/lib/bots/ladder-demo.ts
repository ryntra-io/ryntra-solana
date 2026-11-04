import { bandOfPlan, binOfPrice, chunkRungs, planLeg, type LadderPool } from '../../../lib/bots/ladder/plan.ts';
import type { LadderOrderRead, PlacedLeg } from '../../../lib/bots/ladder/orders.ts';
import { DEVNET_USDC, WRAPPED_SOL } from '../../../lib/bots/ladder/network.ts';
import { defaultDraft, type BotDraft } from './draft.ts';
import type { LadderPoolInfo, LadderStatus, LiveLadder } from './ladder.ts';

/**
 * The review stand of the ladder on devnet (CITY-135) — fixtures for `ladder-shots.mjs` only: a devnet SOL/USDC pool at
 * the city's SOL price, a review wallet's public address, and three ladders it placed — one working, one whose bundle
 * half-landed, one filled. Public facts only: addresses and steps, never a key.
 */

export const REVIEW_WALLET = 'Rev1ewWa11etPub1icAddress1111111111111111111';
export const REVIEW_POOL = 'DevPoo1SoLUSDCRev1ew11111111111111111111111';

const order = (n: number) => `Order${String(n).padStart(3, '0')}Rev1ew1111111111111111111111111111`.slice(0, 44);

export function poolAt(price: number): LadderPoolInfo {
  const facts: LadderPool = { pool: REVIEW_POOL, binStep: 10, activeId: 0, baseIsX: true, baseMint: WRAPPED_SOL, quoteMint: DEVNET_USDC, baseDecimals: 9, quoteDecimals: 6 };
  const activeId = binOfPrice(price, false, facts);
  const index = Math.floor(activeId / 70);
  return {
    facts: { ...facts, activeId },
    activePrice: price,
    takesLimitOrders: true,
    existingArrays: Array.from({ length: 17 }, (_, i) => index - 8 + i),
    bitmapExtension: true,
  };
}

export function statusAt(price: number, at: number): LadderStatus {
  return { open: true, network: 'devnet', venue: { venue: 'dlmm', available: true }, pool: poolAt(price), at };
}

function placed(draft: BotDraft, leg: Parameters<typeof planLeg>[0], price: number, first: number, failFrom: number | null) {
  const pool = poolAt(price);
  const plan = planLeg(leg, pool.facts)!;
  const legs: PlacedLeg[] = chunkRungs(plan.rungs).map((rungs, i) => ({
    limitOrder: order(first + i),
    side: plan.side,
    state: failFrom !== null && i >= failFrom ? 'failed' : 'confirmed',
    signature: failFrom !== null && i >= failFrom ? null : `Sig${first + i}`,
    rungs,
  }));
  return { draft, plan, legs };
}

/** Three placed ladders and what devnet reads of them now, at `price`. */
export function laddersDemo(price: number, now: number): Readonly<{ ladders: LiveLadder[]; reads: LadderOrderRead[]; poolPrice: number }> {
  const pair = { mint: WRAPPED_SOL, symbol: 'SOL' };
  const buyDraft = defaultDraft('buyLadder', pair, price, null, 250);
  const working = placed(buyDraft, { side: 'buy', steps: 5, firstPct: 2, lastPct: 12, shape: 'even', amountRaw: '250000000' }, price * 1.03, 1, null);
  const smartDraft = { ...defaultDraft('smartDca', pair, price, null, 400), steps: 8, firstPct: 1, lastPct: 30 } as BotDraft;
  const half = placed(smartDraft, { side: 'buy', steps: 8, firstPct: 1, lastPct: 30, shape: 'deeper', amountRaw: '200000000' }, price, 10, 1);
  const exitDraft = { ...defaultDraft('exitLadder', pair, price, null, 300), exit: 'stop' } as BotDraft;
  const filled = placed(exitDraft, { side: 'exit', steps: 4, firstPct: 3, lastPct: 15, shape: 'even', amountRaw: String(Math.round((300 / (price * 0.85)) * 1e9)) }, price * 0.85, 20, null);
  const ladder = (id: string, x: ReturnType<typeof placed>, hoursAgo: number): LiveLadder => ({
    id,
    network: 'devnet',
    owner: REVIEW_WALLET,
    pool: REVIEW_POOL,
    baseIsX: true,
    draft: x.draft,
    band: bandOfPlan(x.plan),
    legs: x.legs,
    placedAt: now - hoursAgo * 3_600_000,
    closedAt: null,
  });
  const reads: LadderOrderRead[] = [
    ...working.legs.map((leg, i) => ({ limitOrder: leg.limitOrder, pool: REVIEW_POOL, state: (i === 0 ? 'partial' : 'open') as LadderOrderRead['state'], rungs: leg.rungs.length, filled: i === 0 ? 2 : 0, partial: 0 })),
    ...half.legs.filter((leg) => leg.state === 'confirmed').map((leg) => ({ limitOrder: leg.limitOrder, pool: REVIEW_POOL, state: 'open' as const, rungs: leg.rungs.length, filled: 0, partial: 0 })),
    ...filled.legs.map((leg) => ({ limitOrder: leg.limitOrder, pool: REVIEW_POOL, state: 'filled' as const, rungs: leg.rungs.length, filled: leg.rungs.length, partial: 0 })),
  ];
  return { ladders: [ladder('l-half', half, 1), ladder('l-working', working, 30), ladder('l-filled', filled, 70)], reads, poolPrice: price };
}
