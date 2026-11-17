import { create } from 'zustand';
import type { DollarAsset, DollarSide } from '../../city/lib/earn/dollar.ts';
import { useDollar } from '../../city/lib/earn/dollar-store.ts';
import type { LstId } from '../../city/lib/earn/lst.ts';
import { useEarn } from '../../city/lib/earn/open.ts';
import { usePier } from '../../city/lib/earn/pier-store.ts';
import type { PierMode } from '../../city/lib/earn/pier-gate.ts';
import { useProPier } from '../../city/lib/earn/pro-store.ts';
import { useSaver } from '../../city/lib/earn/saver-store.ts';
import { useEarnData } from '../../city/lib/earn/store.ts';
import type { PoolRow, StakeRow } from './rows.ts';
import type { EarnFigures } from './useReads.ts';

/**
 * The screen's ticket: the one thing the person acts on — a pool to add to, a staked SOL coin to buy, the lending
 * market, or one of their positions. Each kind is one of the city's own stores as it stands (the pool's flow, the Pro
 * pool's, staking's, lending's); this file only says which of them is in front, and puts it there.
 *
 * While a signature is out — the wallet is open or the bytes are on their way — the ticket stays where it is: the
 * city's stores say so (`useEarn().busy`), and nothing here moves it.
 */

/** What a pool position's ticket does: take the fees, or leave. */
export type PoolAct = 'claim' | 'exit';
/** What a Pro position's ticket does. */
export type ProAct = 'collect' | 'compound' | 'leave' | 'close';

export type Ticket =
  | Readonly<{ kind: 'pool'; address: string }>
  | Readonly<{ kind: 'pro'; address: string }>
  | Readonly<{ kind: 'stake'; lst: LstId }>
  | Readonly<{ kind: 'lend'; asset: DollarAsset }>
  | Readonly<{ kind: 'position'; address: string; act: PoolAct }>
  | Readonly<{ kind: 'proPosition'; nftMint: string; act: ProAct }>
  /** A pool shown to compare: its figures and its page; nothing is added from here. */
  | Readonly<{ kind: 'view'; address: string }>;

type TicketState = {
  /** What the person picked; null — the screen's first offer stands in front. */
  picked: Ticket | null;
  /** On a phone the ticket is a sheet from the bottom: open only once something was picked. */
  sheet: boolean;
};

export const useTicket = create<TicketState>(() => ({ picked: null, sheet: false }));

/** One ticket and another are the same thing in front (a position's two actions are one ticket). */
export function sameTicket(a: Ticket | null, b: Ticket | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind === 'pool' && b.kind === 'pool') return a.address === b.address;
  if (a.kind === 'pro' && b.kind === 'pro') return a.address === b.address;
  if (a.kind === 'stake' && b.kind === 'stake') return a.lst === b.lst;
  if (a.kind === 'lend' && b.kind === 'lend') return a.asset === b.asset;
  if (a.kind === 'position' && b.kind === 'position') return a.address === b.address;
  if (a.kind === 'proPosition' && b.kind === 'proPosition') return a.nftMint === b.nftMint;
  if (a.kind === 'view' && b.kind === 'view') return a.address === b.address;
  return false;
}

/** Whether a wallet may add to the city's pools here: the city's own switch — closed, one wallet, or everyone. */
export function mayAdd(mode: PierMode, admitted: boolean): boolean {
  return mode === 'open' || (mode === 'canary' && admitted);
}

/**
 * The screen's first offer, before the person picks: the first pool that takes a deposit, else the first staked SOL
 * coin, else lending — whatever is open here. Null when nothing is.
 */
export function firstOffer(offer: Readonly<{ pools: readonly PoolRow[]; addOpen: boolean; stakes: readonly StakeRow[]; lendOpen: boolean }>): Ticket | null {
  const pool = offer.pools.find((row) => row.takes && (row.kind === 'pro' || offer.addOpen));
  if (pool) return pool.kind === 'pro' ? { kind: 'pro', address: pool.address } : { kind: 'pool', address: pool.address };
  const stake = offer.stakes[0];
  if (stake) return { kind: 'stake', lst: stake.lst.id };
  return offer.lendOpen ? { kind: 'lend', asset: 'USDC' } : null;
}

/**
 * Whether the ticket holds where it is: a signature is out somewhere in Earn, or an action landed only in part — its card
 * keeps what is left to do («Take back as SOL», «OK»), and nothing may open over it and wipe that. An action without an
 * answer yet holds nothing: its card keeps «Check» in front, and the person may move on, as the city's window lets them.
 */
export function heldNow(state: Readonly<{ busy: boolean; pool: string | null; pro: string | null }>): boolean {
  return state.busy || state.pool === 'partial' || state.pro === 'partial';
}

/** What each store has under way, as the screen reads it. */
export type UnderWay = Readonly<{
  pier: Readonly<{ pool: string | null; boat: string | null; locked: boolean; outcome: string | null; act: string | null }>;
  pro: Readonly<{ pier: string | null; boat: string | null; locked: boolean; outcome: string | null; act: string | null }>;
  saver: Readonly<{ busy: boolean; lst: LstId }>;
  dollar: Readonly<{ busy: boolean; asset: DollarAsset }>;
}>;

