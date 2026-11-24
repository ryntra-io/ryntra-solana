'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useEarnData } from '@/city/lib/earn/store';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useWallet } from '@/city/lib/trade/wallet';
import { Pair } from '@/terminal/earn/bits';
import { useCatalog } from '@/terminal/earn/catalog';
import { TYPE_NAME } from '@/terminal/earn/Chooser';
import { chooseRows, dayUsdText, withProDays, type ChooseRow } from '@/terminal/earn/choose';
import { feeText, resultTone, shortUsd, sumText, type PositionRow } from '@/terminal/earn/rows';
import { TicketBody, useTicketPlaced } from '@/terminal/earn/TicketPanel';
import { ticketKey, useTicket, useTicketHeld, type Ticket } from '@/terminal/earn/ticket';
import { useEarnFigures, useEarnReads, type EarnFigures } from '@/terminal/earn/useReads';
import { ViewTicket } from '@/terminal/earn/ViewTicket';
import { EARN } from '@/terminal/earn/words';
import e from '@/terminal/earn/earn.module.css';
import { useProDays } from '@/terminal/pool/useProTape';
import { openPanel } from '@/terminal/shell/frame';
import { NARROW } from '@/terminal/shell/useNarrow';
import { connectWallet } from '@/terminal/shell/Wallet';
import { Cell, Icon, Quiet, Table, TableHead, TableRow } from '@/terminal/ui';
import { readPools } from '../usePoolLayer';
import { adds, bestPool, coinPools, coinPositions, hasPool, positionTicket, rowTicket } from './earn-here';
import { closeDrawer, openTicket, useEarnHere, useEarnNeed } from './store';
import { EARN_HERE } from './words';
import h from './earn-here.module.css';

/**
 * Buy, give liquidity and leave on one screen: under the coin's
 * chart its pools and the person's own positions in them, and Earn's own ticket in a drawer over the screen. Every
 * figure is Earn's read as Earn reads it (`terminal/earn/useReads.ts`, the catalogue of `/api/v1/earn/pools`), every
 * ticket is Earn's as it stands (`TicketBody`, `ViewTicket`) — the add, the take, the signature and the outcome are the
 * city's stores', untouched. This file only lays them out on the coin's screen.
 */

/** How often the catalogue of pools is read again while the coin's pools are in view. */
const CATALOG_AGAIN_MS = 60_000;

const POOL_COLUMNS = 'minmax(170px, 1.6fr) minmax(64px, 0.6fr) repeat(3, minmax(84px, 1fr)) minmax(92px, auto)';
const MINE_COLUMNS = 'minmax(170px, 1.6fr) repeat(2, minmax(96px, 1fr)) minmax(92px, auto)';

/**
 * Earn's reads, run while the coin's screen draws Earn's figures — a tab of the pools, the drawer — and never else: the
 * city's pools and the wallet's positions (`useEarnReads`), and the catalogue of every Meteora pool. Mounted once by the
 * screen.
 */
export function EarnHereReads() {
  const need = useEarnHere((st) => st.need > 0 || st.open);
  return need ? <Reads /> : null;
}

function Reads() {
  const owner = useWallet((st) => st.connection?.address ?? null);
  useEarnReads(owner);
  useEffect(() => {
    const read = () => {
      if (document.visibilityState === 'visible') void useCatalog.getState().load();
    };
    read();
    const timer = setInterval(read, CATALOG_AGAIN_MS);
    document.addEventListener('visibilitychange', read);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', read);
    };
  }, []);
  return null;
}

type CoinEarn = Readonly<{
  owner: string | null;
  figures: EarnFigures;
  rows: readonly ChooseRow[];
  read: 'reading' | 'ready' | 'failed';
  at: number;
}>;

