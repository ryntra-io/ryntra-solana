import { useBots } from './store.ts';
import { useBotsWindow } from './open.ts';
import { composeLadder, finishLegs, LADDER_NET, useLadder, viewOf, type LadderNoteKind, type LadderPoolInfo, type LiveLadder } from './ladder.ts';
import type { LadderNetwork } from '../../../lib/bots/ladder/network.ts';
import { bandOfPlan, planLeg, type LadderLeg } from '../../../lib/bots/ladder/plan.ts';
import { ladderCosts } from '../../../lib/bots/ladder/costs.ts';
import type { LadderOrderRead, PlacedLeg } from '../../../lib/bots/ladder/orders.ts';
import type { HangarBot } from '../../../lib/bots/hangar/hangar.ts';
import type { BotDraft } from './draft.ts';
import type { Fetcher, RelayLegAnswer, ReviewAnswer, SignMany } from './ladder-sign.ts';

/**
 * The ladder's actions in the bots window — place, take back, finish — on top of the composer's store (`ladder.ts`)
 * and the window's (`store.ts`); and «Cancel» on a DLMM bot read from the chain (CITY-231). The signing module loads
 * on the tap. One action at a time; every answer ends as one short line under the action, in the window's words.
 *
 * The chain is the truth of what landed (CITY-231): a ladder is kept the moment its legs are signed, before the relay
 * is asked, with every leg `sent` and its signature; the relay answers as soon as it sends, and the window's reading
 * of the order accounts and the signatures turns each leg `confirmed` or `failed`. A cancellation marks the ladder as
 * being taken back; it is closed when the chain shows every order gone.
 *
 * Before mainnet opens (CITY-233, the overseer's review of #1571 and #1575): «Take back and rebuild» opens the new
 * ladder only once the chain shows the old one closed; «Place» first reads «My bots» for a ladder of this wallet in the
 * pool placed from another device, and offers «View» instead of a second one; a chain bot of more than one prompt's
 * orders is taken back part by part, said as «part taken back» with «Cancel the rest».
 */

export type Who = Readonly<{ wallet: string; owner: string }>;

/** The tests' and the fork pass's doors to the routes, the wallet and the network; the window's own when absent. */
export type ActionDeps = Readonly<{ fetch?: Fetcher; sign?: SignMany; now?: () => number; later?: (run: () => void, ms: number) => void; network?: LadderNetwork }>;

/** The network the window places on: the deployment's. */
const net = (): LadderNetwork => LADDER_NET ?? 'devnet';

/** How long a leg the relay sent may take to show on the chain before «not there» means it never landed. */
export const SENT_SETTLE_MS = 2 * 60_000;
/** After a send, the chain is read again this soon, so a ladder shows as placed or taken back without waiting for the half-minute. */
export const SETTLE_READS_MS: readonly number[] = [2_000, 6_000, 15_000];

