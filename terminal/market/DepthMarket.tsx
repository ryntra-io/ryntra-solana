'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang, type Lang } from '@/city/lib/i18n/lang';
import type { DepthCoin, DepthKind, DepthWindow } from '@/lib/market-depth/model';
import { coinHref } from '@/terminal/shell/shelves';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { SHELL } from '@/terminal/shell/words';
import { CoinLogo, Columns, Icon, Info, Quiet, Segment, Tabs, changeText, changeTone, priceText, usdText, useColumnSet } from '@/terminal/ui';
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  KINDS,
  LISTS,
  MAIN_COLUMNS,
  ROWS_FIRST,
  ROWS_MORE,
  ROWS_PHONE,
  WINDOWS,
  ageMs,
  ageParts,
  allCoins,
  buyShare,
  changeOf,
  companyOf,
  countText,
  depthRows,
  exchangeOpen,
  filtersOn,
  fitColumns,
  filtersFor,
  isKindTab,
  logoOf,
  mixedRows,
  nextSort,
  riskFacts,
  statsOf,
  volumeOf,
  type Filters,
  type KindTab,
  type RiskFact,
  type Sort,
  type ShownList,
  type SortKey,
} from './depth-view';
import { useDayMove } from './day-move';
import { readKey, setFilters, setList, setTab, setWindow, startPrefs, targetOf, useDepth, useDepthAhead, useDepthRead } from './depth';
import { DEPTH, UNIT_WORD } from './depth-words';
import { FiltersPanel } from './FiltersPanel';
import { Shield, Sliders, Warn } from './glyphs';
import { usePulse } from './pulse-store';
import { padWord } from './pulse-view';
import { ZapButton, type QuickCoin } from './QuickBuy';
import { startSaved, toggleSaved, useSaved } from './saved';
import d from './depth.module.css';

type W = (typeof DEPTH)['en'];

const WINDOW_WORD: Readonly<Record<DepthWindow, 'w5m' | 'w1h' | 'w6h' | 'w24h'>> = { '5m': 'w5m', '1h': 'w1h', '6h': 'w6h', '24h': 'w24h' };
/** «Saved» shows every starred coin: the person chose them, no filter hides one. */
const SAVED_FILTERS: Filters = { ...DEFAULT_FILTERS, hideRisky: false };

const moneyOr = (value: number | null, lang: Lang) => (value === null ? '—' : usdText(value, lang));
const moveOr = (value: number | null, lang: Lang) => (value === null ? '—' : changeText(value, lang));

const KIND_WORD: Readonly<Record<DepthKind, 'kindAll' | 'kindMeme' | 'kindCrypto' | 'kindStock' | 'kindPreipo'>> = { all: 'kindAll', meme: 'kindMeme', crypto: 'kindCrypto', stock: 'kindStock', preipo: 'kindPreipo' };
const LIST_WORD: Readonly<Record<ShownList, 'trending' | 'gainers' | 'losers' | 'traded'>> = { trending: 'trending', gainers: 'gainers', losers: 'losers', traded: 'traded' };

/**
 * The address's `?tab=` («Portfolio → Saved» opens `/?tab=saved`): a kind of asset or «saved»; the older
 * addresses keep working — `stocks` is the Stocks tab, a list's name its view.
 */
function tabOf(value: string | null): { tab?: KindTab; list?: ShownList } | null {
  if (isKindTab(value)) return { tab: value };
  if (value === 'stocks') return { tab: 'stock' };
  if (value && (LISTS as readonly string[]).includes(value)) return { list: value as ShownList };
  return null;
}

/** The tab the address names, on arrival and whenever the address changes while the Market is open. */
function TabParam() {
  const raw = useSearchParams().get('tab');
  const had = useRef<string | null>(raw);
  const arrived = useRef(false);
  useEffect(() => {
    const said = tabOf(raw);
    // The table's own tab wrote the address after it switched: that is no arrival, and nothing is scrolled.
    const fromTable = arrived.current && Boolean(said?.tab) && useDepth.getState().tab === said?.tab;
    arrived.current = true;
    if (said?.tab && useDepth.getState().tab !== said.tab) setTab(said.tab);
    if (said?.list && useDepth.getState().list !== said.list) setList(said.list);
    // The address lost its tab (the menu's «Market»): the table goes back to «All».
    if (!raw && had.current) setTab('all');
    had.current = raw;
    // «Saved» from the menu (QA 19.11: the tab stood below the fold): the list itself is brought into view.
    if (said?.tab === 'saved' && !fromTable) return bringIntoView();
  }, [raw]);
  return null;
}