/** The coin's pools as Earn's chooser lists them — the catalogue, the city's own pools, DLMM Pro — and Earn's figures. */
function useCoinEarn(mint: string): CoinEarn {
  const owner = useWallet((st) => st.connection?.address ?? null);
  const figures = useEarnFigures(owner);
  const catalog = useCatalog();
  const piers = useEarnData((st) => st.piers);
  const harbor = piers.status === 'ready' ? piers.value.pools : null;
  const all = useMemo(
    () => chooseRows({ catalog: catalog.value?.pools ?? [], harbor: harbor ?? [], addOpen: figures.addOpen, proPiers: figures.proPiers, rows: figures.pools }),
    [catalog.value, harbor, figures.addOpen, figures.proPiers, figures.pools],
  );
  const listed = useMemo(() => coinPools(all, mint), [all, mint]);
  // DLMM Pro's day is counted from the program's own trades, pool by pool: only the coin's own are asked.
  const proDays = useProDays(useMemo(() => listed.filter((row) => row.type === 'pro').map((row) => row.address), [listed]));
  const rows = useMemo(() => withProDays(listed, proDays), [listed, proDays]);
  const read = rows.length || (catalog.status === 'ready' && figures.poolsRead !== 'reading') ? 'ready' : catalog.status === 'failed' && figures.poolsRead !== 'reading' ? 'failed' : 'reading';
  return { owner, figures, rows, read, at: catalog.at || 0 };
}