const id = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `ladder-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** The placed legs from the review's transactions and the relay's answer, in order; `sentAt` — when they were handed on. */
export function placedLegs(review: ReviewAnswer, legs: readonly RelayLegAnswer[], sentAt?: number): PlacedLeg[] {
  return review.transactions.map((tx) => {
    const sent = legs.find((leg) => leg.limitOrder === tx.limitOrder);
    return { limitOrder: tx.limitOrder, side: tx.side, state: sent?.state ?? 'failed', signature: sent?.signature ?? null, rungs: tx.rungs, ...(sentAt !== undefined ? { sentAt } : {}) };
  });
}

/**
 * One leg after a reading of the chain. A `sent` leg the chain holds an account for, or whose signature it confirms,
 * landed; one whose signature failed did not; one with neither, long after it was sent, never landed.
 */
export function settleLeg(leg: PlacedLeg, read: LadderOrderRead | undefined, landed: Readonly<Record<string, 'confirmed' | 'failed'>>, settled: boolean): PlacedLeg {
  if (leg.state !== 'sent') return leg;
  const word = leg.signature ? landed[leg.signature] : undefined;
  if (word === 'failed') return { ...leg, state: 'failed' };
  if (word === 'confirmed' || (read && read.state !== 'closed')) return { ...leg, state: 'confirmed' };
  return settled && read ? { ...leg, state: 'failed' } : leg;
}

/** Refresh the reads of the wallet's placed ladders that still hold something, and the chain's word on legs still in flight. */
export async function readLive(owner: string, fetcher: Fetcher = (url, init) => fetch(url, init), network: LadderNetwork = net(), now: () => number = Date.now): Promise<void> {
  const st = useLadder.getState();
  const open = st.ladders.filter((ladder) => ladder.owner === owner && ladder.closedAt === null && ladder.network === network);
  const orders = open.flatMap((ladder) => ladder.legs.filter((leg) => leg.state !== 'failed').map((leg) => leg.limitOrder)).slice(0, 24);
  if (!orders.length) return;
  const signatures = open.flatMap((ladder) => ladder.legs.filter((leg) => leg.state === 'sent' && leg.signature).map((leg) => leg.signature!)).slice(0, 24);
  try {
    const response = await fetcher('/api/bots/ladder/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ network, owner, orders, ...(signatures.length ? { signatures } : {}) }),
      cache: 'no-store',
    });
    if (!response.ok) return;
    const body = (await response.json()) as { orders?: unknown; prices?: unknown; landed?: unknown };
    if (!Array.isArray(body.orders)) return;
    useLadder.getState().setReads(body.orders as never, (body.prices ?? {}) as Record<string, number>);
    const landed = (body.landed && typeof body.landed === 'object' ? body.landed : {}) as Record<string, 'confirmed' | 'failed'>;
    const at = now();
    for (const ladder of useLadder.getState().ladders) {
      if (ladder.owner !== owner || ladder.network !== network || ladder.closedAt !== null) continue;
      const reads = useLadder.getState().reads;
      const legs = ladder.legs.map((leg) => settleLeg(leg, reads[leg.limitOrder], landed, at - (leg.sentAt ?? ladder.placedAt) > SENT_SETTLE_MS));
      /* A ladder being taken back is closed once the chain holds none of its orders: wherever the cancellation came from. */
      const landedLegs = legs.filter((leg) => leg.state === 'confirmed');
      const gone = ladder.cancelSentAt != null && landedLegs.length > 0 && !legs.some((leg) => leg.state === 'sent') && landedLegs.every((leg) => reads[leg.limitOrder]?.state === 'closed');
      const changed = legs.some((leg, index) => leg !== ladder.legs[index]);
      if (changed || gone) useLadder.getState().update(ladder.id, (l) => ({ ...l, legs, ...(gone ? { closedAt: at } : {}) }));
      /* «Sent — checking the chain» turns into what the chain said, and only then (review 9.11). */
      const note = useLadder.getState().note;
      if (note?.kind === 'checking' && !note.bot) {
        const wasSent = ladder.legs.some((leg) => leg.state === 'sent');
        const stillSent = legs.some((leg) => leg.state === 'sent');
        if (gone) useLadder.getState().say({ kind: 'cancelled', at });
        else if (wasSent && !stillSent && ladder.cancelSentAt == null) useLadder.getState().say({ kind: legs.some((leg) => leg.state === 'failed') ? 'partly' : 'placed', at });
      }
      /* «Take back and rebuild»: the new ladder opens on this reading, the one that shows the old one closed (CITY-233). */
      if (gone) rebuildIfWaiting(ladder, at);
    }
  } catch {
    /* Not read this time: the last reading stays on screen. */
  }
}

/** How long a «Take back and rebuild» waits for the chain to show the old ladder closed; after that the rebuild is dropped. */
export const REBUILD_WAIT_MS = SENT_SETTLE_MS;

/**
 * The rebuild a «Take back and rebuild» asked for, opened once the chain shows the old ladder closed: the same settings
 * around today's price, for the person to place again. Never on the cancellation's send — until the chain says so, the
 * old orders still hold the money, and a new ladder beside them would be a second one (review 9.11).
 */
function rebuildIfWaiting(ladder: LiveLadder, at: number): void {
  const waiting = useLadder.getState().rebuild;
  if (waiting?.id !== ladder.id) return;
  useLadder.getState().setRebuild(null);
  if (at - waiting.at > REBUILD_WAIT_MS) return;
  /* The person moved on to another bot's settings meanwhile: theirs stay; the old ladder is simply taken back. */
  if (useBotsWindow.getState().tab !== 'hangar' && useBots.getState().page.kind !== 'home') return;
  useBots.getState().setDraft(ladder.draft);
  useBots.getState().go({ kind: 'detail' });
  useBotsWindow.getState().setTab('launch');
}

/** Read the chain again a few times soon after a send: the ladder settles on screen without waiting for the half-minute. */
function settleSoon(owner: string, network: LadderNetwork, deps: ActionDeps): void {
  const later = deps.later ?? ((run: () => void, ms: number) => void setTimeout(run, ms));
  for (const ms of SETTLE_READS_MS) later(() => void readLive(owner, deps.fetch, network, deps.now), ms);
}

/** A ladder of this wallet whose legs are still in flight on this network: the chain has not said yet whether they landed. */
export const inFlight = (ladders: readonly LiveLadder[], owner: string, network: LadderNetwork, at: number): LiveLadder | null =>
  ladders.find((ladder) => ladder.owner === owner && ladder.network === network && ladder.closedAt === null && ladder.legs.some((leg) => leg.state === 'sent' && at - (leg.sentAt ?? ladder.placedAt) <= SENT_SETTLE_MS)) ?? null;

/** «Place»: the draft's ladder, one wallet prompt, on the window's network. */
export async function placeDraft(draft: BotDraft, pool: LadderPoolInfo, who: Who, solUsd: number | null, deps: ActionDeps = {}): Promise<void> {
  const st = useLadder.getState();
  if (st.busy) return;
  const composed = composeLadder(draft, pool, solUsd);
  if (!composed || composed.issues.length || !composed.costs) return;
  if (composed.overCap) {
    st.say({ kind: 'overCap', at: Date.now() });
    return;
  }
  const network = deps.network ?? net();
  const now = deps.now ?? Date.now;
  /* The last ladder is still on its way to the chain: one more tap would place a second one. */
  if (inFlight(st.ladders, who.owner, network, now())) {
    st.say({ kind: 'checking', at: now() });
    useBots.getState().go({ kind: 'home' });
    useBotsWindow.getState().setTab('hangar');
    return;
  }
  st.setBusy({ kind: 'check', id: null });
  st.say(null);
  /* The ladder this tap keeps once everything is signed (a holder: it is set inside the signing call). */
  const kept: { id: string | null } = { id: null };
  try {
    /* This browser sees only its own ladders: the chain is asked for one of this wallet's placed from anywhere else. */
    const there = await ladderElsewhere(who.owner, pool.facts.pool, network, deps);
    if (there.length) {
      useLadder.getState().setElsewhere({ pool: pool.facts.pool, orders: there });
      useLadder.getState().say({ kind: 'elsewhere', at: now() });
      return;
    }
    useLadder.getState().setBusy({ kind: 'place', id: null });
    const { placeLadder } = await import('./ladder-sign.ts');
    const result = await placeLadder(
      { wallet: who.wallet, owner: who.owner, pool: pool.facts.pool, legs: composed.legs, shown: st.shownCosts ?? composed.costs, network },
      {
        fetch: deps.fetch,
        sign: deps.sign,
        /* Every leg is signed: the ladder is this window's now, before the relay is asked. */
        onSigned: (review, legs) => {
          const at = now();
          const ladder: LiveLadder = {
            id: id(),
            network,
            owner: who.owner,
            pool: pool.facts.pool,
            baseIsX: pool.facts.baseIsX,
            draft,
            band: review.plans[0] ? bandOfPlan(review.plans[0]) : null,
            legs: placedLegs(review, legs, at),
            placedAt: at,
            closedAt: null,
          };
          kept.id = ladder.id;
          useLadder.getState().add(ladder);
        },
      },
    );
    const at = now();
    if (result.kind === 'costsChanged') {
      useLadder.getState().setShownCosts(result.costs);
      useLadder.getState().say({ kind: 'costsChanged', at });
      return;
    }
    if (result.kind === 'placed' || result.kind === 'unsure') {
      const legs = placedLegs(result.review, result.legs, at);
      if (kept.id) useLadder.getState().update(kept.id, (l) => ({ ...l, legs }));
      useLadder.getState().setShownCosts(null);
      useLadder.getState().say({ kind: result.kind === 'unsure' || legs.some((leg) => leg.state === 'sent') ? 'checking' : legs.some((leg) => leg.state === 'failed') ? 'partly' : 'placed', at });
      useBots.getState().go({ kind: 'home' });
      useBotsWindow.getState().setTab('hangar');
      settleSoon(who.owner, network, deps);
      return;
    }
    /* Stopped before anything was sent: the ladder kept a moment ago never existed. */
    if (kept.id) useLadder.getState().remove(kept.id);
    useLadder.getState().say({ kind: result.kind === 'refused' && result.reason === 'OVER_LIMIT' ? 'overCap' : result.kind, at, ...(result.kind === 'refused' || result.kind === 'walletNo' ? { reason: result.reason } : {}) });
  } finally {
    useLadder.getState().setBusy(null);
  }
}

/** «My bots» is read again before «Place» when its last reading is older than this: a ladder from elsewhere is a minute old at most. */
export const CHAIN_RECHECK_MS = 20_000;

/**
 * This wallet's orders in the pool that the chain still holds working and this browser placed no ladder for — a ladder
 * placed from another device, the app, or a browser that forgot it (CITY-233). Read from «My bots» (the Hangar, read
 * again when stale) and confirmed order by order through the orders route. Only on mainnet, the network «My bots»
 * reads; orders the person already looked at («View») count no more. Nothing read — nothing found: the check never
 * stands between the person and «Place» on a read that failed.
 */
export async function ladderElsewhere(owner: string, pool: string, network: LadderNetwork, deps: ActionDeps = {}): Promise<string[]> {
  if (network !== CHAIN_NETWORK) return [];
  const now = deps.now ?? Date.now;
  const read = () => {
    const chain = useBots.getState().chain;
    return chain.status === 'ready' && chain.wallet === owner ? chain.answer : null;
  };
  let answer = read();
  if (!answer || now() - answer.at > CHAIN_RECHECK_MS) {
    await useBots.getState().loadChain(owner, true);
    answer = read();
  }
  if (!answer) return [];
  const st = useLadder.getState();
  const known = new Set(st.ladders.filter((ladder) => ladder.owner === owner && ladder.network === network).flatMap((ladder) => ladder.legs.map((leg) => leg.limitOrder)));
  const orders = [
    ...new Set(
      answer.bots
        .filter((bot) => bot.venue === 'meteora_dlmm' && (bot.kind === 'limit' || bot.kind === 'ladder') && bot.status !== 'closed' && (!bot.refs.pool || bot.refs.pool === pool))
        .flatMap((bot) => bot.refs.orders ?? []),
    ),
  ]
    .filter((order) => !known.has(order) && !st.seen.has(order))
    .slice(0, 24);
  if (!orders.length) return [];
  const fetcher = deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  try {
    const response = await fetcher('/api/bots/ladder/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ network, owner, orders }), cache: 'no-store' });
    if (!response.ok) return [];
    const body = (await response.json().catch(() => null)) as { orders?: LadderOrderRead[] } | null;
    if (!Array.isArray(body?.orders)) return [];
    return body.orders.filter((order) => (order.state === 'open' || order.state === 'partial') && order.pool === pool).map((order) => order.limitOrder);
  } catch {
    return [];
  }
}

/**
 * «View» in place of «Place»: «My bots», where the ladder from elsewhere stands with its own «Cancel». The settings
 * being composed stay where they are; once the person has looked, «Place» beside that ladder is their choice.
 */
export function viewElsewhere(): void {
  const st = useLadder.getState();
  if (st.elsewhere) st.acknowledge(st.elsewhere.orders);
  st.setElsewhere(null);
  st.say(null);
  useBotsWindow.getState().setTab('hangar');
}

/**
 * «Cancel orders» and every exit proposal's first step: whatever the ladder's order accounts hold comes back in one
 * prompt. A rebuild then opens the same settings around the price now, for the person to place again — once the chain
 * shows the old ladder closed, not on the cancellation's send (CITY-233).
 */
export async function takeBack(ladder: LiveLadder, who: Who, then: 'none' | 'rebuild' = 'none', deps: ActionDeps = {}): Promise<void> {
  const st = useLadder.getState();
  if (st.busy) return;
  const view = viewOf(ladder, st.reads, st.prices);
  if (!view.holding.length) return;
  st.setBusy({ kind: 'cancel', id: ladder.id });
  st.say(null);
  try {
    const { cancelLadderOrders } = await import('./ladder-sign.ts');
    const result = await cancelLadderOrders({ wallet: who.wallet, owner: who.owner, orders: view.holding, network: ladder.network }, { fetch: deps.fetch, sign: deps.sign });
    const at = (deps.now ?? Date.now)();
    if (result.kind !== 'cancelled' && result.kind !== 'unsure') {
      useLadder.getState().say({ kind: result.kind, at, ...(result.kind === 'refused' || result.kind === 'walletNo' ? { reason: result.reason } : {}) });
      return;
    }
    const all = result.legs.every((leg) => leg.state !== 'failed');
    // Taken back once the chain shows every account gone — a half-landed ladder included («or cancel»); the reading closes it.
    if (all) useLadder.getState().update(ladder.id, (l) => ({ ...l, cancelSentAt: at }));
    /* The rebuild waits for the chain: the reading that shows the old ladder closed opens it (`readLive`). A plain
       cancellation of the same ladder drops a rebuild asked before it. */
    if (then === 'rebuild' && all) useLadder.getState().setRebuild({ id: ladder.id, at });
    else if (useLadder.getState().rebuild?.id === ladder.id) useLadder.getState().setRebuild(null);
    /* A cancellation the network refused in part: the rest waits for one more tap — not «finish or cancel». */
    useLadder.getState().say({ kind: !all ? 'rest' : result.kind === 'unsure' || result.legs.some((leg) => leg.state === 'sent') ? 'checking' : 'cancelled', at });
    await readLive(who.owner, deps.fetch, ladder.network, deps.now);
    settleSoon(who.owner, ladder.network, deps);
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
  return { legs, costs: ladderCosts(plans, { existingArrays: new Set(pool.existingArrays), bitmapExtension: pool.bitmapExtension }, pool.terms) };
}

/** «Finish»: the steps that never landed, placed again from today's price in one prompt. */
export async function finish(ladder: LiveLadder, pool: LadderPoolInfo, who: Who, deps: ActionDeps = {}): Promise<void> {
  const st = useLadder.getState();
  if (st.busy) return;
  const planned = finishPlan(ladder, pool);
  if (!planned) return;
  st.setBusy({ kind: 'finish', id: ladder.id });
  st.say(null);
  const now = deps.now ?? Date.now;
  let fresh: PlacedLeg[] = [];
  try {
    const { placeLadder } = await import('./ladder-sign.ts');
    const result = await placeLadder(
      { wallet: who.wallet, owner: who.owner, pool: ladder.pool, legs: planned.legs, shown: st.shownCosts ?? planned.costs, network: ladder.network },
      {
        fetch: deps.fetch,
        sign: deps.sign,
        /* The new legs join the ladder the moment they are signed, the ones that never landed leave it. */
        onSigned: (review, legs) => {
          fresh = placedLegs(review, legs, now());
          useLadder.getState().update(ladder.id, (l) => ({ ...l, legs: [...l.legs.filter((leg) => leg.state !== 'failed'), ...fresh] }));
        },
      },
    );
    const at = now();
    if (result.kind === 'costsChanged') {
      useLadder.getState().setShownCosts(result.costs);
      useLadder.getState().say({ kind: 'costsChanged', at });
      return;
    }
    if (result.kind !== 'placed' && result.kind !== 'unsure') {
      /* Nothing was sent: the ladder is as it was, its missing legs still there to finish. */
      if (fresh.length) {
        const orders = new Set(fresh.map((leg) => leg.limitOrder));
        useLadder.getState().update(ladder.id, (l) => ({ ...l, legs: [...l.legs.filter((leg) => !orders.has(leg.limitOrder)), ...ladder.legs.filter((leg) => leg.state === 'failed')] }));
      }
      useLadder.getState().say({ kind: result.kind, at });
      return;
    }
    const answered = placedLegs(result.review, result.legs, at);
    const orders = new Set(answered.map((leg) => leg.limitOrder));
    useLadder.getState().update(ladder.id, (l) => ({ ...l, legs: [...l.legs.filter((leg) => !orders.has(leg.limitOrder)), ...answered] }));
    useLadder.getState().setShownCosts(null);
    useLadder.getState().say({ kind: result.kind === 'unsure' || answered.some((leg) => leg.state === 'sent') ? 'checking' : answered.some((leg) => leg.state === 'failed') ? 'partly' : 'placed', at });
    settleSoon(who.owner, ladder.network, deps);
  } finally {
    useLadder.getState().setBusy(null);
  }
}

/* ------------------------------------------------------- «My bots» on the chain */

/** The network the Hangar reads the wallet's orders on: mainnet, the network people's money is on. */
export const CHAIN_NETWORK: LadderNetwork = 'mainnet';
/** One prompt takes back at most this many orders (the cancel route's bound); the rest stay for the next tap. */
export const CANCEL_AT_ONCE = 8;

/**
 * Whether a bot read from the chain takes «Cancel» here: a DLMM limit order or ladder of the wallet's that still holds
 * something, while the window's ladder lives on mainnet (its routes, and their `CLOSING` rollback, take it back).
 */
export function chainCancellable(bot: Pick<HangarBot, 'venue' | 'kind' | 'status' | 'refs'>, network: LadderNetwork | null = LADDER_NET): boolean {
  return network === CHAIN_NETWORK && bot.venue === 'meteora_dlmm' && (bot.kind === 'limit' || bot.kind === 'ladder') && bot.status !== 'closed' && Boolean(bot.refs.orders?.length);
}

/**
 * «Cancel» on a DLMM bot read from the chain (CITY-231): the same cancellation as a ladder's, built from the bot's own
 * order accounts — nothing kept in this browser is needed, so it works from the app, from another device and after
 * the browser forgot everything. The orders are read first, and only those still on the chain are taken back, at most
 * eight in one prompt; everything they hold comes back to the wallet, the rent too.
 *
 * More than eight, or a leg the network refused (CITY-233): part comes back, the bot says «part taken back» and its
 * action reads «Cancel the rest» — there is no «Finish» on a chain bot. An order whose cancellation was just sent is
 * not built again while the chain catches up.
 */
export async function cancelChainBot(bot: Pick<HangarBot, 'id' | 'venue' | 'kind' | 'status' | 'refs'>, who: Who, deps: ActionDeps = {}): Promise<void> {
  const st = useLadder.getState();
  if (st.busy || !chainCancellable(bot, CHAIN_NETWORK)) return;
  const fetcher = deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const now = deps.now ?? Date.now;
  const network = CHAIN_NETWORK;
  st.setBusy({ kind: 'cancel', id: bot.id });
  st.say(null);
  const say = (kind: LadderNoteKind, reason?: string) => useLadder.getState().say({ kind, at: now(), bot: bot.id, ...(reason ? { reason } : {}) });
  try {
    const asked = [...new Set(bot.refs.orders ?? [])].slice(0, 24);
    let holding: string[];
    try {
      const response = await fetcher('/api/bots/ladder/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ network, owner: who.owner, orders: asked }), cache: 'no-store' });
      const body = (await response.json().catch(() => null)) as { orders?: LadderOrderRead[] } | null;
      if (!response.ok || !Array.isArray(body?.orders)) return say(response.ok || response.status >= 500 ? 'unreachable' : 'refused');
      holding = body.orders.filter((read) => read.state !== 'closed').map((read) => read.limitOrder);
    } catch {
      return say('unreachable');
    }
    if (!holding.length) {
      useLadder.getState().setRest(bot.id, false);
      say('cancelled');
      void useBots.getState().loadChain(who.owner, true);
      return;
    }
    const sentAt = useLadder.getState().cancelSent;
    const todo = holding.filter((order) => !(order in sentAt && now() - sentAt[order]! <= SENT_SETTLE_MS));
    /* Every order still there is already being taken back: the chain has not caught up yet. */
    if (!todo.length) return say('checking');
    const take = todo.slice(0, CANCEL_AT_ONCE);
    const { cancelLadderOrders } = await import('./ladder-sign.ts');
    const result = await cancelLadderOrders({ wallet: who.wallet, owner: who.owner, orders: take, network }, { fetch: deps.fetch, sign: deps.sign });
    if (result.kind !== 'cancelled' && result.kind !== 'unsure') return say(result.kind, result.kind === 'refused' || result.kind === 'walletNo' ? result.reason : undefined);
    const sent = result.legs.filter((leg) => leg.state !== 'failed').map((leg) => leg.limitOrder);
    useLadder.getState().markCancelSent(sent, now());
    const rest = todo.length > take.length || sent.length < take.length;
    useLadder.getState().setRest(bot.id, rest);
    say(rest ? 'rest' : result.kind === 'unsure' || result.legs.some((leg) => leg.state === 'sent') ? 'checking' : 'cancelled');
    /* The Hangar reads the chain again soon: the bot leaves «My bots» once its orders are gone. */
    const later = deps.later ?? ((run: () => void, ms: number) => void setTimeout(run, ms));
    for (const ms of SETTLE_READS_MS) later(() => void useBots.getState().loadChain(who.owner, true), ms);
  } finally {
    useLadder.getState().setBusy(null);
  }
}
