'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { create } from 'zustand';
import { DOLLAR_MINT, rateText } from '@/city/lib/earn/dollar';
import { DOLLAR_BUSY, useDollar } from '@/city/lib/earn/dollar-store';
import { EARN_PRO_OPEN } from '@/city/lib/earn/pro';
import { percentText, solPerToken } from '@/city/lib/earn/lst';
import { PIER_LOCKED, usePier } from '@/city/lib/earn/pier-store';
import { PRO_LOCKED, useProPier } from '@/city/lib/earn/pro-store';
import { SAVER_BUSY, useSaver } from '@/city/lib/earn/saver-store';
import { useEarnData } from '@/city/lib/earn/store';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useWallet } from '@/city/lib/trade/wallet';
import type { EarnLendRate } from '@/lib/earn-pools/model';
import type { ProPoolRow } from '@/lib/pro-pools/model';
import { pctOfBps, proListRows, proVerified } from '@/terminal/pool/pool-view';
import { useProPools } from '@/terminal/pool/usePro';
import { POOL } from '@/terminal/pool/words';
import { Action, Cell, Chip, Columns, Figure, Info, Kick, Page, PageHead, Panel, Quiet, Segment, Table, TableHead, TableRow, Tabs, Tile, Title, cx, useColumnSet, usdText } from '@/terminal/ui';
import { useTabInAddress } from '../shell/address';
import { openPanel } from '../shell/frame';
import { PRO_PATH } from '../shell/shelves';
import { useAskHere } from '../shell/useAskHere';
import { NARROW, useNarrow } from '../shell/useNarrow';
import { connectWallet } from '../shell/Wallet';
import { SHELL } from '../shell/words';
import { Pair, Sign } from './bits';
import { useCatalog } from './catalog';
import { FilterBar, PhoneRows, PoolsTable, StrategyCards, type StrategyCard } from './Chooser';
import { START_FILTERS, START_SORT, STRATEGY_SORT, bestStake, chooseRows, dayPctText, filterRows, lendOf, sortRows, strategyFilters, strategyPick, type ChooseRow, type Filters, type Sort, type Strategy } from './choose';
import { ProPhoneRows, ProPoolLink, ProPoolTicket, ProTable, proName } from './ProList';
import { resultTone, sumText, type PositionRow, type StakeRow } from './rows';
import { TicketBody, TicketSheet, ticketName, useTicketPlaced } from './TicketPanel';
import { closeSheet, firstOffer, heldForm, onTab, pick, pickLending, ticketKey, ticketStands, underWay, useTicket, useTicketHeld, type Ticket } from './ticket';
import { useEarnFigures, useEarnReads, useWidthGivenBack, type EarnFigures } from './useReads';
import { ViewTicket } from './ViewTicket';
import { LendingList, StakingList, type StakeFacts } from './YieldLists';
import { EARN } from './words';
import e from './earn.module.css';
import p from '@/terminal/pool/pool.module.css';

const HOLD_COLUMNS = 'minmax(200px, 1.4fr) repeat(3, minmax(84px, 1fr)) 120px';
/** Rows a table shows before «more». */
const ROWS_SHOWN = 30;
/** How often the chooser's pools are read again while the screen is in view. */
const CATALOG_AGAIN_MS = 60_000;
/** A DLMM Pro pool counts as «with liquidity» from a dollar of it up: the program holds many pools made and left empty. */
const DEEP_USD = 1;

/** The tabs of «Earn»: the same page, the same places, each tab with its own ticket. */
type View = 'pools' | 'pro' | 'staking' | 'lending' | 'mine';
/** The tabs the address names with `?tab=` on /earn; DLMM Pro is an address of its own, /pro. */
type EarnTab = Exclude<View, 'pro'>;
const EARN_TABS: readonly EarnTab[] = ['pools', 'staking', 'lending', 'mine'];
const TAB_HREF: Readonly<Record<View, string>> = { pools: '/earn', pro: PRO_PATH, staking: '/earn?tab=staking', lending: '/earn?tab=lending', mine: '/earn?tab=mine' };

type Which = 'deep' | 'every';

/**
 * What the screen keeps across its two addresses (/earn and /pro are one screen): the pools' filters and order, and the
 * DLMM Pro pool in front with the list's choice of pools. A turn to DLMM Pro and back keeps them.
 */
const useKept = create<{ filters: Filters; sort: Sort; proAt: string | null; which: Which }>(() => ({ filters: START_FILTERS, sort: START_SORT, proAt: null, which: 'deep' }));

/** Lending that opens the city's own ticket here: USDC and SOL on Jupiter Lend. */
const LEND_ASSET: ReadonlyMap<string, 'USDC' | 'SOL'> = new Map([
  [DOLLAR_MINT.USDC, 'USDC'],
  [DOLLAR_MINT.SOL, 'SOL'],
]);

/**
 * The Earn screen: five tabs on one desk — Pools, DLMM Pro,
 * Staking, Lending and My positions. «Тут одне на всю ширину, то і вузьке, то і таке… щось
 * не то» — every tab is a list on the whole working width with its own ticket on the right, as Meteora's, DexScreener's
 * and Hyperliquid's desks stand: the head and its tabs, the ways to earn across the top, the tab's bar, its table on the
 * left as wide as the desk allows, and the ticket of what the tab is about in one column on the right, the whole height.
 * A turn of the tabs moves nothing but the contents. A phone has the same tabs, its rows, and the ticket as a sheet.
 */
export function EarnScreen() {
  return (
    <Page kind="desk">
      <EarnDesk />
    </Page>
  );
}

