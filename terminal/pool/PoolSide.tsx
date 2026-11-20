'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EARN_OPEN } from '@/city/lib/earn/flag';
import { useEarn } from '@/city/lib/earn/open';
import { LST_BY_MINT, SOL_MINT } from '@/city/lib/earn/lst';
import { USDC_MINT, pierOf } from '@/city/lib/earn/pier';
import { PIER_MODE } from '@/city/lib/earn/pier-gate';
import { PIER_BUSY, usePier } from '@/city/lib/earn/pier-store';
import { proKnown, proOffered } from '@/city/lib/earn/pro';
import { PRO_BUSY, useProPier } from '@/city/lib/earn/pro-store';
import { useEarnData } from '@/city/lib/earn/store';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { LADDER_BUSY, LADDER_OPEN, useLadder } from '@/city/lib/trade/pro-store';
import { useTrade, type TowerRef } from '@/city/lib/trade/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { pairOf, tickerOf, type ProPoolRow } from '@/lib/pro-pools/model';
import { LadderTicket } from '@/terminal/coin/ladder/LadderTicket';
import { setLimitTab, useLadderHere, useLimitTab } from '@/terminal/coin/ladder/here';
import { Ticket } from '@/terminal/coin/Ticket';
import { OneLine } from '@/terminal/earn/bits';
import { PoolTicket } from '@/terminal/earn/PoolTicket';
import { ProTicket } from '@/terminal/earn/ProTicket';
import { poolRows, proPoolRows, venueSolUsd } from '@/terminal/earn/rows';
import { mayAdd, place, ticketHeld, useTicketHeld } from '@/terminal/earn/ticket';
import { openPanel } from '@/terminal/shell/frame';
import { partOf, useAddressTail, useTabInAddress } from '@/terminal/shell/address';
import { NARROW } from '@/terminal/shell/useNarrow';
import { connectWallet } from '@/terminal/shell/Wallet';
import { StockPoolFacts } from '@/terminal/stocks/StockPoolFacts';
import { Action, Icon, Info, Panel, Quiet, QuietLink, Tabs, cx } from '@/terminal/ui';
import { proOffer, ticketTabs, type DeskPool, type TicketTab } from './desk-pool';
import { pctOfBps } from './pool-view';
import type { Read } from './usePro';
import { POOL } from './words';
import s from '@/terminal/coin/ticket.module.css';
import p from './pool.module.css';

/** A wallet is asked for where the person reads it: on a phone the frame's own sheet comes forward first. */
function connect(): void {
  if (window.matchMedia(NARROW).matches) openPanel('sheet');
  connectWallet();
}

/**
 * Whether a position opens in a pool from here: its form (`open`), not known yet (`waiting`), or none (`none`) — then
 * the ticket has no Position tab at all (the QA of 19.11: on ~75 of 80 pools the tab said «Positions here —
 * coming» over an empty column, and on MET/SOL it sent the person to a pool with $0 in it). A DLMM Pro pool where the
 * engine serves it and the terminal offers it (`proOffer` — the city's own pools; any pool once its switch is open), a
 * DLMM pool Earn adds to (SOL against USDC or a staked SOL). Read only: nothing here opens anything.
 */
export type PositionWay = 'open' | 'waiting' | 'none';

export function usePositionWay(pool: DeskPool): PositionWay {
  const proList = useProPier((st) => st.list);
  const harbor = useHarborPool(pool);
  const harborList = useEarnData((st) => st.piers);
  useEffect(() => {
    if (pool.venue === 'pro') void useProPier.getState().loadPiers();
  }, [pool.venue]);
  if (pool.venue === 'pro') {
    if (!pool.pro) return 'none';
    if (proList.status === 'idle' || proList.status === 'loading') return 'waiting';
    if (proList.status !== 'ready') return 'none';
    const served = proList.value.piers.find((pier) => pier.address === pool.address) ?? null;
    return proOffer(pool.pro, served !== null, served !== null && proOffered(served, proList.value.network)) === 'ticket' ? 'open' : 'none';
  }
  if (harbor) return 'open';
  // A DLMM pool of SOL against USDC or a staked SOL may be one Earn adds to: not known until Earn's pools are read.
  const harborLike = pool.venue === 'dlmm' && harborPair(pool);
  return harborLike && EARN_OPEN && (harborList.status === 'idle' || harborList.status === 'loading') ? 'waiting' : 'none';
}