const PRO_ACTS: ReadonlySet<string> = new Set(['collect', 'compound', 'leave', 'close']);

/**
 * The thing an action is under way on — the wallet open, the bytes on their way, or a part landed and not read — which
 * stands in front whatever was picked or offered: a refresh of the lists, a pick elsewhere or a move of the first offer
 * never takes the card of a signature in progress, nor its outcome, from in front of the person. Null when nothing is.
 */
export function underWay(state: UnderWay): Ticket | null {
  const { pier, pro, saver, dollar } = state;
  if (pier.locked || pier.outcome === 'partial') {
    if (pier.boat) return { kind: 'position', address: pier.boat, act: pier.act === 'exit' ? 'exit' : 'claim' };
    if (pier.pool) return { kind: 'pool', address: pier.pool };
  }
  if (pro.locked || pro.outcome === 'partial') {
    if (pro.boat) return { kind: 'proPosition', nftMint: pro.boat, act: pro.act && PRO_ACTS.has(pro.act) ? (pro.act as ProAct) : 'collect' };
    if (pro.pier) return { kind: 'pro', address: pro.pier };
  }
  if (saver.busy) return { kind: 'stake', lst: saver.lst };
  if (dollar.busy) return { kind: 'lend', asset: dollar.asset };
  return null;
}

/**
 * With nothing picked, the pool whose form the store already holds stays in front while it is still listed or carries an
 * outcome: the first offer is placed once and does not drift when a refresh reorders the pools. Null — none is held.
 */
export function heldForm(state: Pick<UnderWay, 'pier' | 'pro'>, listed: (kind: 'pool' | 'pro', address: string) => boolean): Ticket | null {
  if (state.pier.pool && !state.pier.boat && (listed('pool', state.pier.pool) || state.pier.outcome)) return { kind: 'pool', address: state.pier.pool };
  if (state.pro.pier && !state.pro.boat && (listed('pro', state.pro.pier) || state.pro.outcome)) return { kind: 'pro', address: state.pro.pier };
  return null;
}

export function ticketHeld(): boolean {
  return heldNow({ busy: useEarn.getState().busy, pool: usePier.getState().outcome?.kind ?? null, pro: useProPier.getState().outcome?.kind ?? null });
}

/** The same, for a component: it repaints when it changes. */
export function useTicketHeld(): boolean {
  const busy = useEarn((st) => st.busy);
  const pool = usePier((st) => st.outcome?.kind ?? null);
  const pro = useProPier((st) => st.outcome?.kind ?? null);
  return heldNow({ busy, pool, pro });
}

/** A finished outcome — done, or failed with only the network's fee spent — may give way to a fresh form. */
const FINISHED = new Set(['done', 'failed']);

/**
 * Puts a ticket in front in its own store — the pool on the pool's flow, the position on its own — exactly as a tap in
 * the city's window does. False when it could not: a signature is out, or the thing is no longer in what was read.
 */
export function place(ticket: Ticket): boolean {
  if (ticketHeld()) return false;
  switch (ticket.kind) {
    case 'view':
      // No store: the card reads the chooser's own rows.
      return true;
    case 'pool': {
      const list = useEarnData.getState().piers;
      const pool = list.status === 'ready' ? list.value.pools.find((entry) => entry.address === ticket.address) : undefined;
      if (!pool) return false;
      settlePier();
      const pier = usePier.getState();
      if (pier.pool?.address !== pool.address || (pier.outcome && FINISHED.has(pier.outcome.kind))) pier.openPier(pool);
      return usePier.getState().pool?.address === pool.address;
    }
    case 'pro': {
      const list = useProPier.getState().list;
      const pier = list.status === 'ready' ? list.value.piers.find((entry) => entry.address === ticket.address) : undefined;
      if (!pier) return false;
      settlePro();
      const pro = useProPier.getState();
      if (pro.pier?.address !== pier.address || (pro.outcome && FINISHED.has(pro.outcome.kind))) pro.openPier(pier);
      return useProPier.getState().pier?.address === pier.address;
    }
    case 'stake': {
      // A purchase that landed, or failed with only the network's fee spent, is done with once another coin is asked for;
      // the same coin keeps its result on screen until the person reads it.
      const saver = useSaver.getState();
      if ((saver.phase === 'done' || saver.phase === 'failed') && saver.lst !== ticket.lst) saver.again();
      return chooseLst(ticket.lst);
    }
    case 'lend': {
      if (useDollar.getState().phase === 'done') useDollar.getState().again();
      if (useDollar.getState().asset !== ticket.asset) useDollar.getState().setAsset(ticket.asset);
      return useDollar.getState().asset === ticket.asset;
    }
    case 'position': {
      const positions = useEarnData.getState().positions;
      const view = positions?.value.status === 'ready' ? positions.value.value.find((entry) => entry.address === ticket.address) : undefined;
      if (!view) return false;
      // Opened afresh each time: another action of the same position starts from its own figures, not the last one's.
      settlePier();
      usePier.getState().openBoat(view);
      return usePier.getState().boat?.address === view.address;
    }
    case 'proPosition': {
      const boats = useProPier.getState().boats;
      const boat = boats?.value.status === 'ready' ? boats.value.value.find((entry) => entry.nftMint === ticket.nftMint) : undefined;
      if (!boat) return false;
      settlePro();
      useProPier.getState().openBoat(boat);
      return useProPier.getState().boat?.nftMint === boat.nftMint;
    }
  }
}