/** The desk of «Earn», on whichever of its two addresses: /earn and its tabs, or /pro — its DLMM Pro tab. */
export function EarnDesk() {
  const w = useWords(EARN);
  const q = useWords(POOL);
  const lang = useLang();
  const pathname = usePathname();
  const owner = useWallet((st) => st.connection?.address ?? null);
  useEarnReads(owner);
  useWidthGivenBack();
  const figures = useEarnFigures(owner);
  const narrow = useNarrow();
  const picked = useTicket((st) => st.picked);
  const pickedOn = useTicket((st) => st.on);
  const sheet = useTicket((st) => st.sheet);
  const held = useTicketHeld();
  const keptBoat = usePier((st) => st.boat?.address ?? null);
  const keptPro = useProPier((st) => st.boat?.nftMint ?? null);
  // A pool whose action is under way or has an outcome to read stays in front even if a refresh of the list moved it.
  const keptPool = usePier((st) => (st.pool && (PIER_LOCKED.has(st.phase) || st.outcome) ? st.pool.address : null));
  const keptProPool = useProPier((st) => (st.pier && (PRO_LOCKED.has(st.phase) || st.outcome) ? st.pier.address : null));
  const pierPool = usePier((st) => st.pool?.address ?? null);
  const pierLocked = usePier((st) => PIER_LOCKED.has(st.phase));
  const pierOutcome = usePier((st) => st.outcome?.kind ?? null);
  const pierAct = usePier((st) => st.target?.kind ?? null);
  const proPier = useProPier((st) => st.pier?.address ?? null);
  const proLocked = useProPier((st) => PRO_LOCKED.has(st.phase));
  const proOutcome = useProPier((st) => st.outcome?.kind ?? null);
  const proAct = useProPier((st) => st.target?.kind ?? null);
  const saverBusy = useSaver((st) => SAVER_BUSY.has(st.phase));
  const saverLst = useSaver((st) => st.lst);
  const saverResult = useSaver((st) => st.phase === 'done' || st.phase === 'failed');
  const dollarBusy = useDollar((st) => DOLLAR_BUSY.has(st.phase));
  const dollarAsset = useDollar((st) => st.asset);
  const dollarResult = useDollar((st) => st.phase === 'done');
  const piers = useEarnData((st) => st.piers);
  const feed = useEarnData((st) => st.feed);
  const catalog = useCatalog();
  // Density is the table's own choice: «Columns» — the main ones or all of them — remembered by the browser;
  // the rare filters open with «+ Filters» and stay open while one of them is set. A phone has its own list.
  const [columnSet, setColumnSet] = useColumnSet('earn', false);
  const every = columnSet === 'all' && !narrow;
  const [moreFilters, setMoreFilters] = useState(false);
  const frame = useWords(SHELL);
  const filters = useKept((st) => st.filters);
  const sort = useKept((st) => st.sort);
  const proAt = useKept((st) => st.proAt);
  const which = useKept((st) => st.which);
  const setFilters = useCallback((next: Filters) => useKept.setState({ filters: next }), []);
  const setSort = useCallback((next: Sort) => useKept.setState({ sort: next }), []);
  const [all, setAll] = useState(false);
  const [nowMs, setNowMs] = useState(() => useCatalog.getState().at);

  // The tab: DLMM Pro is its own address (/pro); the others are /earn's `?tab=`, written back on every turn.
  const onPro = pathname === PRO_PATH;
  // DLMM Pro's tab is the address /pro; a turn to it and back rewrites the address in place — the page is not loaded
  // again, so nothing on it moves (the router takes the address in, as it does for `?tab=`).
  const [proHere, setProHere] = useState(onPro);
  useEffect(() => setProHere(onPro), [onPro]);
  const [tab, setTab] = useState<EarnTab>('pools');
  useTabInAddress(tab, setTab, EARN_TABS, 'pools');
  const view: View = proHere ? 'pro' : tab;
  const go = useCallback(
    (next: View) => {
      if (next === view) return;
      // A turn of the tabs puts the phone's sheet away; what is picked on the new tab opens its own.
      closeSheet();
      if (next === 'pro' || proHere) {
        window.history.replaceState(null, '', TAB_HREF[next]);
        setProHere(next === 'pro');
        setTab(next === 'pro' ? 'pools' : next);
      } else setTab(next);
    },
    [view, proHere],
  );

  // The chooser's own read, beside the city's: now, every minute while in view, and when the tab comes back.
  useEffect(() => {
    const read = () => {
      if (document.visibilityState !== 'visible') return;
      void useCatalog.getState().load();
    };
    read();
    const timer = setInterval(read, CATALOG_AGAIN_MS);
    document.addEventListener('visibilitychange', read);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', read);
    };
  }, []);
  // Ages are counted from the time of the read, so the server's page and the first paint agree.
  useEffect(() => setNowMs(catalog.at || Date.now()), [catalog.at]);

  const harbor = piers.status === 'ready' ? piers.value.pools : null;
  const rows = useMemo(
    () => chooseRows({ catalog: catalog.value?.pools ?? [], harbor: harbor ?? [], addOpen: figures.addOpen, proPiers: figures.proPiers, rows: figures.pools }),
    [catalog.value, harbor, figures.addOpen, figures.proPiers, figures.pools],
  );
  const shown = useMemo(() => sortRows(filterRows(rows, filters), sort), [rows, filters, sort]);
  const lend = useMemo(() => catalog.value?.lend ?? [], [catalog.value]);
  const coins = useMemo(() => topCoins(rows), [rows]);
  const poolsRead: 'reading' | 'ready' | 'failed' = rows.length || (catalog.status === 'ready' && figures.poolsRead !== 'reading') ? 'ready' : catalog.status === 'failed' && figures.poolsRead !== 'reading' ? 'failed' : 'reading';

  // Staking, best rate first, with each coin's own facts; lending — only the markets the city's ticket puts coins in.
  const stakes = useMemo(() => [...figures.stakes].sort((a, b) => b.apyPct - a.apyPct), [figures.stakes]);
  const stakeFacts = useCallback(
    (row: StakeRow): StakeFacts => {
      const read = feed.status === 'ready' ? feed.value.lsts.find((entry) => entry.id === row.lst.id) : undefined;
      return { worthSol: read ? solPerToken(read.rate, row.lst.decimals) : null, keepsPct: read?.rewardsFeePct ?? null };
    },
    [feed],
  );
  const lendActs = useCallback((rate: EarnLendRate) => figures.lendOpen && LEND_ASSET.has(rate.mint), [figures.lendOpen]);
  // Only the markets the city's ticket puts coins in: a row without an action is not shown at all.
  const lendRows = useMemo(() => lend.filter((rate) => LEND_ASSET.has(rate.mint)), [lend]);
  const lendAvailable = useCallback(
    (rate: EarnLendRate) => {
      const asset = LEND_ASSET.get(rate.mint);
      const market = asset ? figures.markets[asset] : null;
      if (!market || market.liquidRaw === null || market.priceUsd === null) return null;
      return (Number(market.liquidRaw) / 10 ** market.decimals) * market.priceUsd;
    },
    [figures.markets],
  );
  const lendYours = useCallback(
    (rate: EarnLendRate) => {
      const asset = LEND_ASSET.get(rate.mint);
      const market = asset ? figures.markets[asset] : null;
      const lent = asset ? figures.lent.find((position) => position.asset === asset) : undefined;
      if (!market || market.priceUsd === null) return null;
      if (!lent) return 0;
      return lent.worthRaw === null ? null : (Number(lent.worthRaw) / 10 ** market.decimals) * market.priceUsd;
    },
    [figures.markets, figures.lent],
  );

  // DLMM Pro: every pool of the program, deepest first; by default those with liquidity.
  const proRead = useProPools();
  const proAll = proRead.read.status === 'ready' ? proRead.read.value : null;
  const proAdds = useCallback((row: ProPoolRow) => figures.pools.some((entry) => entry.kind === 'pro' && entry.address === row.address && entry.takes), [figures.pools]);
  // The deepest pool of verified coins first; the city's own pools that hold nothing yet next — in sight, never first,
  // their row inviting the first position; then the pools of verified coins, deepest first, and only then
  // the rest — a launch pool of a coin nobody verified never stands where a person looks first. «Active» leaves out the empty pools nobody can add to from here, and
  // the names a person should not meet first: no name, a test, a crude word, a look-alike ticker (`proListRows`).
  const proRows = useMemo(() => (proAll ? proListRows(proAll, { which, adds: proAdds, deepUsd: DEEP_USD }) : []), [proAll, which, proAdds]);
  const proActiveCount = useMemo(() => (proAll ? proListRows(proAll, { which: 'deep', adds: proAdds, deepUsd: DEEP_USD }).length : 0), [proAll, proAdds]);
  const proTotal = useMemo(() => (proAll ? proRows.reduce((sum, row) => sum + (row.tvlUsd ?? 0), 0) : null), [proAll, proRows]);
  // Before a pick the tab opens on the deepest pool of a verified coin that holds liquidity — its own ticket, the limit
  // order with its bonus; the city's own pools stand first in the list with their «Add».
  const proDeep = (row: ProPoolRow) => (row.tvlUsd ?? 0) >= DEEP_USD;
  const proSel: ProPoolRow | null =
    proRows.find((row) => row.address === proAt) ??
    proRows.find((row) => proDeep(row) && proVerified(row) && !proAdds(row)) ??
    proRows.find(proDeep) ??
    proRows[0] ??
    null;
  const proTop = EARN_PRO_OPEN && proAll ? (proAll.find((row) => proDeep(row) && proVerified(row)) ?? proAll.find(proDeep) ?? null) : null;

  // What each tab offers before the person picks: the pools — the form the store holds, else the first pool that takes a
  // deposit, else the first listed; DLMM Pro — the city's add where the pool takes one; staking — the best rate; lending
  // — dollars; the positions — the first that has an action here.
  const listed = (kind: 'pool' | 'pro', address: string) => figures.pools.some((row) => row.kind === kind && row.address === address && row.takes && (row.kind === 'pro' || figures.addOpen));
  const state = {
    pier: { pool: pierPool, boat: keptBoat, locked: pierLocked, outcome: pierOutcome, act: pierAct },
    pro: { pier: proPier, boat: keptPro, locked: proLocked, outcome: proOutcome, act: proAct },
    saver: { busy: saverBusy, lst: saverLst },
    dollar: { busy: dollarBusy, asset: dollarAsset },
  };
  const poolOffer = useMemo(
    () => (figures.poolsRead === 'reading' ? null : firstOffer({ pools: figures.pools, addOpen: figures.addOpen, stakes: [], lendOpen: false })),
    [figures.poolsRead, figures.pools, figures.addOpen],
  );
  const firstShown = shown[0];
  const mineFirst = useMemo(() => {
    for (const row of figures.positions) {
      const ticket = positionTicket(row, figures);
      if (ticket) return ticket;
    }
    return null;
  }, [figures]);
  const offerOf = (tab: View): Ticket | null => {
    switch (tab) {
      case 'pools':
        return heldForm(state, listed) ?? poolOffer ?? (firstShown ? { kind: 'view', address: firstShown.address } : null);
      case 'pro':
        return proSel && proAdds(proSel) ? { kind: 'pro', address: proSel.address } : null;
      // A result not read yet stays on its tab's ticket: a turn of the tabs never wipes it.
      case 'staking':
        return saverResult ? { kind: 'stake', lst: saverLst } : stakes[0] ? { kind: 'stake', lst: stakes[0].lst.id } : null;
      case 'lending':
        return dollarResult ? { kind: 'lend', asset: dollarAsset } : figures.lendOpen ? { kind: 'lend', asset: 'USDC' } : null;
      case 'mine':
        if (pierOutcome && keptBoat) return { kind: 'position', address: keptBoat, act: pierAct === 'exit' ? 'exit' : 'claim' };
        if (proOutcome && keptPro) return { kind: 'proPosition', nftMint: keptPro, act: proAct === 'compound' || proAct === 'leave' || proAct === 'close' ? proAct : 'collect' };
        return mineFirst;
    }
  };

  // A pool shown to compare stands while it is listed and still only compared: once it takes a deposit, the add's own ticket does.
  const listedRow = useCallback((address: string) => rows.some((row) => row.address === address && row.act === 'view'), [rows]);
  const stands = picked !== null && ticketStands(picked, figures, { boat: keptBoat, proBoat: keptPro, pool: keptPool, proPool: keptProPool }, listedRow);
  // A signature in progress, or a part landed and not read, stands in front first — on its own tab, and on any tab while
  // the wallet holds it; then what the person picked on this tab; then the tab's own offer. DLMM Pro's tab is about the
  // pool in front of its list.
  const busy = underWay(state);
  const pickedHere = view !== 'pro' && picked !== null && stands && (pickedOn === view || (pickedOn === null && onTab(picked, view))) ? picked : null;
  const front: Ticket | null = (busy && (onTab(busy, view) || held) ? busy : null) ?? pickedHere ?? offerOf(view);
  useTicketPlaced(front);
  // A picked thing that is gone — another wallet, a position left — gives way to the first offer.
  const pickedKey = ticketKey(picked);
  useEffect(() => {
    if (picked && !stands && !held) useTicket.setState({ picked: null, on: null, sheet: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedKey, stands, held]);
  // Leaving the screen, or turning a tab, puts the phone's sheet away.
  useEffect(() => () => void useTicket.setState({ sheet: false }), []);
  // A phone's tabs scroll sideways: the open one is brought into sight — again once the counts beside the tabs arrive
  // and widen them.
  const tabsWide = `${rows.length > 0}|${proAll !== null}|${stakes.length > 0}|${lendRows.length > 0}|${figures.positions.length > 0}`;
  useEffect(() => {
    if (!narrow) return;
    const tab = document.querySelector<HTMLElement>(`[role="tablist"][aria-label="${w.sections}"] [aria-selected="true"]`);
    const strip = tab?.closest<HTMLElement>('[role="tablist"]');
    if (!tab || !strip) return;
    // The strip itself scrolls, never the page: the tab's middle to the strip's middle.
    let box: HTMLElement | null = strip;
    while (box && box.scrollWidth <= box.clientWidth) box = box.parentElement;
    if (!box || box === document.body || box === document.documentElement) return;
    const from = box.getBoundingClientRect();
    const at = tab.getBoundingClientRect();
    box.scrollLeft += at.left + at.width / 2 - (from.left + from.width / 2);
  }, [view, narrow, w.sections, tabsWide]);

  // A sentence for the agent that leads here: lending opens on the coin, the side and the amount said.
  useAskHere((ask) => {
    if (ask.command.kind !== 'dollar') return;
    const said = ask.command.ask;
    go('lending');
    if (pickLending(said.asset, said.side, 'lending')) useDollar.getState().fromAsk(said);
  });

  const connect = useCallback(() => {
    // A phone's wallet lives in the frame's own sheet: the ticket gives way to it.
    if (window.matchMedia(NARROW).matches) {
      closeSheet();
      openPanel('sheet');
    }
    connectWallet();
  }, []);

  const onPick = useCallback((row: ChooseRow) => {
    void pick(row.act === 'add' ? { kind: 'pool', address: row.address } : row.act === 'pro' ? { kind: 'pro', address: row.address } : { kind: 'view', address: row.address }, 'pools');
  }, []);
  const onStake = useCallback((row: StakeRow, on: View = 'staking') => void pick({ kind: 'stake', lst: row.lst.id }, on), []);
  const onLend = useCallback(
    (rate: EarnLendRate) => {
      const asset = LEND_ASSET.get(rate.mint);
      if (asset && figures.lendOpen) void pickLending(asset, 'deposit', 'lending');
    },
    [figures.lendOpen],
  );
  const pickPro = useCallback((row: ProPoolRow) => {
    useKept.setState({ proAt: row.address });
    // The city's add places itself as the tab's offer; on a phone the pool's ticket opens as the sheet.
    useTicket.setState({ sheet: true });
  }, []);
  const choose = useCallback(
    (strategy: Strategy, row: ChooseRow | null) => {
      setFilters(strategyFilters(strategy));
      setSort(STRATEGY_SORT[strategy]);
      setAll(false);
      go('pools');
      if (row) onPick(row);
    },
    [onPick, go, setFilters, setSort],
  );

  // The ways to earn, across the top of every tab — the same four on each, so a turn of the tabs moves nothing: the
  // stable pools, Meteora DLMM Pro, staking and lending, each with its figure and a tap to it.
  const cards = useMemo<StrategyCard[]>(() => {
    const out: StrategyCard[] = [];
    // A card names a pool with a day's figure to show: one the venue has not counted yet is never a card's.
    const counted = rows.filter((row) => row.feeTvlPct !== null && row.feeTvlPct > 0);
    const stable = strategyPick(counted, 'stable') ?? strategyPick(counted, 'high');
    if (stable) {
      const isStable = strategyPick(counted, 'stable') !== null;
      out.push({
        id: 'stable',
        title: isStable ? w.sStable : w.sHigh,
        line: isStable ? w.sStableLine(stable.name) : w.sHighLine(stable.name),
        figure: w.perDay(dayPctText(stable.feeTvlPct, lang)),
        on: view === 'pools' && filters.strategy === (isStable ? 'stable' : 'high'),
        act: () => choose(isStable ? 'stable' : 'high', stable),
      });
    }
    // «Pool reward» while a DLMM Pro pool's reward runs; else Meteora DLMM Pro itself — its deepest pool and what
    // a limit order earns there; a tap opens its tab on that pool.
    const proPick = strategyPick(rows, 'reward');
    if (proPick?.reward)
      out.push({
        id: 'reward',
        title: w.sReward,
        line: w.sRewardLine(proPick.name),
        figure: w.sRewardPool(digits(proPick.reward.perDay, lang), proPick.reward.symbol),
        on: view === 'pools' && filters.strategy === 'reward',
        act: () => choose('reward', proPick),
      });
    else if (proTop)
      out.push({
        id: 'pro',
        title: 'DLMM Pro',
        line: w.sProLine(proName(proTop)),
        figure: w.sProBonus(digits(pctOfBps(proTop.bonusBps), lang)),
        on: view === 'pro',
        act: () => {
          useKept.setState({ proAt: proTop.address });
          go('pro');
        },
      });
    const stake = bestStake(figures.stakes);
    if (stake)
      out.push({
        id: 'hold',
        title: w.sHold,
        line: w.sHoldLine(stake.lst.symbol),
        figure: w.perYear(digits(percentText(stake.apyPct), lang)),
        on: view === 'staking',
        act: () => {
          go('staking');
          onStake(stake, 'staking');
        },
      });
    // The rate the lending ticket itself says (the market it puts coins in), else the catalogue's: one figure for one
    // market, never «5%» on the card beside «4.99%» in the ticket.
    const usdcRate = figures.lendRate ?? lendOf(lend, 'USDC')?.ratePct ?? null;
    if (usdcRate !== null)
      out.push({
        id: 'lend',
        title: w.sLend('USDC'),
        line: w.sLendLine,
        figure: w.perYear(digits(rateText(usdcRate), lang)),
        on: view === 'lending',
        act: () => {
          go('lending');
          if (figures.lendOpen) void pickLending('USDC', 'deposit', 'lending');
        },
      });
    return out.slice(0, 4);
  }, [rows, figures.stakes, figures.lendRate, figures.lendOpen, lend, filters.strategy, w, lang, choose, onStake, proTop, view, go]);

  /* ── the ticket of the tab ── */

  const frontKey = ticketKey(front);
  const frontRow = front?.kind === 'view' ? rows.find((row) => row.address === front.address) : undefined;
  const proRowOf = (address: string) => proAll?.find((row) => row.address === address) ?? null;
  const ticketBody: ReactNode = front ? (
    front.kind === 'view' ? (
      frontRow ? <ViewTicket row={frontRow} nowMs={nowMs} /> : null
    ) : (
      <>
        <TicketBody ticket={front} figures={figures} owner={owner} onConnect={connect} />
        {/* The city's add to a DLMM Pro pool: the pool's own desk a tap away, for its chart and its limit orders. */}
        {front.kind === 'pro' && view === 'pro' && proRowOf(front.address) ? <ProPoolLink row={proRowOf(front.address)!} /> : null}
      </>
    )
  ) : view === 'pro' && proSel ? (
    <ProPoolTicket key={proSel.address} row={proSel} held={held} />
  ) : null;
  const label = front ? (front.kind === 'view' ? (frontRow?.name ?? '') : ticketName(front, figures)) : view === 'pro' && proSel ? proName(proSel) : '';
  const reading =
    (view === 'pools' && (poolsRead === 'reading' || figures.poolsRead === 'reading')) ||
    (view === 'pro' && proRead.read.status === 'reading') ||
    (view === 'staking' && figures.yieldRead === 'reading' && !stakes.length) ||
    (view === 'lending' && (catalog.status === 'reading' || catalog.status === 'idle') && !lend.length) ||
    (view === 'mine' && figures.positionsRead === 'reading');
  // Where a tab has nothing to act on, its place holds what leads on: a wallet to connect, or a pool to find.
  const sideCard: ReactNode =
    ticketBody || reading ? null : view === 'mine' && figures.positionsRead === 'guest' ? (
      <SideCard title={w.connectTitle} act={w.connect} onAct={connect} />
    ) : view === 'mine' && figures.positionsRead === 'ready' && !figures.positions.length ? (
      <SideCard title={w.connectTitle} act={w.findPool} onAct={() => go('pools')} />
    ) : null;
  const side: ReactNode = ticketBody ? (
    <Panel tone="hi" gap={12} label={label} className={e.hi}>
      {ticketBody}
    </Panel>
  ) : reading ? (
    // Until the tab's first offer is known the ticket's place holds its bones: the list beside it never changes width.
    <Panel tone="hi" pad="none" className={e.hi}>
      <Bones rows={4} />
    </Panel>
  ) : (
    sideCard
  );

  // The ticket stays in sight while the list scrolls — while it fits under the header; a taller one scrolls with the page,
  // so its action is never out of reach.
  const ticketBox = useRef<HTMLDivElement>(null);
  const tall = useTaller(ticketBox, !narrow);
  // A narrow desk stands the ticket under the list: a pick brings it into sight.
  const pickMark = `${pickedKey}|${proAt}`;
  const firstMark = useRef(pickMark);
  useEffect(() => {
    if (pickMark === firstMark.current) return;
    firstMark.current = pickMark;
    if (window.matchMedia('(min-width: 768px) and (max-width: 1199px)').matches) ticketBox.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [pickMark]);

  /* ── the tab's bar and its list ── */

  const visible = all ? shown : shown.slice(0, ROWS_SHOWN);
  const more = shown.length - ROWS_SHOWN;
  const hasPro = rows.some((row) => row.type === 'pro');
  const tabs = [
    { id: 'pools' as const, label: w.tabPools, count: rows.length ? digits(String(shown.length), lang) : undefined },
    { id: 'pro' as const, label: w.tabPro, count: proAll ? digits(String(proActiveCount), lang) : undefined },
    { id: 'staking' as const, label: w.tabStaking, count: stakes.length ? digits(String(stakes.length), lang) : undefined },
    { id: 'lending' as const, label: w.tabLending, count: lendRows.length ? digits(String(lendRows.length), lang) : undefined },
    { id: 'mine' as const, label: narrow ? w.mine : w.positions, count: figures.positions.length ? digits(String(figures.positions.length), lang) : undefined },
  ];

  const bar: ReactNode =
    view === 'pools' ? (
      <FilterBar
        filters={filters}
        onFilters={(next) => {
          setFilters(next);
          setAll(false);
        }}
        sort={sort}
        onSort={setSort}
        more={moreFilters}
        onMore={() => setMoreFilters((was) => !was)}
        every={every}
        columns={
          narrow ? null : (
            <Columns
              value={columnSet}
              onChange={(next) => {
                setColumnSet(next);
                // The order by a column that just left the table goes back to the start.
                if (next === 'main' && (sort.key === 'step' || sort.key === 'base')) setSort(START_SORT);
              }}
              label={frame.columns}
              main={frame.colsMain}
              all={frame.colsAll}
            />
          )
        }
        compact={narrow}
        hasPro={hasPro}
        coins={coins}
      />
    ) : view === 'pro' ? (
      <Bar>
        <span className={cx(p.badge, e.barBadge)}>{q.pro}</span>
        {proAll ? (
          <span className={e.barFigures}>
            <span>{digits(q.pools(proRows.length), lang)}</span>
            {proTotal !== null ? <b>{usdText(proTotal, lang)}</b> : null}
          </span>
        ) : null}
        <Info label={q.title}>{q.listWhy}</Info>
        <span className={e.grow} />
        <span className={e.segBox}>
          <Segment<Which> label={q.which} value={which} onChange={(next) => useKept.setState({ which: next })} items={[{ id: 'deep', label: w.proActive }, { id: 'every', label: q.every }]} />
        </span>
      </Bar>
    ) : view === 'staking' ? (
      <Bar>
        <BarName sign="staking">{w.stakedCoins}</BarName>
        <Info label={w.stakingInfo}>{w.stakingText}</Info>
      </Bar>
    ) : view === 'lending' ? (
      <Bar>
        <BarName sign="lending">{w.lendingVenue}</BarName>
        <Info label={w.lendingInfo}>{w.lendingText}</Info>
      </Bar>
    ) : (
      <Bar>
        <BarName sign="pools">{w.positions}</BarName>
        {figures.positions.length ? <Chip>{digits(String(figures.positions.length), lang)}</Chip> : null}
        <Info label={w.totalsInfo}>{w.totalsText}</Info>
      </Bar>
    );

  const poolsList = (phone: boolean) =>
    poolsRead === 'reading' ? (
      <Bones rows={phone ? 5 : 8} />
    ) : poolsRead === 'failed' ? (
      <Blank line={w.poolsFailed}>
        <Quiet size="s" onClick={() => void useCatalog.getState().load(true)}>
          {w.tryAgain}
        </Quiet>
      </Blank>
    ) : !shown.length ? (
      <Blank line={w.noMatch}>
        <Quiet size="s" onClick={() => setFilters(START_FILTERS)}>
          {w.fReset}
        </Quiet>
      </Blank>
    ) : phone ? (
      <PhoneRows rows={visible} held={held} onPick={onPick} />
    ) : (
      <PoolsTable rows={visible} every={every} sort={sort} onSort={setSort} frontKey={frontKey} held={held} onPick={onPick} nowMs={nowMs} />
    );
  const moreFoot =
    more > 0 && poolsRead === 'ready' ? (
      <div className={e.foot}>
        <Quiet size="s" onClick={() => setAll((was) => !was)}>
          {all ? w.fewer : w.more(digits(String(more), lang))}
        </Quiet>
      </div>
    ) : null;
  const proList = (phone: boolean) =>
    proRead.read.status === 'reading' ? (
      <Bones rows={phone ? 4 : 6} />
    ) : proRead.read.status !== 'ready' ? (
      <Blank line={q.failed}>
        <Quiet size="s" onClick={proRead.again}>
          {q.again}
        </Quiet>
      </Blank>
    ) : !proRows.length ? (
      <Blank line={q.none} />
    ) : phone ? (
      <ProPhoneRows rows={proRows} held={held} adds={proAdds} deepUsd={DEEP_USD} onPick={pickPro} />
    ) : (
      <ProTable rows={proRows} frontKey={proSel ? `pro-pool:${proSel.address}` : null} held={held} adds={proAdds} deepUsd={DEEP_USD} onPick={pickPro} />
    );

  const mainOf = (phone: boolean): ReactNode =>
    view === 'pools' ? (
      phone ? (
        <>
          {poolsList(true)}
          {figures.paused ? <p className={cx(e.hint, e.flush)}>{w.paused}</p> : null}
          {moreFoot}
        </>
      ) : (
        <Panel pad="none" label={w.pools}>
          {poolsList(false)}
          {figures.paused ? <p className={e.hint}>{w.paused}</p> : null}
          {moreFoot}
        </Panel>
      )
    ) : view === 'pro' ? (
      phone ? (
        proList(true)
      ) : (
        <Panel pad="none" label={q.tableLabel}>
          {proList(false)}
        </Panel>
      )
    ) : view === 'staking' ? (
      <StakingList stakes={stakes} facts={stakeFacts} frontKey={frontKey} held={held} reading={figures.yieldRead === 'reading'} onStake={(row) => onStake(row)} phone={phone} />
    ) : view === 'lending' ? (
      <LendingList
        rates={lendRows}
        assetOf={(rate) => LEND_ASSET.get(rate.mint) ?? null}
        frontKey={frontKey}
        held={held}
        reading={catalog.status === 'reading' || catalog.status === 'idle'}
        available={lendAvailable}
        yours={owner ? lendYours : null}
        actsOn={lendActs}
        onLend={onLend}
        phone={phone}
      />
    ) : phone ? (
      <PhoneMine figures={figures} held={held} onConnect={connect} onFind={() => go('pools')} />
    ) : (
      <PositionsPanel figures={figures} frontKey={frontKey} held={held} />
    );

  // One desk for every tab: the head with the section's tabs and the money at work; then the list on the
  // left — the ways to earn, the tab's bar, its table — and the tab's ticket on the right, the whole height. A phone
  // keeps the list in the page and the ticket as the screen's own sheet (`TicketSheet`), which holds while a signature
  // is out.
  return (
    <>
      <PageHead
        title={w.title}
        tabs={<Tabs<View> bare label={w.sections} value={view} onChange={go} items={tabs} />}
        mark={
          figures.positions.length ? (
            <div className={e.totals}>
              <div className={e.total}>
                <Kick>{w.working}</Kick>
                <Figure value={sumText(figures.working, lang)} size="m" />
              </div>
              <div className={e.total}>
                <Kick>{w.earned}</Kick>
                <Figure value={sumText(figures.earned, lang, true)} size="m" tone={resultTone(figures.earned)} />
              </div>
              <Info label={w.totalsInfo}>{w.totalsText}</Info>
            </div>
          ) : null
        }
      />

      <div className={e.desk} data-earn-desk={view}>
        <div className={e.deskMain} data-earn-main="">
          <StrategyCards cards={cards} />
          {bar}
          <div className={cx(e.mainCol, e.desktopOnly)}>{mainOf(false)}</div>
          <div className={cx(e.phoneOnly, e.phoneCol)}>{mainOf(true)}</div>
        </div>
        {narrow ? null : (
          <aside className={e.deskSide} data-earn-side="" aria-label={label || w.title}>
            <div ref={ticketBox} className={e.deskTicket} data-tall={tall || undefined}>
              {side}
            </div>
          </aside>
        )}
      </div>

      {/* A part landed and not read keeps its card open on a phone, whatever closed the sheet: its buttons are the way on. */}
      {narrow && ticketBody && (sheet || held) ? <TicketSheet label={label}>{ticketBody}</TicketSheet> : null}
    </>
  );
}

/** Whether a box is taller than the window under the frame's header: then it does not stick. */
function useTaller(box: RefObject<HTMLElement | null>, on: boolean): boolean {
  const [tall, setTall] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!on || !el) return;
    const measure = () => {
      const top = Number.parseFloat(getComputedStyle(el).getPropertyValue('--top')) || 0;
      setTall(el.offsetHeight > window.innerHeight - top - 32);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      watch.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [box, on]);
  return tall;
}

/** The coins the most pools are made of, for the coin filter's quick choices. */
function topCoins(rows: readonly ChooseRow[]): string[] {
  const count = new Map<string, number>();
  for (const row of rows) for (const coin of row.coins) count.set(coin.symbol, (count.get(coin.symbol) ?? 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 8)
    .map(([symbol]) => symbol);
}

/** A tab's bar over its list: what the list is, how it works behind «i», and the list's own controls on the right. */
function Bar({ children }: { children: ReactNode }) {
  return <div className={e.bar}>{children}</div>;
}

function BarName({ sign, children }: { sign: 'pools' | 'staking' | 'lending'; children: ReactNode }) {
  return (
    <span className={e.barName}>
      <Sign name={sign} />
      <Title as="h2" className={e.barTitle}>
        {children}
      </Title>
    </span>
  );
}

/** The ticket's place where a tab has nothing to act on yet: one line and the one thing that leads on. */
function SideCard({ title, act, onAct }: { title: string; act: string; onAct: () => void }) {
  return (
    <Panel tone="hi" gap={16} className={e.hi} label={title}>
      <Title as="h2" className={e.sideTitle}>
        {title}
      </Title>
      <Action onClick={onAct}>{act}</Action>
    </Panel>
  );
}

function Bones({ rows }: { rows: number }) {
  return (
    <div className={e.bones} aria-busy="true">
      {Array.from({ length: rows }, (_, at) => (
        <span key={at} />
      ))}
    </div>
  );
}

function Blank({ title, line, children }: { title?: string; line: string; children?: ReactNode }) {
  return (
    <div className={e.blank} data-earn-blank="">
      {title ? <span className={e.sym}>{title}</span> : null}
      <p className={e.blankLine}>{line}</p>
      {children}
    </div>
  );
}

/** «My positions» with nothing to list: the section's sign, one line in the page's own voice, and on a phone its one action. */
function MineEmpty({ title, act, onAct }: { title: string; act?: string; onAct?: () => void }) {
  return (
    <div className={e.mineEmpty} data-earn-blank="">
      <span className={e.mineIcon} aria-hidden="true">
        <Sign name="pools" />
      </span>
      <p className={e.mineTitle}>{title}</p>
      {act && onAct ? (
        <Action full={false} onClick={onAct}>
          {act}
        </Action>
      ) : null}
    </div>
  );
}

const KIND_WORD = { pool: 'kindPool', pro: 'kindPool', stake: 'kindStake', lend: 'kindLend' } as const;

/** A position's second line: what it is, and for a pool position out of its range — that. */
function useKindLine(): (row: PositionRow) => string {
  const w = useWords(EARN);
  return (row) => {
    const kind = row.kind === 'pro' ? `${w.kindPool} · ${w.pro}` : w[KIND_WORD[row.kind]];
    return row.inRange === false ? `${kind} · ${w.outOfRange}` : kind;
  };
}

/** What a position's row opens, or null where nothing is offered for it here. */
function positionTicket(row: PositionRow, figures: EarnFigures): Ticket | null {
  if (row.kind === 'pool') return figures.exitOpen ? { kind: 'position', address: row.ref, act: 'claim' } : null;
  if (row.kind === 'pro') {
    const boat = figures.proBoats.find((entry) => entry.nftMint === row.ref);
    return boat ? { kind: 'proPosition', nftMint: row.ref, act: boat.empty ? 'close' : 'collect' } : null;
  }
  if (row.kind === 'lend') return figures.lent.some((position) => position.asset === row.ref) && (row.ref === 'USDC' || row.ref === 'SOL') ? { kind: 'lend', asset: row.ref } : null;
  // Staked SOL: more of it, on the same coin's ticket (back to SOL is a swap — the swap shelf's).
  const stake = figures.stakes.find((entry) => entry.lst.id === row.ref);
  return stake ? { kind: 'stake', lst: stake.lst.id } : null;
}

function openPosition(ticket: Ticket): void {
  if (ticket.kind === 'lend') void pickLending(ticket.asset, 'withdraw', 'mine');
  else void pick(ticket, 'mine');
}

function PositionsPanel({ figures, frontKey, held }: { figures: EarnFigures; frontKey: string | null; held: boolean }) {
  const w = useWords(EARN);
  const lang = useLang();
  const kindLine = useKindLine();
  const rows = figures.positions;
  const head = (
    <TableHead>
      <Cell head>{w.position}</Cell>
      <Cell head end>
        {w.putIn}
      </Cell>
      <Cell head end>
        {w.now}
      </Cell>
      <Cell head end>
        {w.earned}
      </Cell>
      <Cell head />
    </TableHead>
  );
  return (
    <Panel pad="none" label={w.positions}>
      {figures.positionsRead === 'guest' || (figures.positionsRead === 'ready' && !rows.length) ? (
        // The table's own head and one line where its rows will stand; the one action — «Connect wallet», «Find a pool»
        // — is in the ticket's place beside the list.
        <>
          <Table columns={HOLD_COLUMNS} minWidth={640} label={w.positions}>
            {head}
          </Table>
          <MineEmpty title={figures.positionsRead === 'guest' ? w.guestLine : w.emptyTitle} />
        </>
      ) : figures.positionsRead === 'reading' ? (
        <Bones rows={3} />
      ) : figures.positionsRead === 'failed' ? (
        <Blank line={w.positionsFailed}>
          <Quiet size="s" onClick={() => useWallet.getState().refreshHoldings()}>
            {w.tryAgain}
          </Quiet>
        </Blank>
      ) : (
        <Table columns={HOLD_COLUMNS} minWidth={640} label={w.positions}>
          {head}
          {rows.map((row) => {
            const ticket = positionTicket(row, figures);
            return (
              <TableRow key={row.key} current={ticket !== null && frontKey === ticketKey(ticket)}>
                <span role="cell" className={e.cellPair}>
                  <Pair coins={row.coins} />
                  <span className={e.cellWords}>
                    <span className={e.sym}>{row.name}</span>
                    <span className={e.cap}>{kindLine(row)}</span>
                  </span>
                </span>
                <Cell end tone="dim">
                  {sumText(row.investedUsd, lang)}
                </Cell>
                <Cell end>{sumText(row.nowUsd, lang)}</Cell>
                <Cell end tone={resultTone(row.earnedUsd)} className={e.lead}>
                  {sumText(row.earnedUsd, lang, true)}
                </Cell>
                <span role="cell" className={e.cellEnd}>
                  {ticket ? (
                    <Quiet size="s" disabled={held} onClick={() => openPosition(ticket)} className={e.rowAct} data-earn-pick="">
                      {ticket.kind === 'proPosition' && ticket.act === 'close' ? w.close : ticket.kind === 'stake' ? w.addMore : w.take}
                    </Quiet>
                  ) : null}
                </span>
              </TableRow>
            );
          })}
        </Table>
      )}
    </Panel>
  );
}

/* ── the phone: what the wallet has at work ── */

function PhoneMine({ figures, held, onConnect, onFind }: { figures: EarnFigures; held: boolean; onConnect: () => void; onFind: () => void }) {
  const w = useWords(EARN);
  const lang = useLang();
  const kindLine = useKindLine();
  if (figures.positionsRead === 'guest') return <MineEmpty title={w.guestLine} act={w.connect} onAct={onConnect} />;
  if (figures.positionsRead === 'reading') return <Bones rows={3} />;
  if (figures.positionsRead === 'failed') {
    return (
      <Blank line={w.positionsFailed}>
        <Quiet size="s" onClick={() => useWallet.getState().refreshHoldings()}>
          {w.tryAgain}
        </Quiet>
      </Blank>
    );
  }
  if (!figures.positions.length) return <MineEmpty title={w.emptyTitle} act={w.findPool} onAct={onFind} />;
  return (
    <>
      <div className={e.tiles}>
        <Tile label={w.working} value={sumText(figures.working, lang)} />
        <Tile label={w.earned} value={sumText(figures.earned, lang, true)} tone={resultTone(figures.earned)} />
      </div>
      <div className={e.pList}>
        {figures.positions.map((row) => {
          const ticket = positionTicket(row, figures);
          return (
            <div key={row.key} className={e.pRow}>
              <Pair coins={row.coins} />
              <span className={e.pMain}>
                {ticket ? (
                  <button type="button" className={cx(e.sym, e.rowHit)} disabled={held} onClick={() => openPosition(ticket)} data-earn-pick="">
                    {row.name}
                  </button>
                ) : (
                  <span className={e.sym}>{row.name}</span>
                )}
                <span className={e.cap}>{kindLine(row)}</span>
              </span>
              <span className={e.pSide}>
                <span>{sumText(row.nowUsd, lang)}</span>
                <span className={cx(e.cap, resultTone(row.earnedUsd) === 'up' && e.up, resultTone(row.earnedUsd) === 'down' && e.down)}>{sumText(row.earnedUsd, lang, true)}</span>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