/** SOL against USDC or a staked SOL — the pairs Earn's own pools are made of (`pierOf`). */
function harborPair(pool: Pick<DeskPool, 'x' | 'y'>): boolean {
  const xSol = pool.x.mint === SOL_MINT;
  if (xSol === (pool.y.mint === SOL_MINT)) return false;
  const other = xSol ? pool.y.mint : pool.x.mint;
  return other === USDC_MINT || LST_BY_MINT.has(other);
}

/**
 * The pool's ticket, as Meteora lays one beside a pool (Create Position · Limit Order · Swap), on the right
 * of its page: its tabs on top.
 *
 * - **Position** — only where a position opens here (`usePositionWay`): the pool's own form of Earn, DLMM Pro's
 *   (`earn/ProTicket.tsx` — the goals, the person's own shape, an amount in SOL) or DLMM's (`earn/PoolTicket.tsx`); in a
 *   pool of a volatile pair one line says so before the signature. Elsewhere the tab is not there: the
 *   ticket opens on its limits or its swap.
 * - **Limit** — DLMM Pro's own: a limit order resting on one exact price that earns a share of the pool's fee, on the
 *   coin's ladders (`coin/ladder/LadderTicket.tsx`), the bonus over it. Only where the pool is DLMM Pro; where the
 *   coin's ladders rest in another of its pools, the card over them names that pool and its own bonus.
 * - **Swap** — a market buy or sale of the coin, the Spot's own ticket.
 *
 * The tab is the address's `?tab=`: from Earn a pool opens on its position, from the Spot or the DLMM Pro list on its
 * limits. Nothing here signs by itself; each tab is its own flow, unchanged.
 */