/**
 * A Review still being built for what was in front is let go — the stores refuse to open another thing over one, and in
 * the city's window nothing else can be tapped meanwhile; here the table stays in reach. Nothing is signed at that
 * point: a signature out holds the ticket before this is ever asked (`ticketHeld`).
 */
function settlePier(): void {
  if (usePier.getState().phase === 'reviewing') usePier.getState().back();
}

function settlePro(): void {
  if (useProPier.getState().phase === 'reviewing') useProPier.getState().back();
}

/** A coin asked for while an order is being built: it follows once the build is over. */
let stopWaiting: (() => void) | null = null;

/**
 * The staked coin in front. The store takes another coin only while nothing is under way; an order being built — the
 * screen's own, or a press that rebuilds aged bytes on its way to the wallet — is never cut short: the coin follows once
 * it is over, if nothing went to the wallet meanwhile.
 */
function chooseLst(lst: LstId): boolean {
  stopWaiting?.();
  stopWaiting = null;
  const saver = useSaver.getState();
  if (saver.lst === lst) return true;
  if (saver.phase === 'idle') {
    saver.setLst(lst);
    return useSaver.getState().lst === lst;
  }
  if (saver.phase !== 'preparing') return false;
  const off = useSaver.subscribe((st) => {
    if (st.phase === 'preparing') return;
    off();
    stopWaiting = null;
    if (st.phase === 'idle') {
      st.setLst(lst);
      return;
    }
    // The build went on to the wallet: the purchase in front is the coin it is for, and its result shows there.
    const picked = useTicket.getState().picked;
    if (picked?.kind === 'stake' && picked.lst === lst) useTicket.setState({ picked: { kind: 'stake', lst: st.lst } });
  });
  stopWaiting = off;
  return true;
}

/** The person picked something: it goes in front, and on a phone its sheet opens. */
export function pick(ticket: Ticket): boolean {
  if (!place(ticket)) return false;
  useTicket.setState({ picked: ticket, sheet: true });
  return true;
}

/** Lending with the side said — «put in» or «take back» — and, when said, the amount. */
export function pickLending(asset: DollarAsset, side: DollarSide): boolean {
  if (!pick({ kind: 'lend', asset })) return false;
  if (useDollar.getState().side !== side) useDollar.getState().setSide(side);
  return true;
}

/** The phone's sheet put away; the ticket itself stays as it was. Never while a signature is out. */
export function closeSheet(): boolean {
  if (ticketHeld()) return false;
  useTicket.setState({ sheet: false });
  return true;
}

/** One name for a ticket, so an effect can tell when the thing in front changed. */
export function ticketKey(ticket: Ticket | null): string | null {
  if (!ticket) return null;
  switch (ticket.kind) {
    case 'pool':
    case 'pro':
    case 'view':
      return `${ticket.kind}:${ticket.address}`;
    case 'stake':
      return `stake:${ticket.lst}`;
    case 'lend':
      return `lend:${ticket.asset}`;
    case 'position':
      return `position:${ticket.address}`;
    case 'proPosition':
      return `proPosition:${ticket.nftMint}`;
  }
}

/**
 * Whether a picked ticket still stands on something that was read: a pool of the list, a staked coin, the lending
 * market, a position of this wallet — or a position whose action just ended and whose result is still being read.
 */
export function ticketStands(
  ticket: Ticket,
  figures: Pick<EarnFigures, 'pools' | 'lendRate' | 'lent' | 'views' | 'proBoats'>,
  kept: Readonly<{ boat: string | null; proBoat: string | null; pool?: string | null; proPool?: string | null }>,
  shown: (address: string) => boolean = () => false,
): boolean {
  switch (ticket.kind) {
    case 'view':
      return shown(ticket.address);
    case 'pool':
      return figures.pools.some((row) => row.kind === 'pool' && row.address === ticket.address) || kept.pool === ticket.address;
    case 'pro':
      return figures.pools.some((row) => row.kind === 'pro' && row.address === ticket.address) || kept.proPool === ticket.address;
    case 'stake':
      return true;
    case 'lend':
      return figures.lendRate !== null || figures.lent.some((position) => position.asset === ticket.asset);
    case 'position':
      return figures.views.some((view) => view.address === ticket.address) || kept.boat === ticket.address;
    case 'proPosition':
      return figures.proBoats.some((boat) => boat.nftMint === ticket.nftMint) || kept.proBoat === ticket.nftMint;
  }
}
