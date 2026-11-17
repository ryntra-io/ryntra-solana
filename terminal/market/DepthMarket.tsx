'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { fieldText } from '@/city/lib/i18n/figures';
import { useLang, type Lang } from '@/city/lib/i18n/lang';
import type { Tower } from '@/city/lib/market/types';
import { useTrade } from '@/city/lib/trade/store';
import { SOL } from '@/city/lib/trade/tiles';
import type { DepthCoin, DepthList, DepthWindow } from '@/lib/market-depth/model';
import { Ticket, TICKET_OPEN } from '@/terminal/coin/Ticket';
import { useDismiss } from '@/terminal/shell/useDismiss';
import { coinHref } from '@/terminal/shell/shelves';
import { openSide } from '@/terminal/shell/side';
import { Split } from '@/terminal/shell/Split';
import { useMarket } from '@/terminal/shell/useMarket';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { SHELL } from '@/terminal/shell/words';
import { CoinLogo, Columns, Icon, Search, Switch, changeText, changeTone, coinIcon, priceText, usdText, useColumnSet } from '@/terminal/ui';
import {
  AGES,
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  LISTS,
  QUICK_SOL,
  STEPS,
  WAYS,
  WINDOWS,
  ageMs,
  ageParts,
  buyShare,
  changeOf,
  countText,
  dayLine,
  depthRows,
  filtersOn,
  fitColumns,
  timePath,
  nextSort,
  passes,
  statsOf,
  volumeOf,
  type AgeBound,
  type Filters,
  type Sort,
  type SortKey,
  type Way,
} from './depth-view';
import { setFilters, setList, setQuick, setWindow, startPrefs, useDepth, useDepthAhead, useDepthRead } from './depth';
import { DEPTH, UNIT_WORD } from './depth-words';
import { startSaved, toggleSaved, useSaved } from './saved';
import d from './depth.module.css';

type W = (typeof DEPTH)['en'];

const WINDOW_WORD: Readonly<Record<DepthWindow, 'w5m' | 'w1h' | 'w6h' | 'w24h'>> = { '5m': 'w5m', '1h': 'w1h', '6h': 'w6h', '24h': 'w24h' };

/** A row the pointer rests on this long becomes the side ticket's coin. */
const PICK_REST_MS = 450;

/** The coins the Pro strip names over the table, when the market read has them. */
const STRIP = ['SOL', 'JUP', 'BONK', 'WIF', 'PUMP'] as const;

const moneyOr = (value: number | null, lang: Lang) => (value === null ? '—' : usdText(value, lang));
const moveOr = (value: number | null, lang: Lang) => (value === null ? '—' : changeText(value, lang));

/**
 * The Market's depth (macket v2 «A + Pro from B»): the lists a trader opens first, filters, the window a move
 * is read over, every coin's age, holders and the mint and freeze rights, a quick buy of a ready sum on the same ticket
 * the coin's screen carries, and the star. «Pro» adds the density of B: every window side by side, market cap,
 * liquidity, buys and sells, traders, and a strip of the market's figures on top. Every figure is the engine's.
 */