export function PoolSide({ pool, coin, usd, pro, onOrders, foot, trade, phone = false }: { pool: DeskPool; coin: TowerRef; usd: number | null; pro: Read<readonly ProPoolRow[]>; onOrders: () => void; foot?: ReactNode; trade: boolean; phone?: boolean }) {
  const w = useWords(POOL);
  const ladderOn = LADDER_OPEN && pool.venue === 'pro';
  const ladder = useLadderHere(ladderOn ? { mint: coin.mint, symbol: coin.symbol } : null);
  // The coin has no pool for a ladder, or its market did not read: no Limit tab. While its market is read the tab stands.
  const noLadder = useLadder((st) => st.mint === coin.mint && (st.market.status === 'failed' || (st.market.status === 'ready' && !st.market.value)));
  const harbor = useHarborPool(pool);
  const way = usePositionWay(pool);
  const named = partOf(useAddressTail(), 'tab');
  // A pool that holds nothing yet opens on its first position, not on limits nothing would fill.
  const empty = pool.tvlUsd === 0;
  // While it is not known whether a position opens here, the Position tab stands only where the page would open on it —
  // a pool Earn may add to, a pool that holds nothing, an address that names it — as a waiting box, never a swap a
  // person starts typing in that then jumps away; elsewhere it comes only once it is known to open.
  const adds = way === 'open' || (way === 'waiting' && (pool.venue !== 'pro' || empty || named === 'position'));
  const { tabs, first } = useMemo(() => ticketTabs({ venue: pool.venue, ladder: trade && ladderOn && !noLadder, trade, adds, empty }), [pool.venue, ladderOn, noLadder, trade, adds, empty]);
  const [tab, setTab] = useState<TicketTab>(first ?? 'swap');
  useTabInAddress(tab, setTab, tabs, first ?? 'swap');
  // A tab the pool no longer offers (the coin turned out to have no ladder) gives way to the first one.
  useEffect(() => {
    if (first && !tabs.includes(tab)) setTab(first);
  }, [tabs, tab, first]);
  // A sentence for the agent that asked for a ladder brings the Limit tab forward — a ladder asked for here, never the
  // Limit tab a coin's own page left on before this one opened (that one is let go as the page opens).
  const asked = useLimitTab((st) => st.mint === coin.mint && st.on);
  const armed = useRef(false);
  useEffect(() => {
    if (armed.current && asked && tabs.includes('limit')) setTab('limit');
  }, [asked, tabs]);
  useEffect(() => {
    setLimitTab(coin.mint, false);
    armed.current = true;
  }, [coin.mint]);
  // While a ladder, a trade or an Earn action is under its signature, the tabs hold.
  const ladderBusy = useLadder((st) => LADDER_BUSY.has(st.phase));
  const tradeBusy = useTrade((st) => st.phase === 'wallet' || st.phase === 'sending');
  const earnBusy = useEarn((st) => st.busy);
  const pick = useCallback(
    (next: TicketTab) => {
      if (ladderBusy || tradeBusy || earnBusy) return;
      setTab(next);
    },
    [ladderBusy, tradeBusy, earnBusy],
  );

  if (!first) return null;
  const items = tabs.map((id) => ({ id, label: id === 'position' ? w.tabPosition : id === 'limit' ? w.tabLimit : w.tabSwap }));
  // Where a position is not open here, its tab leads on with one action: the pool's limit order, else its swap.
  const act = tabs.includes('limit') ? { label: w.goLimit, onClick: () => pick('limit') } : tabs.includes('swap') ? { label: w.goSwap, onClick: () => pick('swap') } : null;
  return (
    <Panel tone="hi" gap={12} label={w.ticket} className={cx(p.side, phone && p.sidePhone, tab === 'swap' && !phone && s.desk)}>
      {tabs.length > 1 ? <Tabs fill label={w.ticket} value={tab} onChange={pick} items={items} /> : null}
      {tab === 'position' ? (
        <>
          {/* A tokenised stock's session stands over every tab of the ticket — the column has no copy of it. */}
          <StockPoolFacts mint={coin.mint} />
          {pool.venue === 'pro' && pool.pro ? <ProPosition row={pool.pro} peek={!phone} act={act} /> : <DlmmPosition pool={pool} harbor={harbor} peek={!phone} act={act} />}
        </>
      ) : tab === 'limit' ? (
        <>
          {/* What a limit order earns — and in which pool, where the coin's ladders rest in another of its pools. */}
          {pool.pro ? <BonusCard row={pool.pro} pools={pro} mint={coin.mint} sym={coin.symbol} /> : null}
          <StockPoolFacts mint={coin.mint} />
          {ladder ? <LadderTicket coin={coin} market={ladder} usd={usd} onOrders={onOrders} /> : <div className={p.sideWait} aria-busy="true" />}
        </>
      ) : (
        <>
          <StockPoolFacts mint={coin.mint} />
          <Ticket coin={{ id: coin.mint, symbol: coin.symbol, name: coin.name, icon: coin.icon }} framed={false} desk={!phone} usd={usd} onOrders={onOrders} />
        </>
      )}
      {/* The coin's facts close the column under the swap and the limit order alike: a tall desk's ticket never stands
          over an empty stretch. */}
      {foot && tab !== 'position' ? <div className={p.sideFoot}>{foot}</div> : null}
    </Panel>
  );
}

type Act = Readonly<{ label: string; onClick: () => void }> | null;