/** A row's kind and fee in a line under its pair: «DLMM · 0.10%», «DAMM v2 · 0.25%». */
function kindLine(row: ChooseRow, lang: ReturnType<typeof useLang>): string {
  return row.feePct === null ? TYPE_NAME[row.type] : `${TYPE_NAME[row.type]} · ${feeText(row.feePct, lang)}`;
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

/** One calm line where a tab has nothing to show, with its one quiet way on. */
function Line({ children }: { children: ReactNode }) {
  return (
    <p className={h.line} role="status">
      {children}
    </p>
  );
}

/**
 * «Pools» under the coin's chart: the coin's pools — DLMM, DLMM Pro, DAMM v2 — the pair, its kind and fee, what it holds,
 * its day's volume and what it paid its liquidity. «Add» opens Earn's own ticket of the pool in the drawer; a pool this
 * screen cannot add to is shown to compare, with its own desk a tap away. `phone` — rows of the phone's own.
 */
export function CoinPools({ mint, sym, phone = false }: { mint: string; sym: string; phone?: boolean }) {
  useEarnNeed();
  const w = useWords(EARN_HERE);
  const ew = useWords(EARN);
  const lang = useLang();
  const { rows, read } = useCoinEarn(mint);
  const front = useFront();
  const open = useEarnHere((st) => st.open);
  const frontKey = open ? ticketKey(front) : null;
  if (read === 'reading') return <Bones rows={phone ? 4 : 3} />;
  if (read === 'failed' && !rows.length) {
    return (
      <Line>
        {w.poolsFailed}
        <Quiet size="s" onClick={() => void useCatalog.getState().load(true)}>
          {w.again}
        </Quiet>
      </Line>
    );
  }
  if (!rows.length) return <Line>{w.noPools(sym)}</Line>;
  const act = (row: ChooseRow) => (
    <Quiet size="s" aria-label={adds(row) ? w.addTo(row.name) : w.viewOf(row.name)} onClick={() => void openTicket(rowTicket(row))} data-earn-here-act={row.act}>
      {adds(row) ? ew.add : ew.view}
    </Quiet>
  );
  if (phone) {
    return (
      <ul className={h.rows} aria-label={w.poolsOf(sym)}>
        {rows.map((row) => (
          <li key={row.key} className={h.row} data-current={frontKey === ticketKey(rowTicket(row)) || undefined}>
            <Pair coins={row.coins} />
            <span className={h.words}>
              <span className={h.name}>{row.name}</span>
              <span className={h.cap}>{kindLine(row, lang)}</span>
            </span>
            <span className={h.side}>
              <span>{shortUsd(row.tvlUsd, lang)}</span>
              <span className={h.cap}>{dayUsdText(row, row.fees24hUsd, lang) || '—'}</span>
            </span>
            {act(row)}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Table columns={POOL_COLUMNS} minWidth={680} label={w.poolsOf(sym)}>
      <TableHead>
        <Cell head>{w.colPool}</Cell>
        <Cell head end>
          {w.colFee}
        </Cell>
        <Cell head end>
          {w.colTvl}
        </Cell>
        <Cell head end>
          {w.colVolume}
        </Cell>
        <Cell head end>
          {w.colFees}
        </Cell>
        <Cell head />
      </TableHead>
      {rows.map((row) => (
        <TableRow key={row.key} current={frontKey === ticketKey(rowTicket(row))}>
          <span role="cell" className={e.cellPair}>
            <Pair coins={row.coins} />
            <span className={e.cellWords}>
              <span className={e.sym}>{row.name}</span>
              <span className={e.cap}>{TYPE_NAME[row.type]}</span>
            </span>
          </span>
          <Cell end>{feeText(row.feePct, lang)}</Cell>
          <Cell end>{shortUsd(row.tvlUsd, lang)}</Cell>
          <Cell end>{dayUsdText(row, row.volume24hUsd, lang) || '—'}</Cell>
          <Cell end>{dayUsdText(row, row.fees24hUsd, lang) || '—'}</Cell>
          <Cell end className={h.act}>
            {act(row)}
          </Cell>
        </TableRow>
      ))}
    </Table>
  );
}

/**
 * «My pools»: the person's pool positions that hold the coin, what each is worth now and what it earned, and «Take» — the
 * same ticket Earn's «My positions» opens. Without a wallet one calm line; the panel offers the tab only with one.
 */
export function CoinPositions({ mint, sym, onPools, phone = false }: { mint: string; sym: string; onPools: () => void; phone?: boolean }) {
  useEarnNeed();
  const w = useWords(EARN_HERE);
  const ew = useWords(EARN);
  const lang = useLang();
  const owner = useWallet((st) => st.connection?.address ?? null);
  const figures = useEarnFigures(owner);
  const front = useFront();
  const open = useEarnHere((st) => st.open);
  const frontKey = open ? ticketKey(front) : null;
  const rows = useMemo(() => coinPositions(figures.positions, mint), [figures.positions, mint]);
  if (figures.positionsRead === 'guest') return <Line>{w.connectForPools}</Line>;
  if (figures.positionsRead === 'reading' && !rows.length) return <Bones rows={2} />;
  if (figures.positionsRead === 'failed' && !rows.length) {
    return (
      <Line>
        {w.mineFailed}
        <Quiet size="s" onClick={() => useWallet.getState().refreshHoldings()}>
          {w.again}
        </Quiet>
      </Line>
    );
  }
  if (!rows.length) {
    return (
      <Line>
        {w.noMine(sym)}
        <Quiet size="s" onClick={onPools}>
          {w.toPools}
        </Quiet>
      </Line>
    );
  }
  const sub = (row: PositionRow) => [row.kind === 'pro' ? ew.pro : ew.kindPool, row.mark ? digits(row.mark, lang) : null, row.inRange === false ? ew.outOfRange : null].filter(Boolean).join(' · ');
  const act = (row: PositionRow) => {
    const ticket = positionTicket(row, figures);
    return ticket ? (
      <Quiet size="s" aria-label={w.takeFrom(row.name)} onClick={() => void openTicket(ticket)} data-earn-here-act="take">
        {ew.take}
      </Quiet>
    ) : null;
  };
  const currentOf = (row: PositionRow) => {
    const ticket = positionTicket(row, figures);
    return ticket !== null && frontKey === ticketKey(ticket);
  };
  if (phone) {
    return (
      <ul className={h.rows} aria-label={w.myPoolsOf(sym)}>
        {rows.map((row) => (
          <li key={row.key} className={h.row} data-current={currentOf(row) || undefined}>
            <Pair coins={row.coins} />
            <span className={h.words}>
              <span className={h.name}>{row.name}</span>
              <span className={h.cap}>{sub(row)}</span>
            </span>
            <span className={h.side}>
              <span>{sumText(row.nowUsd, lang)}</span>
              <span className={h.cap} data-tone={resultTone(row.earnedUsd)}>
                {sumText(row.earnedUsd, lang, true)}
              </span>
            </span>
            {act(row)}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Table columns={MINE_COLUMNS} minWidth={560} label={w.myPoolsOf(sym)}>
      <TableHead>
        <Cell head>{w.colPool}</Cell>
        <Cell head end>
          {w.colNow}
        </Cell>
        <Cell head end>
          {w.colEarned}
        </Cell>
        <Cell head />
      </TableHead>
      {rows.map((row) => (
        <TableRow key={row.key} current={currentOf(row)}>
          <span role="cell" className={e.cellPair}>
            <Pair coins={row.coins} />
            <span className={e.cellWords}>
              <span className={e.sym}>{row.name}</span>
              <span className={e.cap}>{sub(row)}</span>
            </span>
          </span>
          <Cell end>{sumText(row.nowUsd, lang)}</Cell>
          <Cell end tone={resultTone(row.earnedUsd)}>
            {sumText(row.earnedUsd, lang, true)}
          </Cell>
          <Cell end className={h.act}>
            {act(row)}
          </Cell>
        </TableRow>
      ))}
    </Table>
  );
}

/** The ticket Earn has in front, as the drawer shows it. */
function useFront(): Ticket | null {
  return useTicket((st) => st.picked);
}

/**
 * Whether the catalogue of pools names a pool of the coin: «Earn on it» after a buy stands only then. The same read the
 * chart's liquidity takes (`readPools`, kept two minutes for the page).
 */
export function useCoinHasPool(mint: string): boolean {
  const [there, setThere] = useState(false);
  useEffect(() => {
    let live = true;
    setThere(false);
    void readPools().then((pools) => {
      if (live) setThere(hasPool(pools, mint));
    });
    return () => {
      live = false;
    };
  }, [mint]);
  return there;
}

/**
 * The drawer of Earn's ticket over the coin's screen: from the right on a desk, from the bottom on a phone. In it stands
 * exactly what Earn shows for the pick — the pool's add with its one amber action, a position's take or exit, a pool
 * shown to compare. It closes with its control, a tap on the shade or Escape — never while a signature is out. «Earn on
 * it» opens it on the coin before the pools are read: its best pool is put in front as soon as they are.
 */
export function EarnDrawer({ mint, sym }: { mint: string; sym: string }) {
  const open = useEarnHere((st) => st.open);
  if (!open) return null;
  return <Drawer mint={mint} sym={sym} />;
}

function Drawer({ mint, sym }: { mint: string; sym: string }) {
  const w = useWords(EARN_HERE);
  const want = useEarnHere((st) => st.want);
  const held = useTicketHeld();
  const front = useFront();
  const { owner, figures, rows, read, at } = useCoinEarn(mint);
  const sheet = useRef<HTMLDivElement>(null);
  const waiting = want !== null;
  const shown = waiting ? null : front;
  useTicketPlaced(shown);

  // «Earn on it»: once the pools are read, the coin's best pool goes in front — the add where it takes one.
  useEffect(() => {
    if (!want || read === 'reading') return;
    const best = bestPool(rows);
    if (best && openTicket(rowTicket(best))) return;
    useEarnHere.setState({ want: null });
  }, [want, read, rows]);

  const connect = useCallback(() => {
    // A phone's wallet lives in the frame's own sheet: the drawer gives way to it.
    if (window.matchMedia(NARROW).matches) {
      closeDrawer();
      openPanel('sheet');
    }
    connectWallet();
  }, []);

  // The drawer takes the focus as it opens; Escape closes it, Tab walks its own controls; the focus goes back after.
  useEffect(() => {
    const stops = () => Array.from(sheet.current?.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), a[href], input, [tabindex="0"]') ?? []);
    const before = document.activeElement as HTMLElement | null;
    sheet.current?.querySelector<HTMLElement>('[data-earn-here="close"]')?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== 'Tab') return;
      const all = stops();
      if (!all.length) return;
      const at = all.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (at <= 0 ? all.length - 1 : at - 1) : at === all.length - 1 ? 0 : at + 1;
      event.preventDefault();
      all[next]?.focus();
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  const viewRow = shown?.kind === 'view' ? rows.find((row) => row.address === shown.address) : undefined;
  const body: ReactNode = !shown ? (
    read !== 'reading' && !rows.length ? (
      <Line>{w.noPools(sym)}</Line>
    ) : (
      <Bones rows={4} />
    )
  ) : shown.kind === 'view' ? (
    viewRow ? (
      <ViewTicket row={viewRow} nowMs={at || Date.now()} />
    ) : (
      <Bones rows={4} />
    )
  ) : (
    <TicketBody ticket={shown} figures={figures} owner={owner} onConnect={connect} />
  );

  return (
    <>
      <div className={h.scrim} aria-hidden="true" onClick={() => closeDrawer()} />
      <div ref={sheet} className={h.drawer} role="dialog" aria-modal="true" aria-label={w.earnOnCoin(sym)} data-earn-here="drawer">
        <div className={h.bar}>
          <span className={h.barTitle}>{w.poolsOf(sym)}</span>
          <button type="button" className={h.close} data-earn-here="close" aria-label={w.close} disabled={held} onClick={() => closeDrawer()}>
            <Icon name="close" />
          </button>
        </div>
        <div className={h.body}>{body}</div>
      </div>
    </>
  );
}