export function DepthMarket({ towers }: { towers: readonly Tower[] }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  const narrow = useNarrow();
  const live = useMarket().source === 'live';
  const list = useDepth((st) => st.list);
  const window = useDepth((st) => st.window);
  const filters = useDepth((st) => st.filters);
  const quick = useDepth((st) => st.quick);
  // Density is the table's own choice: «Columns» — the main ones or all of them — remembered by the browser.
  // A phone has its own list.
  const [columnSet, setColumnSet] = useColumnSet('market');
  const all = columnSet === 'all' && !narrow;
  const frame = useWords(SHELL);
  const savedMints = useSaved((st) => st.mints);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [picked, setPicked] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    startPrefs();
    return startSaved();
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const savedList = useMemo(() => [...savedMints].reverse().slice(0, 50), [savedMints]);
  const read = useDepthRead(list, window, list === 'saved' ? savedList : []);
  useDepthAhead(LISTS, window);
  const reads = useDepth((st) => st.reads);

  const view = useMemo(() => ({ filters: list === 'saved' ? { ...filters, verified: false } : filters, window, sort, query, now }), [filters, window, sort, query, now, list]);
  const rows = useMemo(() => depthRows(read.coins, view), [read.coins, view]);
  const counts = useMemo(() => {
    const out: Partial<Record<DepthList, number>> = {};
    for (const l of LISTS) {
      const r = reads[`${l}:${window}`];
      if (r?.status === 'ready') out[l] = r.coins.filter((coin) => passes(coin, filters, window, now)).length;
    }
    return out;
  }, [reads, window, filters, now]);

  const coin = rows.find((row) => row.id === picked) ?? read.coins.find((row) => row.id === picked) ?? rows[0] ?? null;
  const first = rows[0]?.id ?? null;
  useEffect(() => {
    if (picked === null && first !== null) setPicked(first);
  }, [picked, first]);

  const rest = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<{ mint: string; sum: string } | null>(null);
  // A resting pointer picks the ticket's coin only while the ticket rests: never under a trade, never while the person
  // is in the ticket's fields, and a quick buy waiting for another coin is let go.
  const pick = useCallback((mint: string, at: 'now' | 'rest') => {
    clearTimeout(rest.current);
    const take = () => {
      const busy = useTrade.getState().phase !== 'idle' || Boolean(document.activeElement?.closest('[data-terminal="ticket-side"]'));
      if (at === 'rest' && busy) return;
      if (pending.current && pending.current.mint !== mint) pending.current = null;
      setPicked(mint);
    };
    if (at === 'now') take();
    else rest.current = setTimeout(take, PICK_REST_MS);
  }, []);
  const leave = useCallback(() => clearTimeout(rest.current), []);
  useEffect(() => () => clearTimeout(rest.current), []);

  // A quick buy: the ticket takes the coin, then the ready sum in SOL once it stands on it.
  useEffect(
    () =>
      useTrade.subscribe((st) => {
        const want = pending.current;
        if (!want || !st.open || st.tower?.mint !== want.mint || st.phase !== 'idle') return;
        pending.current = null;
        if (st.side !== 'buy') st.setSide('buy');
        useTrade.getState().setPay(SOL.symbol);
        useTrade.getState().setTyped(fieldText(want.sum, lang));
      }),
    [lang],
  );
  const quickBuy = (target: DepthCoin) => {
    pending.current = { mint: target.id, sum: quick };
    setPicked(target.id);
    if (narrow) openSide('ticket');
    const st = useTrade.getState();
    if (st.open && st.tower?.mint === target.id && st.phase === 'idle') {
      pending.current = null;
      if (st.side !== 'buy') st.setSide('buy');
      useTrade.getState().setPay(SOL.symbol);
      useTrade.getState().setTyped(fieldText(quick, lang));
    }
  };

  const changeList = (next: DepthList | 'saved') => {
    pending.current = null;
    setList(list === next && next === 'saved' ? 'trending' : next);
    setPicked(null);
    setSort(DEFAULT_SORT);
  };

  const none =
    read.status === 'reading' && !read.coins.length
      ? w.reading
      : read.status === 'failed'
        ? w.failed
        : !rows.length
          ? list === 'saved' && !savedList.length
            ? w.noSaved
            : w.none
          : null;
  // New coins are rarely verified yet: the empty list says why, and one tap shows them all.
  const verifiedHides = !rows.length && filters.verified && list !== 'saved' && read.coins.some((c) => !c.verified);

  const tickerCoin = coin ? { id: coin.id, symbol: coin.symbol, name: coin.name, icon: coinIcon(coin) } : null;

  return (
    <section className={d.root} aria-label={w.market} data-terminal="depth">
      {!narrow && live ? <Strip towers={towers} /> : null}

      <div className={d.lists}>
        <h2 className={d.marketTitle}>{w.market}</h2>
        <div className={d.listTabs} role="tablist" aria-label={w.lists}>
          {LISTS.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={list === id} className={d.listTab} onClick={() => changeList(id)}>
              {w[id]}
              {counts[id] !== undefined && !narrow ? <span className={d.count}>{digits(String(counts[id]), lang)}</span> : null}
            </button>
          ))}
        </div>
        <span className={d.grow} />
        <button type="button" className={d.iconBtn} aria-label={w.saved} aria-pressed={list === 'saved'} onClick={() => changeList('saved')}>
          <Icon name="star" />
        </button>
        <button type="button" className={d.iconBtn} aria-label={w.coin} aria-expanded={searching} onClick={() => setSearching((was) => !was)}>
          <Icon name="search" />
        </button>
        {searching ? (
          <div className={d.searchRow}>
            <Search value={query} onChange={setQuery} placeholder={w.coin} />
          </div>
        ) : null}
      </div>

      <div className={d.bar}>
        <FiltersButton filters={filters} />
        {narrow ? null : <FilterChips filters={filters} />}
        <span className={d.grow} />
        {narrow ? null : (
          <Columns
            value={columnSet}
            onChange={setColumnSet}
            label={frame.columns}
            main={frame.colsMain}
            all={frame.colsAll}
          />
        )}
        <div className={d.windows} role="radiogroup" aria-label={w.windows}>
          {WINDOWS.map((id) => (
            <button key={id} type="button" role="radio" aria-checked={window === id} className={d.window} onClick={() => setWindow(id)}>
              {w[WINDOW_WORD[id]]}
            </button>
          ))}
        </div>
        {narrow || !TICKET_OPEN ? null : <QuickPick />}
      </div>

      {TICKET_OPEN && tickerCoin && coin ? (
        <Split
          id="ticket"
          sheetStart="folded"
          label={w.ticket}
          side={
            <div className={d.side} data-terminal="ticket-side">
              <Ticket coin={tickerCoin} head={<TicketHead coin={coin} />} lean={narrow} />
              {narrow ? null : <CoinFacts coin={coin} now={now} />}
            </div>
          }
          peek={<TicketPeek coin={coin} />}
        >
          <div className={d.table}>
            {narrow ? (
              <PhoneRows rows={rows} window={window} now={now} quick={quick} onQuick={quickBuy} />
            ) : (
              <DeskTable rows={rows} window={window} now={now} all={all} sort={sort} onSort={setSort} picked={coin?.id ?? null} onPick={pick} onLeave={leave} quick={quick} onQuick={quickBuy} />
            )}
            {none ? (
              <div className={d.none} role="status">
                <span>{verifiedHides ? w.noneVerified : none}</span>
                {verifiedHides ? (
                  <button type="button" className={d.noneBtn} onClick={() => setFilters({ ...filters, verified: false })}>
                    {w.showAll}
                  </button>
                ) : filtersOn(filters) && read.coins.length ? (
                  <button type="button" className={d.noneBtn} onClick={() => setFilters(DEFAULT_FILTERS)}>
                    {w.reset}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </Split>
      ) : (
        <div className={d.table}>
          {narrow ? (
            <PhoneRows rows={rows} window={window} now={now} quick={quick} onQuick={quickBuy} />
          ) : (
            <DeskTable rows={rows} window={window} now={now} all={all} sort={sort} onSort={setSort} picked={coin?.id ?? null} onPick={pick} onLeave={leave} quick={quick} onQuick={quickBuy} />
          )}
          {none ? (
            <div className={d.none} role="status">
              <span>{verifiedHides ? w.noneVerified : none}</span>
              {verifiedHides ? (
                <button type="button" className={d.noneBtn} onClick={() => setFilters({ ...filters, verified: false })}>
                  {w.showAll}
                </button>
              ) : filtersOn(filters) && read.coins.length ? (
                <button type="button" className={d.noneBtn} onClick={() => setFilters(DEFAULT_FILTERS)}>
                  {w.reset}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** The folded sheet's bar on a phone: the coin and its price. */
function TicketPeek({ coin }: { coin: DepthCoin }) {
  const lang = useLang();
  return (
    <span className={d.peek}>
      <CoinLogo src={coinIcon(coin)} symbol={coin.symbol} size="s" />
      <b>{coin.symbol}</b>
      <span>{coin.price === null ? '—' : priceText(coin.price, lang)}</span>
    </span>
  );
}

/** The coin over the side ticket: its logo, ticker, name, price and back to its own screen. */
function TicketHead({ coin }: { coin: DepthCoin }) {
  const lang = useLang();
  const price = coin.price === null ? '—' : priceText(coin.price, lang);
  return (
    <div className={d.ticketHead}>
      <CoinLogo src={coinIcon(coin)} symbol={coin.symbol} size="l" />
      <span className={d.ticketWords}>
        <span className={d.ticketSym}>{coin.symbol}</span>
        <span className={d.ticketName}>{coin.name}</span>
      </span>
      <b className={d.ticketPrice} data-long={price.length > 9 ? '' : undefined}>
        {price}
      </b>
      <Link className={d.iconBtn} href={coinHref(coin.id, 'live')} aria-label={coin.symbol}>
        <Icon name="expand" size="s" />
      </Link>
    </div>
  );
}

/** Holders, age and liquidity of the side ticket's coin, as tiles. */
function CoinFacts({ coin, now }: { coin: DepthCoin; now: number }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  const age = ageMs(coin, now);
  return (
    <div className={d.facts}>
      <span className={d.fact}>
        <span className={d.factWord}>{w.holders}</span>
        <span className={d.factValue}>{countText(coin.holders, lang)}</span>
      </span>
      <span className={d.fact}>
        <span className={d.factWord}>{w.age}</span>
        <span className={d.factValue}>{age === null ? '—' : <AgeText ms={age} />}</span>
      </span>
      <span className={d.fact}>
        <span className={d.factWord}>{w.liquidity}</span>
        <span className={d.factValue}>{moneyOr(coin.liquidity, lang)}</span>
      </span>
    </div>
  );
}

function AgeText({ ms }: { ms: number }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  const { n, unit } = ageParts(ms);
  return <>{digits(`${n} ${w[UNIT_WORD[unit]]}`, lang)}</>;
}

/** «M» and «F» (in Ukrainian «М» and «З»): mint and freeze rights — mint when given up, flare when kept. */
function Rights({ coin }: { coin: DepthCoin }) {
  const w = useWords(DEPTH);
  if (coin.mint === null && coin.freeze === null) return <span className={d.dim}>—</span>;
  return (
    <span className={d.rights}>
      {coin.mint !== null ? (
        <span className={d.right} data-on={coin.mint === 'on' ? '' : undefined} title={coin.mint === 'on' ? w.mintOn : w.mintOff} aria-label={coin.mint === 'on' ? w.mintOn : w.mintOff}>
          {w.riskM}
        </span>
      ) : null}
      {coin.freeze !== null ? (
        <span className={d.right} data-on={coin.freeze === 'on' ? '' : undefined} title={coin.freeze === 'on' ? w.freezeOn : w.freezeOff} aria-label={coin.freeze === 'on' ? w.freezeOn : w.freezeOff}>
          {w.riskF}
        </span>
      ) : null}
    </span>
  );
}

const Zap = () => (
  <svg className={d.zap} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z" />
  </svg>
);

function QuickButton({ coin, sum, onQuick, wide = false }: { coin: DepthCoin; sum: string; onQuick: (coin: DepthCoin) => void; wide?: boolean }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  return (
    <button
      type="button"
      className={d.quick}
      data-wide={wide ? '' : undefined}
      aria-label={w.quickBuy(fieldText(sum, lang), coin.symbol)}
      onClick={() => onQuick(coin)}
    >
      <Zap />
      {wide ? <span>{fieldText(sum, lang)}</span> : null}
    </button>
  );
}

function Star({ coin }: { coin: DepthCoin }) {
  const w = useWords(DEPTH);
  const on = useSaved((st) => st.mints.includes(coin.id));
  return (
    <button
      type="button"
      className={d.star}
      aria-pressed={on}
      aria-label={on ? w.unstar(coin.symbol) : w.star(coin.symbol)}
      onClick={() => toggleSaved(coin.id)}
    >
      <Icon name="star" size="s" />
    </button>
  );
}

/** The day's line through the four moves Jupiter measured; the tone of the day's move. */
function DayLine({ coin }: { coin: DepthCoin }) {
  const points = dayLine(coin);
  if (!points) return <span className={d.dim}>—</span>;
  const change = changeOf(coin, '24h') ?? 0;
  return (
    <svg className={d.line} viewBox="0 0 96 28" data-tone={changeTone(change)} aria-hidden="true">
      <path d={timePath(points, 96, 28, 3)} />
    </svg>
  );
}

function CoinWords({ coin, now, holders = false }: { coin: DepthCoin; now: number; holders?: boolean }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  const age = ageMs(coin, now);
  return (
    <span className={d.coin}>
      <CoinLogo src={coinIcon(coin)} symbol={coin.symbol} size="m" />
      <span className={d.coinWords}>
        <span className={d.coinSym}>
          <span className={d.sym}>{coin.symbol}</span>
          {coin.verified ? (
            <span className={d.check} title={w.verified}>
              <Icon name="check" size="s" />
            </span>
          ) : null}
        </span>
        <span className={d.coinSub}>
          {age === null ? null : <AgeText ms={age} />}
          {holders && coin.holders !== null ? (
            <>
              {age === null ? null : ' · '}
              {w.holdersShort(countText(coin.holders, lang))}
            </>
          ) : null}
        </span>
      </span>
    </span>
  );
}

type Column = Readonly<{
  id: string;
  key: SortKey | null;
  head: ReactNode;
  /** The least width it needs, px, and how it grows. */
  min: number;
  grow: number;
  /** Lower stands first: a narrow table drops the highest numbers. */
  rank: number;
  cell: (coin: DepthCoin) => ReactNode;
  end?: boolean;
  tone?: (coin: DepthCoin) => 'up' | 'down' | undefined;
}>;

/** The table's own width, followed as the window or the panels change. */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const take = () => setWidth(el.clientWidth);
    take();
    const seen = new ResizeObserver(take);
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  return [ref, width];
}

function DeskTable({
  rows,
  window,
  now,
  all: every,
  sort,
  onSort,
  picked,
  onPick,
  onLeave,
  quick,
  onQuick,
}: {
  rows: readonly DepthCoin[];
  window: DepthWindow;
  now: number;
  /** Every column, or the main ones. */
  all: boolean;
  sort: Sort;
  onSort: (sort: Sort) => void;
  picked: string | null;
  onPick: (mint: string, at: 'now' | 'rest') => void;
  onLeave: () => void;
  quick: string;
  onQuick: (coin: DepthCoin) => void;
}) {
  const w = useWords(DEPTH);
  const lang = useLang();
  const [box, width] = useWidth<HTMLDivElement>();
  const move = (win: DepthWindow, rank: number): Column => ({
    id: `move-${win}`,
    key: `change${win}` as SortKey,
    head: w[WINDOW_WORD[win]],
    min: 58,
    grow: 0.7,
    rank,
    end: true,
    cell: (coin) => moveOr(changeOf(coin, win), lang),
    tone: (coin) => {
      const change = changeOf(coin, win);
      return change === null ? undefined : changeTone(change);
    },
  });
  // The window the person picked stands right after the price; every column adds the other windows.
  const moves = every
    ? WINDOWS.map((win) => move(win, win === window ? 2 : win === '24h' ? 3 : win === '5m' ? 6 : win === '1h' ? 6.5 : 11))
    : window === '24h'
      ? [move('24h', 2)]
      : [move(window, 2), move('24h', 3)];
  const all: Column[] = [
    {
      id: 'coin',
      key: 'symbol',
      head: w.coinAge,
      min: 150,
      grow: 1.8,
      rank: 0,
      cell: (coin) => (
        <Link className={d.rowLink} href={coinHref(coin.id, 'live')}>
          <CoinWords coin={coin} now={now} />
        </Link>
      ),
    },
    { id: 'price', key: 'price', head: w.price, min: 88, grow: 1, rank: 1, end: true, cell: (coin) => <b className={d.price}>{coin.price === null ? '—' : priceText(coin.price, lang)}</b> },
    ...moves,
    ...(every ? [] : [{ id: 'day', key: null, head: w.day, min: 96, grow: 0.9, rank: 9, end: true, cell: (coin: DepthCoin) => <DayLine coin={coin} /> }]),
    { id: 'volume', key: 'volume', head: w.volume, min: 66, grow: 0.9, rank: every ? 4.8 : 5, end: true, cell: (coin) => moneyOr(volumeOf(coin, window), lang) },
    { id: 'mcap', key: 'mcap' as SortKey, head: w.mcap, min: 96, grow: 0.9, rank: 7, end: true, cell: (coin: DepthCoin) => moneyOr(coin.mcap, lang) },
    { id: 'liquidity', key: 'liquidity' as SortKey, head: w.liquidity, min: 86, grow: 0.9, rank: 12, end: true, cell: (coin: DepthCoin) => moneyOr(coin.liquidity, lang) },
    { id: 'holders', key: 'holders', head: w.holders, min: 68, grow: 0.8, rank: 4, end: true, cell: (coin) => countText(coin.holders, lang) },
    ...(every
      ? [
          { id: 'bs', key: 'trades' as SortKey, head: w.buysSells, min: 116, grow: 1.1, rank: 4.5, end: true, cell: (coin: DepthCoin) => <BuysSells coin={coin} window={window} /> },
          { id: 'traders', key: 'traders' as SortKey, head: w.traders, min: 70, grow: 0.7, rank: 13, end: true, cell: (coin: DepthCoin) => countText(statsOf(coin, window)?.traders ?? null, lang) },
        ]
      : []),
    { id: 'risk', key: null, head: w.risk, min: 52, grow: 0, rank: 1.5, cell: (coin) => <Rights coin={coin} /> },
    ...(TICKET_OPEN ? [{ id: 'quick', key: null, head: '', min: every ? 44 : 70, grow: 0, rank: 0.5, end: true, cell: (coin: DepthCoin) => <QuickButton coin={coin} sum={quick} onQuick={onQuick} wide={!every} /> }] : []),
    { id: 'star', key: null, head: '', min: 28, grow: 0, rank: 1.2, cell: (coin) => <Star coin={coin} /> },
  ];
  const columns = width ? fitColumns(all, width) : all.filter((c) => c.rank <= 5);
  // The order by a column that left the table — another set of columns, a narrower window — goes back to the list's own.
  const sortShown = sort.key === DEFAULT_SORT.key || columns.some((c) => c.key === sort.key);
  useEffect(() => {
    if (width && !sortShown) onSort(DEFAULT_SORT);
  }, [width, sortShown, onSort]);
  const template = columns.map((c) => (c.grow ? `minmax(${c.min}px, ${c.grow}fr)` : `${c.min}px`)).join(' ');
  return (
    <div className={d.scroll} ref={box}>
      <div role="table" aria-label={w.market} className={d.tbl} style={{ gridTemplateColumns: template }}>
        <div role="row" className={d.th}>
          {columns.map((c) => (
            <span key={c.id} role="columnheader" className={d.cell} data-end={c.end ? '' : undefined}>
              {c.key ? (
                <button type="button" className={d.sort} aria-label={w.sortBy(typeof c.head === 'string' ? c.head : '')} aria-pressed={sort.key === c.key} data-dir={sort.key === c.key ? sort.dir : undefined} onClick={() => onSort(nextSort(sort, c.key!))}>
                  {c.head}
                </button>
              ) : (
                c.head
              )}
            </span>
          ))}
        </div>
        {rows.map((coin) => (
          <div key={coin.id} role="row" className={d.tr} aria-current={coin.id === picked || undefined} onPointerMove={(event) => (event.movementX || event.movementY ? onPick(coin.id, 'rest') : undefined)} onPointerLeave={onLeave} onWheel={onLeave}>
            {columns.map((c) => (
              <span key={c.id} role="cell" className={d.cell} data-end={c.end ? '' : undefined} data-tone={c.tone?.(coin)}>
                {c.cell(coin)}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Buys and sells over the window, with the buys' share as a bar. */
function BuysSells({ coin, window }: { coin: DepthCoin; window: DepthWindow }) {
  const lang = useLang();
  const stats = statsOf(coin, window);
  const share = buyShare(stats);
  if (!stats || share === null) return <span className={d.dim}>—</span>;
  return (
    <span className={d.bs}>
      <span>
        <span className={d.buy}>{countText(stats.buys, lang)}</span>
        <span className={d.dim}> / </span>
        <span className={d.sell}>{countText(stats.sells, lang)}</span>
      </span>
      <span className={d.bsBar} style={{ ['--buy' as string]: `${Math.round(share * 100)}%` }} />
    </span>
  );
}

function PhoneRows({ rows, window, now, quick, onQuick }: { rows: readonly DepthCoin[]; window: DepthWindow; now: number; quick: string; onQuick: (coin: DepthCoin) => void }) {
  const lang = useLang();
  return (
    <div className={d.phoneList}>
      {rows.map((coin) => {
        const change = changeOf(coin, window);
        return (
          <div key={coin.id} className={d.phoneRow}>
            <Link className={d.rowLink} href={coinHref(coin.id, 'live')}>
              <CoinWords coin={coin} now={now} holders />
            </Link>
            <Rights coin={coin} />
            <span className={d.phoneFig}>
              <b className={d.price}>{coin.price === null ? '—' : priceText(coin.price, lang)}</b>
              <span data-tone={change === null ? undefined : changeTone(change)}>{moveOr(change, lang)}</span>
            </span>
            {TICKET_OPEN ? <QuickButton coin={coin} sum={quick} onQuick={onQuick} /> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Pro: the market's figures in one line — the majors' prices and moves, and how many coins the market names. */
function Strip({ towers }: { towers: readonly Tower[] }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  const named = STRIP.map((symbol) => towers.find((t) => t.verified && t.symbol.toUpperCase() === symbol)).filter((t): t is Tower => Boolean(t));
  const listed = towers.filter((t) => t.verified).length;
  if (!named.length) return null;
  return (
    <div className={d.strip}>
      {named.map((t) => (
        <Link key={t.id} href={coinHref(t.id, 'live')} className={d.stripCoin}>
          <CoinLogo src={t.icon ? `/api/icon/${t.id}` : null} symbol={t.symbol} size="s" />
          <b>{t.symbol}</b>
          <span>{priceText(t.price, lang)}</span>
          <span data-tone={changeTone(t.change24h)}>{changeText(t.change24h, lang)}</span>
        </Link>
      ))}
      <span className={d.grow} />
      <span className={d.stripCount}>
        <Zap />
        {w.onMarket} <b>{digits(String(listed), lang)}</b>
      </span>
    </div>
  );
}

/** The quick-buy sum, picked once: every ⚡ buys that much SOL's worth. */
function QuickPick() {
  const w = useWords(DEPTH);
  const lang = useLang();
  const quick = useDepth((st) => st.quick);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, box, () => setOpen(false));
  return (
    <div className={d.pop} ref={box}>
      <button type="button" className={d.quickPick} aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        <Zap />
        {w.quick} <b>{fieldText(quick, lang)} SOL</b>
      </button>
      {open ? (
        <div className={d.menu} role="menu">
          {QUICK_SOL.map((sum) => (
            <button
              key={sum}
              type="button"
              role="menuitemradio"
              aria-checked={sum === quick}
              className={d.menuItem}
              onClick={() => {
                setQuick(sum);
                setOpen(false);
              }}
            >
              {fieldText(sum, lang)} SOL
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const FLOORS = ['mcap', 'liquidity', 'volume', 'holders'] as const;
type Floor = (typeof FLOORS)[number];

function floorText(key: Floor, value: number, lang: Lang): string {
  return key === 'holders' ? countText(value, lang) : usdText(value, lang);
}

/** The filters that stand away from the default, each a chip; a tap opens «Filters». */
function FilterChips({ filters }: { filters: Filters }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  const chips: { key: string; word: string; value: string }[] = [];
  for (const key of FLOORS) if (filters[key] !== null) chips.push({ key, word: w[key], value: w.over(floorText(key, filters[key]!, lang)) });
  if (filters.age !== 'any') chips.push({ key: 'age', word: w.age, value: ageBoundText(filters.age, w, lang) });
  if (filters.change !== 'any') chips.push({ key: 'change', word: w.change, value: filters.change === 'up' ? w.up : w.down });
  return (
    <>
      {chips.map((chip) => (
        <button key={chip.key} type="button" className={d.chip} onClick={() => setFilters({ ...filters, [chip.key]: DEFAULT_FILTERS[chip.key as keyof Filters] })}>
          <span className={d.chipWord}>{chip.word}</span> {chip.value}
          <Icon name="close" size="s" />
        </button>
      ))}
      <label className={d.chip} data-switch="">
        <span className={d.chipWord}>{w.verified}</span>
        <Switch on={filters.verified} onChange={(verified) => setFilters({ ...filters, verified })} label={w.verified} />
      </label>
    </>
  );
}

function ageBoundText(age: AgeBound, w: W, lang: Lang): string {
  if (age === 'any') return w.any;
  if (age === 'old') return w.older;
  const map: Record<Exclude<AgeBound, 'any' | 'old'>, [number, 'h' | 'd']> = { '1h': [1, 'h'], '24h': [24, 'h'], '7d': [7, 'd'], '30d': [30, 'd'] };
  const [n, unit] = map[age];
  return w.under(digits(`${n} ${w[UNIT_WORD[unit]]}`, lang));
}

/** «Filters · N»: every filter in one panel — a row of choices each, one tap a choice. */
function FiltersButton({ filters }: { filters: Filters }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, box, () => setOpen(false));
  const on = filtersOn(filters);
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  return (
    <div className={d.pop} ref={box}>
      <button type="button" className={d.filters} data-on={on ? '' : undefined} aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        <span aria-hidden="true">+</span> {w.filters}
        {on ? <b>· {digits(String(on), lang)}</b> : null}
      </button>
      {open ? (
        <div className={d.panel} role="dialog" aria-label={w.filters}>
          {FLOORS.map((key) => (
            <div key={key} className={d.panelRow}>
              <span className={d.panelWord}>{w[key]}</span>
              <div className={d.choices}>
                {STEPS[key].map((value) => (
                  <button key={String(value)} type="button" className={d.choice} aria-pressed={filters[key] === value} onClick={() => set({ [key]: value } as Partial<Filters>)}>
                    {value === null ? w.any : w.over(floorText(key, value, lang))}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className={d.panelRow}>
            <span className={d.panelWord}>{w.age}</span>
            <div className={d.choices}>
              {AGES.map((age) => (
                <button key={age} type="button" className={d.choice} aria-pressed={filters.age === age} onClick={() => set({ age })}>
                  {ageBoundText(age, w, lang)}
                </button>
              ))}
            </div>
          </div>
          <div className={d.panelRow}>
            <span className={d.panelWord}>{w.change}</span>
            <div className={d.choices}>
              {WAYS.map((way: Way) => (
                <button key={way} type="button" className={d.choice} aria-pressed={filters.change === way} onClick={() => set({ change: way })}>
                  {way === 'any' ? w.any : way === 'up' ? w.up : w.down}
                </button>
              ))}
            </div>
          </div>
          <div className={d.panelRow}>
            <span className={d.panelWord}>{w.verified}</span>
            <Switch on={filters.verified} onChange={(verified) => set({ verified })} label={w.verified} />
          </div>
          <div className={d.panelFoot}>
            <button type="button" className={d.noneBtn} onClick={() => setFilters(DEFAULT_FILTERS)} disabled={!on}>
              {w.reset}
            </button>
            <button type="button" className={d.done} onClick={() => setOpen(false)}>
              {w.done}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