/**
 * The quiet line where a position is not open here yet: what stands, and why behind «i»; the pool's page at Meteora, or
 * — on DLMM Pro — one of the city's own pools where a position opens now (`go`); and under it the tab's one
 * action (`act`: the pool's limit order, else its swap), so the column never stands empty.
 */
function Soon({ why, link, go, act }: { why: string; link?: string | null; go?: Readonly<{ href: string; label: string }> | null; act?: Act }) {
  const w = useWords(POOL);
  return (
    <div className={p.soonState}>
      <div className={p.soon} data-pool-soon="">
        <span className={p.soonWords}>
          <b>{w.soon}</b>
          {link ? (
            <a className={p.venueLink} href={link} target="_blank" rel="noopener noreferrer">
              {w.venuePage}
              <Icon name="arrow" size="s" />
            </a>
          ) : go ? (
            <QuietLink href={go.href} size="s">
              {go.label}
            </QuietLink>
          ) : null}
        </span>
        <Info label={w.soon}>{why}</Info>
      </div>
      {act ? (
        <Action onClick={act.onClick} data-pool-soon-act="">
          {act.label}
        </Action>
      ) : null}
    </div>
  );
}

/**
 * A DLMM Pro pool's position: the Earn form on the pier the engine serves — or, where it does not serve this pool yet,
 * «soon» at once (the form filled in and said «soon» only at its end), with the way to one of the city's own
 * pools where a position opens now; a pool without SOL says «soon» alone. In a pool whose coin Earn did not check, one
 * line before the signature says the pair moves.
 */
function ProPosition({ row, peek, act }: { row: ProPoolRow; peek: boolean; act: Act }) {
  const w = useWords(POOL);
  const list = useProPier((st) => st.list);
  const held = useProPier((st) => st.pier?.address ?? null);
  const heldTakes = useProPier((st) => st.pier?.takesDeposits ?? null);
  const phase = useProPier((st) => st.phase);
  const elsewhere = useTicketHeld();
  const harborList = useEarnData((st) => st.piers);
  useEffect(() => {
    void useProPier.getState().loadPiers();
    if (EARN_OPEN) void useEarnData.getState().loadPiers();
  }, []);
  const read = list.status === 'ready' || list.status === 'error' || list.status === 'closed';
  const network = list.status === 'ready' ? list.value.network : 'mainnet';
  const served = list.status === 'ready' ? (list.value.piers.find((pier) => pier.address === row.address) ?? null) : null;
  const offered = served !== null && proOffered(served, network);
  const offer = proOffer(row, served !== null, offered);
  const pier = offer === 'ticket' ? served : null;
  // Where a position opens now: the first of the city's own pools the terminal offers, other than this one.
  const open = list.status === 'ready' ? (list.value.piers.find((entry) => entry.address !== row.address && proOffered(entry, network)) ?? null) : null;
  // The form stands on the store's card, as Earn's own does — the pier served — and again once an action that landed
  // gives the card back to the list. Never over an action under way elsewhere in Earn: that card is finished there.
  useEffect(() => {
    if (!read || !pier || (held === row.address && heldTakes === pier.takesDeposits)) return;
    // This pool's own outcome stays on its card until it is read («OK», «Check»).
    if (held === row.address && useProPier.getState().outcome) return;
    if (offer === 'ticket' && held !== row.address) {
      place({ kind: 'pro', address: row.address });
      return;
    }
    if (ticketHeld()) return;
    if (useProPier.getState().phase === 'reviewing') useProPier.getState().back();
    if (PRO_BUSY.has(useProPier.getState().phase)) return;
    useProPier.getState().openPier(pier);
  }, [read, pier, held, heldTakes, offer, row.address, elsewhere, phase]);
  const solUsd = harborList.status === 'ready' ? venueSolUsd(harborList.value.pools) : null;

  if (!read) return <div className={p.sideWait} aria-busy="true" />;
  if (offer === 'soon') return <Soon why={w.soonNoSol} act={act} />;
  if (list.status === 'error' && !served) return <Failed onAgain={() => void useProPier.getState().loadPiers()} />;
  if (offer === 'preview') return <Soon why={w.soonPreview} go={open ? { href: `/pool/${open.address}?tab=position`, label: w.firstIn(`${open.x.symbol} · ${open.y.symbol}`) } : null} act={act} />;
  if (!pier) return <Soon why={w.soonEmpty} act={act} />;
  if (held !== row.address) return elsewhere || PRO_BUSY.has(phase) ? <Busy /> : <div className={p.sideWait} aria-busy="true" />;
  // A pair Earn did not check moves: one line before the signature, and no agent looks after it (behind «i»).
  const risk =
    network === 'devnet' || proKnown(pier) ? null : (
      <OneLine line={w.risk} label={w.risk}>
        <p>{w.riskWhy}</p>
      </OneLine>
    );
  return <ProTicket key={`${row.address}:${offer}`} bare peek={peek} pier={pier} row={proPoolRows([pier], solUsd)[0]!} onConnect={connect} risk={risk} />;
}