/** How long the Market's list is kept in view while the blocks above it are still drawing. */
const HOLD_MS = 2500;

/**
 * The Market's list brought to the top of the view, and kept there while the blocks above it finish drawing — until the
 * person scrolls, taps or types themselves.
 */
function bringIntoView(): () => void {
  const place = () => document.getElementById('market-title')?.closest('section') ?? null;
  const go = () => {
    const section = place();
    section?.scrollIntoView({ block: 'start' });
    // A phone's row of tabs scrolls sideways: «Saved» stands at its end, so the row brings it in too.
    section?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  };
  const frame = requestAnimationFrame(go);
  const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(go);
  watch?.observe(document.body);
  const stop = () => {
    cancelAnimationFrame(frame);
    watch?.disconnect();
    window.clearTimeout(timer);
    for (const kind of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.removeEventListener(kind, stop);
  };
  const timer = window.setTimeout(stop, HOLD_MS);
  for (const kind of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.addEventListener(kind, stop, { passive: true });
  return stop;
}

/** The tab on screen, written back to the address: `?tab=` for every tab but «All». */
function writeTab(tab: KindTab): void {
  try {
    const url = new URL(window.location.href);
    if (tab === 'all') url.searchParams.delete('tab');
    else url.searchParams.set('tab', tab);
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url);
  } catch {
    // An address that cannot be written keeps the list on screen as it is.
  }
}

const quickOf = (coin: DepthCoin): QuickCoin => ({ id: coin.id, symbol: coin.symbol, name: coin.name, icon: coin.icon, logo: logoOf(coin) });

/**
 * The Market's table:
 * the kind of asset on the first row — All · Memes · Crypto · Stocks · Pre-IPO · Saved — and quietly under it the view —
 * Trending · Rising · Falling · Most trades — the window, filters and the table's own «Columns». Each kind shows the
 * columns that tell it (`MAIN_COLUMNS`). A row is its coin's page: a tap opens it, the pointer resting on it changes
 * nothing. The ⚡ beside it buys with the screen's one sum, right there; the ☆ keeps it in «Saved». One sign tells the
 * facts against a coin; they open behind it. A kind with nothing in it shows no tab.
 */
export function DepthMarket() {
  const w = useWords(DEPTH);
  const frame = useWords(SHELL);
  const lang = useLang();
  const narrow = useNarrow();
  const tab = useDepth((st) => st.tab);
  const list = useDepth((st) => st.list);
  const window = useDepth((st) => st.window);
  const filters = useDepth((st) => st.filters);
  const ryntraMints = usePulse((st) => st.ryntra);
  const ryntra = useMemo(() => new Set(ryntraMints), [ryntraMints]);
  const [columnSet, setColumnSet] = useColumnSet('market');
  const all = columnSet === 'all' && !narrow;
  const savedMints = useSaved((st) => st.mints);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [now, setNow] = useState(() => Date.now());
  const [limit, setLimit] = useState(ROWS_FIRST);
  const [filtering, setFiltering] = useState(false);

  useEffect(() => {
    startPrefs();
    return startSaved();
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const first = narrow ? ROWS_PHONE : ROWS_FIRST;
  useEffect(() => setLimit(first), [tab, list, window, filters, first]);

  const savedList = useMemo(() => [...savedMints].reverse().slice(0, 50), [savedMints]);
  const target = targetOf(tab, list);
  const read = useDepthRead(target, window, tab === 'saved' ? savedList : []);
  // Every kind's view on screen is read ahead: its tab shows its count, and a kind with nothing stands hidden.
  const ahead = useMemo(() => KINDS.map((kind) => targetOf(kind, list)), [list]);
  useDepthAhead(ahead, window);
  const reads = useDepth((st) => st.reads);
  /* «All» is the memes and the crypto together — every one its two tabs hold, so its count is theirs added up. */
  const everyCoin = useMemo(
    () => allCoins([reads[readKey(targetOf('all', list), window)]?.coins, reads[readKey(targetOf('meme', list), window)]?.coins, reads[readKey(targetOf('crypto', list), window)]?.coins]),
    [reads, list, window],
  );
  const kinds = useMemo(() => {
    const out: { kind: DepthKind; count: number | null }[] = [];
    for (const kind of KINDS) {
      const r = reads[readKey(targetOf(kind, list), window)];
      const view = { filters: filtersFor(filters, kind), window, sort: DEFAULT_SORT, query: '', now, ryntra };
      const count = r?.status === 'ready' ? (kind === 'all' ? mixedRows(everyCoin, view) : depthRows(r.coins, view)).length : null;
      // A kind the market has nothing of shows no tab — unless it is the one on screen. A filter never hides a tab.
      if (r?.status === 'ready' && r.coins.length === 0 && kind !== tab && kind !== 'all') continue;
      out.push({ kind, count });
    }
    return out;
  }, [reads, list, window, filters, now, ryntra, tab, everyCoin]);

  const shownFilters = tab === 'saved' ? SAVED_FILTERS : filtersFor(filters, tab);
  const rows = useMemo(
    () => (tab === 'all' ? mixedRows(everyCoin, { filters, window, sort, query: '', now, ryntra }) : depthRows(read.coins, { filters: shownFilters, window, sort, query: '', now, ryntra })),
    [tab, everyCoin, filters, read.coins, shownFilters, window, sort, now, ryntra],
  );
  const visible = rows.slice(0, limit);
  const on = filtersOn(filters);

  const change = (next: KindTab) => {
    setTab(next);
    setSort(DEFAULT_SORT);
    writeTab(next);
  };
  const view = (next: ShownList) => {
    setList(next);
    setSort(DEFAULT_SORT);
  };
  const kind: DepthKind = tab === 'saved' ? 'all' : tab;

  const none =
    read.status === 'reading' && !read.coins.length
      ? w.reading
      : read.status === 'failed'
        ? w.failed
        : !rows.length
          ? tab === 'saved' && !savedList.length
            ? w.noSaved
            : w.none
          : null;

  const tabs = [
    ...kinds.map(({ kind: id, count }) => ({ id: id as KindTab, label: w[KIND_WORD[id]], count: count === null || narrow ? undefined : digits(String(count), lang) })),
    { id: 'saved' as KindTab, label: w.saved, icon: <Icon name="star" size="s" />, count: savedMints.length && !narrow ? digits(String(savedMints.length), lang) : undefined },
  ];

  return (
    <section className={d.market} aria-labelledby="market-title" data-terminal="depth">
      <Suspense fallback={null}>
        <TabParam />
      </Suspense>
      <div className={d.marketHead}>
        <h2 id="market-title" className={d.h2}>
          {w.market}
        </h2>
        <Tabs bare label={w.kinds} value={tab} onChange={change} items={tabs} className={d.listTabs} />
      </div>
      <div className={d.viewRow}>
        {tab === 'saved' ? null : <Segment className={d.viewSeg} label={w.lists} value={list} onChange={view} items={LISTS.map((id) => ({ id, label: narrow && id === 'traded' ? w.tradedShort : w[LIST_WORD[id]] }))} />}
        {tab === 'stock' ? <ExchangeMark now={now} /> : null}
        {tab === 'stock' || tab === 'preipo' ? (
          <Info label={w.aboutKind}>
            <span className={d.kindNote}>{tab === 'stock' ? w.stockNote : w.preipoNote}</span>
          </Info>
        ) : null}
        <span className={d.grow} />
        <div className={d.controls}>
          <Segment className={d.winSeg} label={w.windows} value={window} onChange={setWindow} items={WINDOWS.map((id) => ({ id, label: w[WINDOW_WORD[id]] }))} />
          {tab === 'saved' ? null : (
          <div className={d.pop}>
            <Quiet size="s" className={d.filtersBtn} aria-haspopup="dialog" aria-expanded={filtering} data-filters-open="" onClick={() => setFiltering((was) => !was)}>
              <Sliders />
              {w.filters}
              {on ? <span className={d.n1}>{digits(String(on), lang)}</span> : null}
            </Quiet>
            {filtering ? (
              <FiltersPanel
                filters={filters}
                coins={read.coins}
                win={window}
                sort={sort}
                now={now}
                ryntra={ryntra}
                onClose={() => setFiltering(false)}
                onApply={(next) => {
                  setFilters(next);
                  setFiltering(false);
                }}
              />
            ) : null}
          </div>
          )}
          {narrow ? null : (
            <Columns value={columnSet} onChange={setColumnSet} label={frame.columns} main={frame.colsMain} all={frame.colsAll} />
          )}
        </div>
      </div>

      <div className={d.tableBox}>
        {narrow ? <PhoneRows rows={visible} window={window} now={now} kind={kind} /> : <DeskTable rows={visible} window={window} now={now} all={all} kind={kind} moving={list === 'gainers' || list === 'losers'} sort={sort} onSort={setSort} />}
        {none ? (
          <div className={d.none} role="status">
            <span>{none}</span>
            {tab !== 'saved' && on && read.coins.length ? (
              <Quiet size="s" onClick={() => setFilters(DEFAULT_FILTERS)}>
                {w.reset}
              </Quiet>
            ) : null}
          </div>
        ) : null}
      </div>
      {rows.length > limit ? (
        <Quiet className={d.more} onClick={() => setLimit((was) => was + ROWS_MORE)}>
          {w.showMore}
        </Quiet>
      ) : null}
    </section>
  );
}

/** A quiet mark beside a stock's tab: whether the exchange is open now, by its hours. */
function ExchangeMark({ now }: { now: number }) {
  const w = useWords(DEPTH);
  const open = exchangeOpen(now);
  return (
    <span className={d.exchange} data-open={open ? '' : undefined}>
      {open ? w.exchangeOpen : w.exchangeClosed}
    </span>
  );
}

function AgeText({ ms }: { ms: number }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  const { n, unit } = ageParts(ms);
  return <>{digits(`${n} ${w[UNIT_WORD[unit]]}`, lang)}</>;
}

const FACT_WORD = (fact: RiskFact, coin: DepthCoin, w: W, lang: Lang): string => {
  switch (fact) {
    case 'copy':
      return w.factCopy(coin.copyOf ?? '');
    case 'mint':
      return w.factMint;
    case 'freeze':
      return w.factFreeze;
    case 'top':
      return w.factTop(digits(`${Math.round(coin.topHolders ?? 0)}%`, lang));
    case 'thin':
      return w.factThin;
    case 'few':
      return w.factFew;
  }
};

/** The one sign of a coin's risk: a quiet shield with no fact against it, «⚠ N» with N; the facts open behind it. */
function RiskSign({ coin }: { coin: DepthCoin }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  const facts = riskFacts(coin);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  const label = facts.length ? w.riskOf(digits(String(facts.length), lang)) : w.riskClear;
  return (
    <span className={d.riskWrap} ref={box}>
      <button
        type="button"
        className={d.risk}
        data-level={facts.length ? 'warn' : 'clear'}
        aria-label={label}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((was) => !was);
        }}
      >
        {facts.length ? (
          <>
            <Warn />
            {digits(String(facts.length), lang)}
          </>
        ) : (
          <Shield />
        )}
      </button>
      {open ? (
        <span className={d.riskPop} role="note" onClick={(event) => event.stopPropagation()}>
          <b>{label}</b>
          {facts.map((fact) => (
            <span key={fact}>{FACT_WORD(fact, coin, w, lang)}</span>
          ))}
          {coin.verified ? <span className={d.riskOk}>{w.verified}</span> : null}
        </span>
      ) : null}
    </span>
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
      onClick={(event) => {
        event.stopPropagation();
        toggleSaved(coin.id);
      }}
    >
      <Icon name="star" size="s" />
    </button>
  );
}

/**
 * A coin's logo, ticker, a copy's mark, and its age under it (or `sub`, with `aside` beside the ticker). A company's
 * token is named by its company, its ticker under it; a meme carries its launchpad.
 */
function CoinWords({ coin, now, sub, aside }: { coin: DepthCoin; now: number; sub?: ReactNode; aside?: ReactNode }) {
  const w = useWords(DEPTH);
  const age = ageMs(coin, now);
  const company = coin.kind === 'stock' || coin.kind === 'preipo';
  return (
    <span className={d.coin}>
      <CoinLogo src={logoOf(coin)} symbol={coin.symbol} size="m" />
      <span className={d.coinWords}>
        <span className={d.coinSym}>
          <span className={d.sym}>{company ? companyOf(coin.name) : coin.symbol}</span>
          {coin.kind === 'meme' && coin.launchpad ? <span className={d.pad}>{padWord({ launchpad: coin.launchpad, ryntra: null, venue: coin.venue })}</span> : null}
          {coin.copyOf ? (
            <span className={d.copy} title={w.factCopy(coin.copyOf)}>
              {w.copy}
            </span>
          ) : null}
          {aside}
        </span>
        <span className={d.coinSub}>{sub ?? (company ? coin.symbol : age === null ? null : <AgeText ms={age} />)}</span>
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
  /** The name a kind's main set knows the column by (`MAIN_COLUMNS`): its id, unless said. */
  group?: string;
  cell: (coin: DepthCoin, index: number) => ReactNode;
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

function DeskTable({ rows, window, now, all: every, kind, moving, sort, onSort }: { rows: readonly DepthCoin[]; window: DepthWindow; now: number; all: boolean; kind: DepthKind; moving: boolean; sort: Sort; onSort: (sort: Sort) => void }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  const router = useRouter();
  const [box, width] = useWidth<HTMLDivElement>();
  const move = (win: DepthWindow, rank: number): Column => ({
    id: `move-${win}`,
    group: win === '24h' ? 'day' : win === window ? 'move' : 'other',
    key: `change${win}` as SortKey,
    head: w[WINDOW_WORD[win]],
    min: 70,
    grow: 0.8,
    rank,
    end: true,
    // The day's move is the one every screen says; the shorter windows are the list's own.
    cell: (coin) => (win === '24h' ? <DayCell coin={coin} /> : moveOr(changeOf(coin, win), lang)),
    tone: (coin) => {
      const change = changeOf(coin, win);
      return win === '24h' || change === null ? undefined : changeTone(change);
    },
  });
  // The window on screen stands right after the price, then the day; every column adds the other windows.
  const moves = every
    ? WINDOWS.map((win) => move(win, win === window ? 2 : win === '24h' ? 3 : 10 + WINDOWS.indexOf(win)))
    : window === '24h'
      ? [move('24h', 2)]
      : [move(window, 2), move('24h', 3)];
  const table: Column[] = [
    { id: 'n', key: null, head: w.n, min: 24, grow: 0, rank: 0.1, cell: (_coin, index) => <span className={d.num}>{digits(String(index + 1), lang)}</span> },
    {
      id: 'coin',
      key: 'symbol',
      head: w.coin,
      min: 168,
      grow: 1.7,
      rank: 0,
      cell: (coin) => (
        <Link className={d.rowLink} href={coinHref(coin.id, 'live')} onClick={(event) => event.stopPropagation()}>
          <CoinWords coin={coin} now={now} />
        </Link>
      ),
    },
    { id: 'price', key: 'price', head: w.price, min: 96, grow: 1, rank: 1, end: true, cell: (coin) => <b className={d.price}>{coin.price === null ? '—' : priceText(coin.price, lang)}</b> },
    ...moves,
    { id: 'volume', key: 'volume', head: w.volume, min: 76, grow: 0.8, rank: 4, end: true, cell: (coin) => moneyOr(volumeOf(coin, window), lang) },
    { id: 'mcap', key: 'mcap', head: w.mcap, min: 80, grow: 0.85, rank: 5, end: true, cell: (coin) => moneyOr(coin.mcap, lang) },
    { id: 'liquidity', key: 'liquidity', head: w.liquidity, min: 86, grow: 0.85, rank: 7, end: true, cell: (coin) => moneyOr(coin.liquidity, lang) },
    { id: 'holders', key: 'holders', head: w.holders, min: 76, grow: 0.8, rank: 6, end: true, cell: (coin) => countText(coin.holders, lang) },
    ...(kind === 'meme' ? [{ id: 'top', key: null, head: w.top10, min: 64, grow: 0.6, rank: 6.5, end: true, cell: (coin: DepthCoin) => (coin.topHolders === null ? '—' : digits(`${Math.round(coin.topHolders)}%`, lang)) }] : []),
    { id: 'bs', key: 'trades', head: w.buysSells, min: 124, grow: 1.2, rank: 8, end: true, cell: (coin) => <BuysSells coin={coin} window={window} /> },
    ...(every ? [{ id: 'traders', key: 'traders' as SortKey, head: w.traders, min: 76, grow: 0.7, rank: 14, end: true, cell: (coin: DepthCoin) => countText(statsOf(coin, window)?.traders ?? null, lang) }] : []),
    { id: 'risk', key: null, head: w.risk, min: 52, grow: 0, rank: 1.5, cell: (coin) => <RiskSign coin={coin} /> },
    { id: 'quick', key: null, head: '', min: 72, grow: 0, rank: 0.5, end: true, cell: (coin) => <ZapButton coin={quickOf(coin)} /> },
    { id: 'star', key: null, head: '', min: 28, grow: 0, rank: 1.2, cell: (coin) => <Star coin={coin} /> },
  ];
  // Each kind's main set shows its own columns; «All» shows every one.
  // Rising and falling are ranked by the window's move: that column always stands.
  const kept = every ? table : table.filter((c) => MAIN_COLUMNS[kind].includes(c.group ?? c.id) || (c.id === `move-${window}` && (moving || MAIN_COLUMNS[kind].includes('move'))));
  const columns = width ? fitColumns(kept, width) : kept.filter((c) => c.rank <= 5);
  // The order by a column that left the table goes back to the list's own.
  const sortShown = sort.key === DEFAULT_SORT.key || columns.some((c) => c.key === sort.key);
  useEffect(() => {
    if (width && !sortShown) onSort(DEFAULT_SORT);
  }, [width, sortShown, onSort]);
  const template = columns.map((c) => (c.grow ? `minmax(${c.min}px, ${c.grow}fr)` : `${c.min}px`)).join(' ');
  const open = useCallback((coin: DepthCoin) => router.push(coinHref(coin.id, 'live')), [router]);
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
        {rows.map((coin, index) => (
          <div key={coin.id} role="row" className={d.tr} onClick={() => open(coin)}>
            {columns.map((c) => (
              <span key={c.id} role="cell" className={d.cell} data-end={c.end ? '' : undefined} data-tone={c.tone?.(coin)}>
                {c.cell(coin, index)}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A coin's day as every screen says it — the newest read of it — in its tone. */
function DayCell({ coin }: { coin: DepthCoin }) {
  const lang = useLang();
  const change = useDayMove(coin.id) ?? changeOf(coin, '24h');
  return <span data-tone={change === null ? undefined : changeTone(change)}>{moveOr(change, lang)}</span>;
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

function PhoneRows({ rows, window, now, kind }: { rows: readonly DepthCoin[]; window: DepthWindow; now: number; kind: DepthKind }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  const router = useRouter();
  return (
    <div className={d.phoneList} role="list" aria-label={w.market}>
      {rows.map((coin) => {
        const change = changeOf(coin, window);
        // A company's token is told by its company: no age, and its issuer's rights are no fact against it here.
        const company = kind === 'stock' || kind === 'preipo';
        const age = company ? null : ageMs(coin, now);
        const facts = company ? 0 : riskFacts(coin).length;
        return (
          <div key={coin.id} role="listitem" className={d.phoneRow} onClick={() => router.push(coinHref(coin.id, 'live'))}>
            <Link className={d.rowLink} href={coinHref(coin.id, 'live')} onClick={(event) => event.stopPropagation()}>
              <CoinWords
                coin={coin}
                now={now}
                aside={
                  <>
                    {age === null ? null : (
                      <span className={d.age}>
                        <AgeText ms={age} />
                      </span>
                    )}
                    {facts ? (
                      <span className={d.phoneRisk} role="img" aria-label={w.riskOf(digits(String(facts), lang))}>
                        <Warn />
                        {digits(String(facts), lang)}
                      </span>
                    ) : null}
                  </>
                }
                sub={
                  kind === 'stock' || kind === 'preipo' ? (
                    <>
                      {coin.symbol} <span className={d.gap} /> {w.volShort} {moneyOr(volumeOf(coin, window), lang)}
                    </>
                  ) : kind === 'meme' ? (
                    <>
                      {w.capShort} {moneyOr(coin.mcap, lang)} <span className={d.gap} /> {w.holdersShort} {countText(coin.holders, lang)}
                    </>
                  ) : (
                    <>
                      {w.capShort} {moneyOr(coin.mcap, lang)} <span className={d.gap} /> {w.volShort} {moneyOr(volumeOf(coin, window), lang)}
                    </>
                  )
                }
              />
            </Link>
            <span className={d.phoneFig}>
              <b className={d.price}>{coin.price === null ? '—' : priceText(coin.price, lang)}</b>
              {window === '24h' ? <DayCell coin={coin} /> : <span data-tone={change === null ? undefined : changeTone(change)}>{moveOr(change, lang)}</span>}
            </span>
            <ZapButton coin={quickOf(coin)} />
          </div>
        );
      })}
    </div>
  );
}
