'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DOLLAR_MINT, rateText } from '@/city/lib/earn/dollar';
import { DOLLAR_BUSY, useDollar } from '@/city/lib/earn/dollar-store';
import { percentText } from '@/city/lib/earn/lst';
import { PIER_LOCKED, usePier } from '@/city/lib/earn/pier-store';
import { PRO_LOCKED, useProPier } from '@/city/lib/earn/pro-store';
import { SAVER_BUSY, useSaver } from '@/city/lib/earn/saver-store';
import { useEarnData } from '@/city/lib/earn/store';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useWallet } from '@/city/lib/trade/wallet';
import type { EarnLendRate } from '@/lib/earn-pools/model';
import { Cell, Chip, Columns, Figure, Info, Kick, Panel, Quiet, Table, TableHead, TableRow, Tabs, Tile, Title, cx, useColumnSet } from '@/terminal/ui';
import { openPanel } from '../shell/frame';
import { Split } from '../shell/Split';
import { useAskHere } from '../shell/useAskHere';
import { NARROW, useNarrow } from '../shell/useNarrow';
import { connectWallet } from '../shell/Wallet';
import { SHELL } from '../shell/words';
import { Pair, PanelHead } from './bits';
import { useCatalog } from './catalog';
import { FilterBar, PhoneRows, PoolsTable, StrategyCards, type StrategyCard } from './Chooser';
import { START_FILTERS, START_SORT, STRATEGY_SORT, bestStake, chooseRows, dayPctText, filterRows, lendOf, sortRows, strategyFilters, strategyPick, type ChooseRow, type Filters, type Sort, type Strategy } from './choose';
import { resultTone, sumText, type PositionRow, type StakeRow } from './rows';
import { TicketBody, TicketSheet, ticketName, useTicketPlaced } from './TicketPanel';
import { closeSheet, firstOffer, heldForm, pick, pickLending, ticketKey, ticketStands, underWay, useTicket, useTicketHeld, type Ticket } from './ticket';
import { useEarnFigures, useEarnReads, useWidthGivenBack, type EarnFigures } from './useReads';
import { ViewTicket } from './ViewTicket';
import { LendingList, StakingList } from './YieldLists';
import { EARN } from './words';
import e from './earn.module.css';

const HOLD_COLUMNS = 'minmax(180px, 1.6fr) repeat(3, minmax(96px, 1fr)) 120px';
/** Rows a table shows before «more». */
const ROWS_SHOWN = 30;
/** How often the chooser's pools are read again while the screen is in view. */
const CATALOG_AGAIN_MS = 60_000;

type View = 'pools' | 'staking' | 'lending' | 'mine';

/** Lending that opens the city's own ticket here: USDC and SOL on Jupiter Lend. */
const LEND_ASSET: ReadonlyMap<string, 'USDC' | 'SOL'> = new Map([
  [DOLLAR_MINT.USDC, 'USDC'],
  [DOLLAR_MINT.SOL, 'SOL'],
]);

/**
 * The Earn screen: every Meteora pool the engine reads — DLMM and DAMM v2, and DLMM Pro
 * where it is served — to choose from by type, coin, depth, volume, fees and fees to TVL, in the order a person asks;
 * ready strategies; staking and lending with their rates; and what the wallet has at work. «Columns» adds the price step,
 * the base fee and age to the table; the rare filters open with «+ Filters». One ticket for the one thing the person acts on: the city's own flows as
 * they stand, or a pool's own figures where adding from here is not built yet.
 */