/** An action of Earn is under its signature or landed in part: its card is finished there, never covered here. */
function Busy() {
  const w = useWords(POOL);
  return (
    <div className={p.soon} data-pool-busy="">
      <span className={p.soonWords}>
        <b>{w.busy}</b>
      </span>
      <QuietLink href="/earn" size="s">
        {w.busyGo}
      </QuietLink>
    </div>
  );
}

/** The engine's pools did not read: said so, with one quiet «Try again». */
function Failed({ onAgain }: { onAgain: () => void }) {
  const w = useWords(POOL);
  return (
    <div className={p.soon} role="status">
      <span className={p.soonWords}>
        <b>{w.failed}</b>
      </span>
      <Quiet size="s" onClick={onAgain}>
        {w.again}
      </Quiet>
    </div>
  );
}

/** A DLMM pool of Earn's own (`/api/city/earn/piers`): SOL against USDC or a staked SOL — the pools Earn adds to. */
function useHarborPool(pool: DeskPool) {
  const list = useEarnData((st) => st.piers);
  useEffect(() => {
    if (EARN_OPEN && pool.venue !== 'pro') void useEarnData.getState().loadPiers();
  }, [pool.venue]);
  return useMemo(() => {
    if (pool.venue === 'pro' || list.status !== 'ready') return null;
    const found = list.value.pools.find((entry) => entry.address === pool.address);
    return found && pierOf(found) ? found : null;
  }, [list, pool.venue, pool.address]);
}

/** A DLMM pool's position: Earn's own form where Earn adds to the pool; elsewhere «soon», with the pool's page at Meteora. */
function DlmmPosition({ pool, harbor, peek, act }: { pool: DeskPool; harbor: ReturnType<typeof useHarborPool>; peek: boolean; act: Act }) {
  const w = useWords(POOL);
  const list = useEarnData((st) => st.piers);
  const owner = useWallet((st) => st.connection?.address ?? null);
  const states = usePier((st) => st.states);
  const placed = usePier((st) => st.pool?.address ?? null);
  const phase = usePier((st) => st.phase);
  const elsewhere = useTicketHeld();
  useEffect(() => {
    if (owner && EARN_OPEN && PIER_MODE !== 'closed') void usePier.getState().loadStates(owner);
  }, [owner]);
  // The form stands on the pool's own flow, as Earn's does — and again once an action that landed gives it back.
  useEffect(() => {
    if (harbor && placed !== harbor.address) place({ kind: 'pool', address: harbor.address });
  }, [harbor, placed, elsewhere, phase]);
  const pier = useMemo(() => (harbor ? pierOf(harbor) : null), [harbor]);
  if (!harbor || !pier) {
    const waiting = EARN_OPEN && (list.status === 'idle' || list.status === 'loading');
    return waiting ? <div className={p.sideWait} aria-busy="true" /> : <Soon why={w.soonPool} link={pool.page} act={act} />;
  }
  if (placed !== harbor.address) return elsewhere || PIER_BUSY.has(phase) ? <Busy /> : <div className={p.sideWait} aria-busy="true" />;
  // Who may add here: the city's own switch, and this wallet's word from the engine — as on Earn.
  const mine = owner && states?.owner === owner ? states.value : null;
  const addOpen = mayAdd(PIER_MODE, mine?.add === 'on') && !(mine !== null && mine.add !== 'on' && !mine.stopped && mine.exit !== 'on');
  return <PoolTicket key={harbor.address} bare peek={peek} pier={pier} row={poolRows([harbor])[0]!} addOpen={addOpen} onConnect={connect} />;
}

