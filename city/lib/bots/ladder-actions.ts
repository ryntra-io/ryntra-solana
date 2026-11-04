import { useBots } from './store.ts';
import { useBotsWindow } from './open.ts';
import { composeLadder, finishLegs, useLadder, viewOf, type LadderPoolInfo, type LiveLadder } from './ladder.ts';
import { bandOfPlan, planLeg, type LadderLeg } from '../../../lib/bots/ladder/plan.ts';
import { ladderCosts } from '../../../lib/bots/ladder/costs.ts';
import type { PlacedLeg } from '../../../lib/bots/ladder/orders.ts';
import type { BotDraft } from './draft.ts';
import type { RelayLegAnswer, ReviewAnswer } from './ladder-sign.ts';

/**
 * The ladder's three actions in the bots window — place, take back, finish — on top of the composer's store
 * (`ladder.ts`) and the window's (`store.ts`). The signing module loads on the tap. One action at a time; every answer
 * ends as one short line under the action, in the window's words.
 */

export type Who = Readonly<{ wallet: string; owner: string }>;

/** How long a leg the relay sent may take to show on devnet before «not there» means it never landed. */
export const SENT_SETTLE_MS = 2 * 60_000;

const id = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `ladder-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** The placed legs from the review's transactions and the relay's answer, in order. */
export function placedLegs(review: ReviewAnswer, legs: readonly RelayLegAnswer[]): PlacedLeg[] {
  return review.transactions.map((tx) => {
    const sent = legs.find((leg) => leg.limitOrder === tx.limitOrder);
    return { limitOrder: tx.limitOrder, side: tx.side, state: sent?.state ?? 'failed', signature: sent?.signature ?? null, rungs: tx.rungs };
  });
}

/** Refresh the reads of the wallet's placed ladders that still hold something. */
export async function readLive(owner: string, fetcher: typeof fetch = fetch): Promise<void> {
  const st = useLadder.getState();
  const orders = st.ladders
    .filter((ladder) => ladder.owner === owner && ladder.closedAt === null)
    .flatMap((ladder) => ladder.legs.filter((leg) => leg.state !== 'failed').map((leg) => leg.limitOrder))
    .slice(0, 24);
  if (!orders.length) return;
  try {
    const response = await fetcher('/api/bots/ladder/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner, orders }), cache: 'no-store' });
    if (!response.ok) return;
    const body = (await response.json()) as { orders?: unknown; prices?: unknown };
    if (!Array.isArray(body.orders)) return;
    useLadder.getState().setReads(body.orders as never, (body.prices ?? {}) as Record<string, number>);
    // A leg the relay left «sent» that devnet now holds has landed; one devnet still has no account for after a while never did.
    const now = Date.now();
    for (const ladder of useLadder.getState().ladders) {
      if (!ladder.legs.some((leg) => leg.state === 'sent')) continue;
      const reads = useLadder.getState().reads;
      const settled = now - ladder.placedAt > SENT_SETTLE_MS;
      useLadder.getState().update(ladder.id, (l) => ({
        ...l,
        legs: l.legs.map((leg) => {
          const read = reads[leg.limitOrder];
          if (leg.state !== 'sent' || !read) return leg;
          if (read.state !== 'closed') return { ...leg, state: 'confirmed' };
          return settled ? { ...leg, state: 'failed' } : leg;
        }),
      }));
    }
  } catch {
    /* Not read this time: the last reading stays on screen. */
  }
}

/** «Place on devnet»: the draft's ladder, one wallet prompt. */
export async function placeDraft(draft: BotDraft, pool: LadderPoolInfo, who: Who, solUsd: number | null): Promise<void> {
  const st = useLadder.getState();
  if (st.busy) return;
  const composed = composeLadder(draft, pool, solUsd);
  if (!composed || composed.issues.length || !composed.costs) return;
  st.setBusy({ kind: 'place', id: null });
  st.say(null);
  try {
    const { placeLadder } = await import('./ladder-sign.ts');
    const result = await placeLadder({ wallet: who.wallet, owner: who.owner, pool: pool.facts.pool, legs: composed.legs, shown: st.shownCosts ?? composed.costs });
    const at = Date.now();
    if (result.kind === 'costsChanged') {
      useLadder.getState().setShownCosts(result.costs);
      useLadder.getState().say({ kind: 'costsChanged', at });
      return;
    }
    if (result.kind !== 'placed') {
      useLadder.getState().say({ kind: result.kind, at, ...(result.kind === 'refused' || result.kind === 'walletNo' ? { reason: result.reason } : {}) });
      return;
    }
    const legs = placedLegs(result.review, result.legs);
    const ladder: LiveLadder = {
      id: id(),
      network: 'devnet',
      owner: who.owner,
      pool: pool.facts.pool,
      baseIsX: pool.facts.baseIsX,
      draft,
      band: result.review.plans[0] ? bandOfPlan(result.review.plans[0]) : null,
      legs,
      placedAt: at,
      closedAt: null,
    };
    useLadder.getState().add(ladder);
    useLadder.getState().setShownCosts(null);
    useLadder.getState().say({ kind: legs.some((leg) => leg.state === 'failed') ? 'partly' : 'placed', at });
    useBots.getState().go({ kind: 'home' });
    useBotsWindow.getState().setTab('hangar');
  } finally {
    useLadder.getState().setBusy(null);
  }
}

/**
 * «Cancel orders» and every exit proposal's first step: whatever the ladder's order accounts hold comes back in one
 * prompt. A rebuild then opens the same settings around the price now, for the person to place again.
 */
export async function takeBack(ladder: LiveLadder, who: Who, then: 'none' | 'rebuild' = 'none'): Promise<void> {
  const st = useLadder.getState();
  if (st.busy) return;
  const view = viewOf(ladder, st.reads, st.prices);
  if (!view.holding.length) return;
  st.setBusy({ kind: 'cancel', id: ladder.id });
  st.say(null);
  try {
    const { cancelLadderOrders } = await import('./ladder-sign.ts');
    const result = await cancelLadderOrders({ wallet: who.wallet, owner: who.owner, orders: view.holding });
    const at = Date.now();
    if (result.kind !== 'cancelled') {
      useLadder.getState().say({ kind: result.kind, at, ...(result.kind === 'refused' || result.kind === 'walletNo' ? { reason: result.reason } : {}) });
      return;
    }
    const all = result.legs.every((leg) => leg.state !== 'failed');
    // Every account the ladder still held is closed: the ladder is done, a half-landed one included («or cancel»).
    if (all) useLadder.getState().update(ladder.id, (l) => ({ ...l, closedAt: at }));
    useLadder.getState().say({ kind: all ? 'cancelled' : 'partly', at });
    void readLive(who.owner);
    if (then === 'rebuild' && all) {
      useBots.getState().setDraft(ladder.draft);
      useBots.getState().go({ kind: 'detail' });
      useBotsWindow.getState().setTab('launch');
    }
  } finally {
    useLadder.getState().setBusy(null);
  }
}

/** The legs «Finish» places for a half-landed ladder, and their exact cost line in this pool. */
export function finishPlan(ladder: LiveLadder, pool: LadderPoolInfo) {
  const view = viewOf(ladder, useLadder.getState().reads, useLadder.getState().prices);
  const legs: LadderLeg[] = finishLegs(view.missing).map((leg) => ({ ...leg, shape: 'even' as const }));
  const plans = legs.map((leg) => planLeg(leg, pool.facts)).filter((plan) => plan !== null);
  if (!legs.length || plans.length !== legs.length) return null;
  return { legs, costs: ladderCosts(plans, { existingArrays: new Set(pool.existingArrays), bitmapExtension: pool.bitmapExtension }) };
}

/** «Finish»: the steps that never landed, placed again from today's price in one prompt. */
export async function finish(ladder: LiveLadder, pool: LadderPoolInfo, who: Who): Promise<void> {
  const st = useLadder.getState();
  if (st.busy) return;
  const planned = finishPlan(ladder, pool);
  if (!planned) return;
  st.setBusy({ kind: 'finish', id: ladder.id });
  st.say(null);
  try {
    const { placeLadder } = await import('./ladder-sign.ts');
    const result = await placeLadder({ wallet: who.wallet, owner: who.owner, pool: ladder.pool, legs: planned.legs, shown: st.shownCosts ?? planned.costs });
    const at = Date.now();
    if (result.kind === 'costsChanged') {
      useLadder.getState().setShownCosts(result.costs);
      useLadder.getState().say({ kind: 'costsChanged', at });
      return;
    }
    if (result.kind !== 'placed') {
      useLadder.getState().say({ kind: result.kind, at });
      return;
    }
    const fresh = placedLegs(result.review, result.legs);
    useLadder.getState().update(ladder.id, (l) => ({ ...l, legs: [...l.legs.filter((leg) => leg.state !== 'failed'), ...fresh] }));
    useLadder.getState().setShownCosts(null);
    useLadder.getState().say({ kind: fresh.some((leg) => leg.state === 'failed') ? 'partly' : 'placed', at });
  } finally {
    useLadder.getState().setBusy(null);
  }
}