export function EarnScreen() {
  const w = useWords(EARN);
  const lang = useLang();
  const owner = useWallet((st) => st.connection?.address ?? null);
  useEarnReads(owner);
  useWidthGivenBack();
  const figures = useEarnFigures(owner);
  const narrow = useNarrow();
  const picked = useTicket((st) => st.picked);
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
  const dollarBusy = useDollar((st) => DOLLAR_BUSY.has(st.phase));
  const dollarAsset = useDollar((st) => st.asset);
  const piers = useEarnData((st) => st.piers);
  const catalog = useCatalog();
  // Density is the table's own choice: «Columns» — the main ones or all of them — remembered by the browser;
  // the rare filters open with «+ Filters» and stay open while one of them is set. A phone has its own list.
  const [columnSet, setColumnSet] = useColumnSet('earn');
  const every = columnSet === 'all' && !narrow;
  const [moreFilters, setMoreFilters] = useState(false);
  const frame = useWords(SHELL);
  const [view, setView] = useState<View>('pools');
  const [filters, setFilters] = useState<Filters>(START_FILTERS);
  const [sort, setSort] = useState<Sort>(START_SORT);
  const [all, setAll] = useState(false);
  const [nowMs, setNowMs] = useState(() => useCatalog.getState().at);

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

  // While the pools are being read nothing is offered yet: the ticket appears once, on the right thing, and stays.
  const offer = useMemo(
    () => (figures.poolsRead === 'reading' ? null : firstOffer({ pools: figures.pools, addOpen: figures.addOpen, stakes: figures.stakes, lendOpen: figures.lendOpen })),
    [figures.poolsRead, figures.pools, figures.addOpen, figures.stakes, figures.lendOpen],
  );
  // A pool shown to compare stands while it is listed and still only compared: once it takes a deposit, the add's own ticket does.
  const listedRow = useCallback((address: string) => rows.some((row) => row.address === address && row.act === 'view'), [rows]);
  const stands = picked !== null && ticketStands(picked, figures, { boat: keptBoat, proBoat: keptPro, pool: keptPool, proPool: keptProPool }, listedRow);
  const state = {
    pier: { pool: pierPool, boat: keptBoat, locked: pierLocked, outcome: pierOutcome, act: pierAct },
    pro: { pier: proPier, boat: keptPro, locked: proLocked, outcome: proOutcome, act: proAct },
    saver: { busy: saverBusy, lst: saverLst },
    dollar: { busy: dollarBusy, asset: dollarAsset },
  };
  // A pool the form may stay on: listed, and still offering an add to this wallet (a wallet the add is closed to gets the offer).
  const listed = (kind: 'pool' | 'pro', address: string) => figures.pools.some((row) => row.kind === kind && row.address === address && row.takes && (row.kind === 'pro' || figures.addOpen));
  // A signature in progress, or a part landed and not read, stands in front first; then what the person picked; then the
  // form the store already holds; then the first offer.
  const front: Ticket | null = underWay(state) ?? (stands ? picked : null) ?? heldForm(state, listed) ?? offer;
  useTicketPlaced(front);
  // A picked thing that is gone — another wallet, a position left — gives way to the first offer.
  const pickedKey = ticketKey(picked);
  useEffect(() => {
    if (picked && !stands && !held) useTicket.setState({ picked: null, sheet: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedKey, stands, held]);
  // Leaving the screen puts the phone's sheet away.
  useEffect(() => () => void useTicket.setState({ sheet: false }), []);

  // A sentence for the agent that leads here: lending opens on the coin, the side and the amount said.
  useAskHere((ask) => {
    if (ask.command.kind !== 'dollar') return;
    const said = ask.command.ask;
    if (pickLending(said.asset, said.side)) useDollar.getState().fromAsk(said);
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
    void pick(row.act === 'add' ? { kind: 'pool', address: row.address } : row.act === 'pro' ? { kind: 'pro', address: row.address } : { kind: 'view', address: row.address });
  }, []);
  const onStake = useCallback((row: StakeRow) => void pick({ kind: 'stake', lst: row.lst.id }), []);
  const lendActs = useCallback((rate: EarnLendRate) => figures.lendOpen && LEND_ASSET.has(rate.mint), [figures.lendOpen]);
  const onLend = useCallback(
    (rate: EarnLendRate) => {
      const asset = LEND_ASSET.get(rate.mint);
      if (asset && figures.lendOpen) void pickLending(asset, 'deposit');
      else setView('lending');
    },
    [figures.lendOpen],
  );
  const choose = useCallback(
    (strategy: Strategy, row: ChooseRow | null) => {
      setFilters(strategyFilters(strategy));
      setSort(STRATEGY_SORT[strategy]);
      setAll(false);
      setView('pools');
      if (row) onPick(row);
    },
    [onPick],
  );

  const cards = useMemo<StrategyCard[]>(() => {
    const out: StrategyCard[] = [];
    for (const strategy of ['stable', 'high'] as const) {
      const row = strategyPick(rows, strategy);
      if (!row) continue;
      out.push({
        id: strategy,
        title: strategy === 'stable' ? w.sStable : w.sHigh,
        line: strategy === 'stable' ? w.sStableLine(row.name) : w.sHighLine(row.name),
        figure: w.perDay(dayPctText(row.feeTvlPct, lang)),
        on: filters.strategy === strategy,
        act: () => choose(strategy, row),
      });
    }
    const stake = bestStake(figures.stakes);
    if (stake) out.push({ id: 'hold', title: w.sHold, line: w.sHoldLine(stake.lst.symbol), figure: w.perYear(digits(percentText(stake.apyPct), lang)), on: false, act: () => onStake(stake) });
    const usdcRate = lendOf(lend, 'USDC')?.ratePct ?? figures.lendRate;
    if (usdcRate !== null) {
      out.push({
        id: 'lend',
        title: w.sLend('USDC'),
        line: w.sLendLine,
        figure: w.perYear(digits(rateText(usdcRate), lang)),
        on: false,
        act: () => (figures.lendOpen ? void pickLending('USDC', 'deposit') : setView('lending')),
      });
    }
    return out;
  }, [rows, figures.stakes, figures.lendRate, figures.lendOpen, lend, filters.strategy, w, lang, choose, onStake]);

  const frontKey = ticketKey(front);
  const frontRow = front?.kind === 'view' ? rows.find((row) => row.address === front.address) : undefined;
  const body = !front ? null : front.kind === 'view' ? frontRow ? <ViewTicket row={frontRow} nowMs={nowMs} /> : null : <TicketBody ticket={front} figures={figures} owner={owner} onConnect={connect} />;
  const label = !front ? '' : front.kind === 'view' ? (frontRow?.name ?? '') : ticketName(front, figures);
  const visible = all ? shown : shown.slice(0, ROWS_SHOWN);
  const more = shown.length - ROWS_SHOWN;
  const hasPro = rows.some((row) => row.type === 'pro');
  const tabs = [
    { id: 'pools' as const, label: w.tabPools, count: rows.length ? digits(String(shown.length), lang) : undefined },
    { id: 'staking' as const, label: w.tabStaking, count: figures.stakes.length ? String(figures.stakes.length) : undefined },
    { id: 'lending' as const, label: w.tabLending, count: lend.length ? digits(String(lend.length), lang) : undefined },
    { id: 'mine' as const, label: narrow ? w.mine : w.positions, count: figures.positions.length ? String(figures.positions.length) : undefined },
  ];

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
    ) : view === 'staking' ? (
      <StakingList stakes={figures.stakes} frontKey={frontKey} held={held} reading={figures.yieldRead === 'reading'} onStake={onStake} phone={phone} />
    ) : view === 'lending' ? (
      <LendingList rates={lend} assetOf={(rate) => LEND_ASSET.get(rate.mint) ?? null} frontKey={frontKey} held={held} reading={catalog.status === 'reading' || catalog.status === 'idle'} actsOn={lendActs} onLend={onLend} phone={phone} />
    ) : phone ? (
      <PhoneMine figures={figures} held={held} onConnect={connect} />
    ) : (
      <PositionsPanel figures={figures} frontKey={frontKey} held={held} onConnect={connect} />
    );

  return (
    <>
      <div className={e.head}>
        <Title>{w.title}</Title>
        <Tabs<View> label={w.sections} value={view} onChange={setView} items={tabs} className={cx(e.viewTabs, e.desktopOnly)} />
        <div className={e.grow} />
        {figures.positions.length ? (
          <div className={cx(e.totals, e.desktopOnly)}>
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
        ) : null}
      </div>

      <div className={cx(e.tabsRow, e.phoneOnly)}>
        <Tabs<View> fill label={w.sections} value={view} onChange={setView} items={tabs} />
      </div>

      {view === 'pools' ? <StrategyCards cards={cards} /> : null}
      {view === 'pools' ? (
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
      ) : null}

      {/* The ticket in the terminal's side column: dragged, folded, remembered. On a phone the list stays in the
          page and the ticket is the screen's own sheet (`TicketSheet`), which holds while a signature is out. */}
      <Split
        id="earn"
        label={label || w.title}
        phone="stack"
        side={
          narrow ? null : front ? (
            <Panel tone="hi" gap={12} label={label} className={e.hi}>
              {body}
            </Panel>
          ) : poolsRead === 'reading' ? (
            <Panel tone="hi" pad="none" className={e.hi}>
              <Bones rows={4} />
            </Panel>
          ) : null
        }
      >
        <div className={cx(e.mainCol, e.desktopOnly)}>{mainOf(false)}</div>
        <div className={cx(e.phoneOnly, e.phoneCol)}>{mainOf(true)}</div>
      </Split>

      {/* A part landed and not read keeps its card open on a phone, whatever closed the sheet: its buttons are the way on. */}
      {narrow && front && (sheet || held) ? <TicketSheet label={label}>{body}</TicketSheet> : null}
    </>
  );
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
    <div className={e.blank}>
      {title ? <span className={e.sym}>{title}</span> : null}
      <p className={e.blankLine}>{line}</p>
      {children}
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
  if (ticket.kind === 'lend') void pickLending(ticket.asset, 'withdraw');
  else void pick(ticket);
}

function PositionsPanel({ figures, frontKey, held, onConnect }: { figures: EarnFigures; frontKey: string | null; held: boolean; onConnect: () => void }) {
  const w = useWords(EARN);
  const lang = useLang();
  const kindLine = useKindLine();
  const rows = figures.positions;
  return (
    <Panel pad="none" label={w.positions}>
      <PanelHead title={w.positions} extra={rows.length ? <Chip>{String(rows.length)}</Chip> : null} />
      {figures.positionsRead === 'guest' ? (
        <Blank line={w.guestLine}>
          <Quiet size="s" onClick={onConnect}>
            {w.connect}
          </Quiet>
        </Blank>
      ) : figures.positionsRead === 'reading' ? (
        <Bones rows={2} />
      ) : figures.positionsRead === 'failed' ? (
        <Blank line={w.positionsFailed}>
          <Quiet size="s" onClick={() => useWallet.getState().refreshHoldings()}>
            {w.tryAgain}
          </Quiet>
        </Blank>
      ) : !rows.length ? (
        <Blank title={w.emptyTitle} line={w.emptyLine} />
      ) : (
        <Table columns={HOLD_COLUMNS} minWidth={640} label={w.positions}>
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
          {rows.map((row) => {
            const ticket = positionTicket(row, figures);
            return (
              <TableRow key={row.key} current={ticket !== null && frontKey === ticketKey(ticket) && ticket.kind !== 'lend'}>
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
                <Cell end tone={resultTone(row.earnedUsd)}>
                  {sumText(row.earnedUsd, lang, true)}
                </Cell>
                <span role="cell" className={e.cellEnd}>
                  {ticket ? (
                    <Quiet size="s" disabled={held} onClick={() => openPosition(ticket)}>
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

function PhoneMine({ figures, held, onConnect }: { figures: EarnFigures; held: boolean; onConnect: () => void }) {
  const w = useWords(EARN);
  const lang = useLang();
  const kindLine = useKindLine();
  if (figures.positionsRead === 'guest') {
    return (
      <Blank line={w.guestLine}>
        <Quiet onClick={onConnect}>{w.connect}</Quiet>
      </Blank>
    );
  }
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
  if (!figures.positions.length) return <Blank title={w.emptyTitle} line={w.emptyLine} />;
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
                  <button type="button" className={cx(e.sym, e.rowHit)} disabled={held} onClick={() => openPosition(ticket)}>
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