/**
 * Over the ladder: what a limit order earns — Meteora DLMM Pro's own feature, which Meteora's own pages do not offer
 * people yet — in one figure, with how it works behind «i»; a pool whose bonus rounds to nothing says none. The ladder
 * rests in the coin's own pool for it (`/api/v1/ladders/market`): where that is another pool of the coin, the card names
 * that pool, its fee and its bonus — the figures the ticket under it counts by — and leads there (JitoSOL/SOL
 * 0.01 % showed «Bonus +0.016 %», the 0.04 % pool's, under a head that said +0.004 %).
 */
export function BonusCard({ row, pools, mint, sym }: { row: ProPoolRow; pools: Read<readonly ProPoolRow[]>; mint: string; sym: string }) {
  const w = useWords(POOL);
  const lang = useLang();
  // The ladder's own market names its pool, that pool's fee and its bonus (`lib/pro-limits/service.ts`: `feeBps` the
  // pool's fee now, `ownerBps` the list's bonus) — the figures the ticket under the card counts by, from the moment
  // the market reads; the list of pools, where it is read, gives the fee as the list says it.
  const ladder = useLadder((st) => (st.mint === mint && st.market.status === 'ready' && st.market.value ? st.market.value : null));
  // Nothing while the coin's ladder market is read: a figure of this pool's that turns into another pool's, or a card that
  // comes late and pushes the ladder down, is worse than a card that comes once.
  const reading = useLadder((st) => st.mint !== mint || st.market.status === 'none' || st.market.status === 'loading');
  const elsewhere = ladder !== null && ladder.pool !== row.address;
  const ladderPool = ladder?.pool ?? null;
  const there = elsewhere && pools.status === 'ready' ? (pools.value.find((entry) => entry.address === ladderPool) ?? null) : null;
  const bonusBps = elsewhere ? ladder!.bonus.ownerBps : row.bonusBps;
  if (reading || (!elsewhere && bonusBps < 1)) return null;
  const pct = (bps: number) => digits(pctOfBps(bps), lang);
  // The pool is named by its pair where its pair is not this page's (MET's ladder in MET · USDC on MET · SOL's page), by
  // its fee alone where it is the same pair.
  const otherPair = there !== null && pairOf(there).quote.mint !== pairOf(row).quote.mint ? `${tickerOf(pairOf(there).coin)} · ${tickerOf(pairOf(there).quote)} ` : '';
  return (
    <div className={p.bonus} data-pool-bonus="" data-elsewhere={elsewhere || undefined}>
      <span className={p.bonusBig}>{`+${pct(bonusBps)}`}</span>
      <span className={p.bonusWords}>
        <b>{w.bonusTitle}</b>
        {elsewhere ? <span>{w.elsewhereIn(sym, otherPair, pct(there?.fee.totalBps ?? ladder!.bonus.feeBps))}</span> : null}
      </span>
      {elsewhere ? (
        <QuietLink href={`/pool/${ladderPool}?tab=limit`} size="s">
          {w.elsewhereGo}
        </QuietLink>
      ) : (
        <Info label={w.bonusTitle}>{w.bonusWhy}</Info>
      )}
    </div>
  );
}
