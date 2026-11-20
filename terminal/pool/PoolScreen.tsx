'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Tower } from '@/city/lib/market/types';
import { useTrade } from '@/city/lib/trade/store';
import { useWallet } from '@/city/lib/trade/wallet';
import type { EarnPool } from '@/lib/earn-pools/model';
import { coinPriceIn, pairOf, tickerOf, type ProPoolRow } from '@/lib/pro-pools/model';
import { CoinFacts } from '@/terminal/coin/CoinFacts';
import { useCoinDepth } from '@/terminal/coin/CoinDepth';
import { CoinUnder, type UnderTab } from '@/terminal/coin/CoinUnder';
import { standIn } from '@/terminal/coin/coin-view';
import { Desk } from '@/terminal/coin/Desk';
import { CoinGlyph } from '@/terminal/coin/glyphs';
import { setDeskFolded, useDesk } from '@/terminal/coin/desk-store';
import { DESK } from '@/terminal/coin/desk-words';
import { Holders, MarketTrades, Traders } from '@/terminal/coin/MarketTabs';
import { bare } from '@/terminal/coin/parts';
import { PoolBook, Trades } from '@/terminal/coin/Tape';
import { TICKET_OPEN } from '@/terminal/coin/Ticket';
import { USDC_LOGO, spotLogo } from '@/terminal/coin/staples';
import { readPools } from '@/terminal/coin/usePoolLayer';
import { useSpotMarket, useTape } from '@/terminal/coin/useCoinMarket';
import { COIN } from '@/terminal/coin/words';
import { useBins } from '@/terminal/earn/range/useBins';
import { logoOf } from '@/terminal/market/depth-view';
import { partOf, useAddressTail } from '@/terminal/shell/address';
import { useMarket } from '@/terminal/shell/useMarket';
import { useDismiss } from '@/terminal/shell/useDismiss';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { setPoolKind } from '@/terminal/shell/pool-kind';
import { CoinLogo, Icon, Info, Page, QuietLink, Tabs, Title, priceText, stepFigure, usdText } from '@/terminal/ui';
import { binsVenueOf, carriedTab, pairGroups, pairPools, poolHref, VENUE_MARK, VENUE_SHORT, type DeskPool, type PairPool } from './desk-pool';
import { Distribution } from './Distribution';
import { distributionOf, pctOfBps, quoteFigure } from './pool-view';
import { PoolSide, usePositionWay } from './PoolSide';
import { useDeskPool } from './useDeskPool';
import { useProPools, type Read } from './usePro';
import { POOL } from './words';
import u from '@/terminal/coin/coin.module.css';
import h from '@/terminal/coin/head.module.css';
import t from '@/terminal/coin/tape.module.css';
import p from './pool.module.css';

/** The chart draws in the browser only: its engine is loaded with the screen, and the frame waits in its place. */
const CoinChart = dynamic(() => import('@/terminal/coin/CoinChart').then((m) => m.CoinChart), {
  ssr: false,
  loading: () => <div className={u.chartWait} aria-busy="true" />,
});

/** The pools list's address. */
export const PRO_PATH = '/pro';
/** A pool's own page (`desk-pool.ts` names the tab it opens on). */
export { poolHref } from './desk-pool';

type ColumnTab = 'pool' | 'trades';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
/** The two dollars a pool may be priced in: its price is then the coin's dollar price itself. */
const DOLLAR_MINTS: ReadonlySet<string> = new Set([USDC_MINT, 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);
/** The rows a group of the pair's pools shows before its «+N». */
const GROUP_ROWS = 5;

/**
 * A side of the pair's logo and the addresses to try after it, each once (SOL/USDC showed a «U»): USDC's own
 * picture, kept with the site (the engine's logo route answers nothing for it); the coin's own picture through the
 * engine; the engine's logo of a market coin (`/api/icon/<mint>`); the catalogue's logo by the coin's address. The
 * first that loads stands; none — the ticker's letter.
 */
function logosOf(mint: string, own: string | null): readonly string[] {
  const all = [mint === USDC_MINT ? USDC_LOGO : null, own, `/api/icon/${mint}`, spotLogo(mint)];
  return [...new Set(all.filter((src): src is string => Boolean(src)))];
}

/**
 * Any Meteora pool's own desk, the way Meteora lays a pool out and a trading desk reads it: the pair — with the other pools of the pair a tap away — its price and
 * the pool's figures on top, behind one «i» the rest; the coin's chart as the main area with the pool's own liquidity by
 * the price scale and the ticket's lines over the candles; beside it the pool — its liquidity by price, as Meteora
 * draws it, and its book — and the market's trades; on the right the ticket with Meteora's three tabs — Position ·
 * Limit · Swap (`PoolSide.tsx`); under the chart the person's own and the market's tables.
 *
 * A DLMM Pro pool, a DLMM pool and a DAMM v2 pool alike (`useDeskPool.ts`); a DAMM v2 pool has no bins, so no liquidity
 * by price. Every figure is the engine's. Nothing here trades by itself; each tab of the ticket is its own flow.
 */
export function PoolScreen({ address }: { address: string }) {
  const w = useWords(POOL);
  const read = useDeskPool(address);
  return (
    <Page kind="desk" data-pool={address}>
      {read.status === 'ready' ? (
        <PoolDesk key={read.value.address} pool={read.value} />
      ) : (
        <div className={u.lost} role="status">
          <Title as="p">{read.status === 'none' ? w.notFoundAny : read.status === 'failed' ? w.failed : w.looking}</Title>
          {read.status === 'reading' ? null : <QuietLink href="/earn">{w.toEarn}</QuietLink>}
        </div>
      )}
    </Page>
  );
}

function PoolDesk({ pool }: { pool: DeskPool }) {
  const w = useWords(POOL);
  const c = useWords(COIN);
  const d = useWords(DESK);
  const pair = pairOf(pool);
  const mint = pair.coin.mint;
  const side = pair.coin.mint === pool.x.mint ? 'x' : 'y';
  const towers = useMarket().towers;
  const live = useMemo(() => towers.find((tower) => tower.id === mint) ?? null, [towers, mint]);
  const market = useSpotMarket(mint);
  const coin: Tower = useMemo(
    () => live ?? standIn({ mint, symbol: market?.symbol ?? tickerOf(pair.coin), name: market?.name ?? pair.coin.name ?? tickerOf(pair.coin), icon: market?.icon ?? pair.coin.icon, verified: market?.verified ?? pair.coin.verified ?? false }),
    // The market is read again every half minute: the coin is made again only when its name or logo changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, mint, market?.symbol, market?.name, market?.icon, market?.verified],
  );
  const depth = useCoinDepth(mint);
  const tape = useTape(mint);
  const narrow = useNarrow();
  const connected = useWallet((st) => Boolean(st.connection));
  const [chartPrice, setChartPrice] = useState<number | null>(null);
  const [tab, setTab] = useState<UnderTab>('position');
  const [columnTab, setColumnTab] = useState<ColumnTab>('pool');
  const [wide, setWide] = useState(true);
  const binsVenue = binsVenueOf(pool.venue);
  const bins = useBins(binsVenue ?? 'dlmm', binsVenue ? pool.address : null);
  // The menu lights «DLMM Pro» only on a DLMM Pro pool, «Pools» on the others (QA 19.11 ніч, m16).
  useEffect(() => setPoolKind(pool.address, pool.venue === 'pro' ? 'pro' : 'other'), [pool.address, pool.venue]);

  // The coin's dollar price: the chart's own, else the market's, else the catalogue's.
  const usd = chartPrice ?? market?.price ?? pair.coin.usd;
  // DLMM Pro's pools, read once for the page: the pair's other pools beside its name, the pool a limit order rests in,
  // and the dollar price of the coin a pool is priced in (SOL) where the pool itself has no price to read (DAMM v2).
  const proPools = useProPools().read;
  const quoteUsd = useMemo(() => {
    const tower = towers.find((entry) => entry.id === pair.quote.mint);
    if (tower && tower.price > 0) return tower.price;
    if (pair.quote.usd !== null && pair.quote.usd > 0) return pair.quote.usd;
    if (proPools.status !== 'ready') return null;
    for (const row of proPools.value) for (const side of [row.x, row.y]) if (side.mint === pair.quote.mint && side.usd !== null && side.usd > 0) return side.usd;
    return null;
  }, [towers, pair.quote.mint, pair.quote.usd, proPools]);
  const sym = bare(coin.symbol);
  const logo = logoOf({ id: mint, icon: market?.icon ?? coin.icon ?? pair.coin.icon }) ?? `/api/icon/${mint}`;
  const ref = useMemo(() => ({ mint: coin.id, symbol: coin.symbol, name: coin.name, icon: coin.icon }), [coin.id, coin.symbol, coin.name, coin.icon]);
  const pin = useMemo(() => (binsVenue ? { venue: binsVenue, address: pool.address, side: side as 'x' | 'y' } : null), [binsVenue, pool.address, side]);
  // The pool's own price as its bins read it now, for the head: the first read named the pool, this one keeps it current.
  const binsPrice = bins.status === 'ready' && bins.value.price > 0 ? bins.value.price : null;
  const priced = useMemo(() => (binsPrice !== null ? { ...pool, price: binsPrice } : pool), [pool, binsPrice]);

  const pickTab = useCallback((next: UnderTab) => {
    setTab(next);
    if (useDesk.getState().memory.folded.bottom) setDeskFolded('bottom', false);
  }, []);
  const onOrders = useCallback(() => pickTab('orders'), [pickTab]);

  const quote = tickerOf(pair.quote);
  // A pool that holds nothing yet: one line and the way in — its first position — in place of the bars and the book.
  const empty = useMemo(() => {
    if (!binsVenue || bins.status !== 'ready') return false;
    const view = distributionOf(bins.value, side);
    return !view || !view.columns.some((column) => column.share > 0);
  }, [binsVenue, bins, side]);
  // The pool's book stands on its price: the rows over it and under it in view, whatever its height.
  const columnRef = useRef<HTMLDivElement>(null);
  const booked = bins.status === 'ready';
  useEffect(() => {
    if (!booked || columnTab !== 'pool') return;
    const frame = requestAnimationFrame(() => {
      const mid = columnRef.current?.querySelector<HTMLElement>(`.${t.mid}`);
      const box = mid?.closest<HTMLElement>(`.${t.book}`);
      if (!mid || !box || box.scrollHeight <= box.clientHeight) return;
      const top = box.getBoundingClientRect().top - box.scrollTop;
      const at = mid.getBoundingClientRect().top - top;
      const want = Math.max(0, at - (box.clientHeight - mid.offsetHeight) / 2);
      // The book's top row stands whole, never cut in half: the scroll lands on a row's own edge.
      const first = box.querySelector<HTMLElement>('li');
      const rowHeight = first?.offsetHeight ?? 0;
      const from = first ? first.getBoundingClientRect().top - top : 0;
      box.scrollTop = rowHeight > 0 ? Math.max(0, from + Math.floor((want - from) / rowHeight) * rowHeight) : want;
    });
    return () => cancelAnimationFrame(frame);
  }, [booked, columnTab, pool.address]);
  // The column gives «Liquidity by price» the room the book does not need, so a tall desk has no gap over the book; a
  // short one scrolls the book, and its last row, cut by the column's edge, fades out as more to scroll — never a row
  // cut in half (2560 had ~120 px of nothing over the book, 1440 a row cut through).
  // The box is held as state, not a ref: a column folded and opened again, or a desk turned phone, mounts a new box, and
  // its watch starts on that one.
  const [bookBox, setBookBox] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const wrap = bookBox;
    if (!wrap) return;
    const mark = () => {
      const box = wrap.querySelector<HTMLElement>(`.${t.book}`);
      wrap.toggleAttribute('data-below', box !== null && box.scrollTop + box.clientHeight < box.scrollHeight - 2);
    };
    mark();
    // A scroll does not bubble: the column hears its book's on the way down.
    wrap.addEventListener('scroll', mark, true);
    const size = new ResizeObserver(mark);
    size.observe(wrap);
    const rows = new MutationObserver(mark);
    rows.observe(wrap, { childList: true, subtree: true });
    return () => {
      wrap.removeEventListener('scroll', mark, true);
      size.disconnect();
      rows.disconnect();
    };
  }, [bookBox]);
  const way = usePositionWay(pool);
  const book = binsVenue ? <PoolBook address={pool.address} venue={binsVenue} side={side} usd={usd} name={pair.name} bins={bins} /> : null;
  const marketTab = (which: 'market' | 'holders' | 'traders' | 'depth'): ReactNode =>
    which === 'market' ? <MarketTrades tape={tape} sym={sym} /> : which === 'holders' ? <Holders mint={mint} sym={sym} /> : which === 'traders' ? <Traders tape={tape} /> : book;
  const under = (extra: readonly ('market' | 'depth')[]) => <CoinUnder coin={coin} logo={logo} price={usd} tab={tab} onTab={pickTab} onSell={() => useTrade.getState().setSide('sell')} market={marketTab} extra={extra} />;
  const chart = (phone: boolean) => <CoinChart coin={coin} sym={sym} cap={null} trades={tape.trades} tradesStale={tape.stale} onHead={setChartPrice} phone={phone} pool={pin} />;
  const ticket = (
    <div className={p.ticketCol}>
      <PoolSide pool={pool} coin={ref} usd={usd} pro={proPools} onOrders={onOrders} foot={<CoinFacts market={market} depth={depth} />} trade={TICKET_OPEN} />
    </div>
  );
  const column = (
    <div className={t.tape} ref={columnRef}>
      <div className={t.head}>
        <Tabs
          bare
          label={w.column}
          value={columnTab}
          onChange={setColumnTab}
          items={[
            { id: 'pool', label: w.column },
            { id: 'trades', label: w.trades },
          ]}
        />
      </div>
      {columnTab === 'pool' ? (
        <>
          {/* A tokenised stock's session is the ticket's, whole, over its limit and its swap — not a second, cut copy in this
              narrow column («Біржа відкрита · закриється…» stood twice on 1440). */}
          {empty ? (
            <div className={p.emptyPool} role="status">
              <b>{w.emptyTitle}</b>
              {/* «Be the first» only where a first position opens from here. */}
              {way === 'open' ? (
                <QuietLink href={poolHref(pool.address, 'position')} size="s">
                  {w.emptyGo}
                </QuietLink>
              ) : null}
            </div>
          ) : (
            <>
              {binsVenue ? <Distribution bins={bins} side={side} coin={sym} quote={quote} grow /> : null}
              {book ? (
                <div className={p.bookBox} ref={setBookBox}>
                  {book}
                </div>
              ) : (
                <Trades tape={tape} />
              )}
            </>
          )}
        </>
      ) : (
        <Trades tape={tape} />
      )}
    </div>
  );

  return (
    <>
      <PoolHead pool={priced} usd={usd} quoteUsd={quoteUsd} pro={proPools} logoOf={(m) => logosOf(m, m === mint ? logo : logoOf({ id: m, icon: m === pair.quote.mint ? pair.quote.icon : null }))} spot={`/coin/${mint}`} sym={sym} />
      {narrow ? (
        <>
          <div className={u.phoneChart}>{chart(true)}</div>
          <div className={p.phoneBlock}>{column}</div>
          <div className={p.phoneTicket}>
            <PoolSide pool={pool} coin={ref} usd={usd} pro={proPools} onOrders={onOrders} trade={TICKET_OPEN} phone />
          </div>
          <div className={u.phoneUnder}>{under(['market'])}</div>
        </>
      ) : (
        <Desk chart={chart(false)} tape={column} ticket={ticket} bottom={under(wide ? [] : ['market', 'depth'])} tapeLabel={w.column} bottomLabel={connected ? c.under : d.market} onWide={setWide} />
      )}
    </>
  );
}

/**
 * The pool's head, one line: the pair with its two logos and the venue's mark — a tap opens the other pools of the same
 * pair, as Meteora's own head does — the coin's price in dollars and in the coin it is priced in, the pool's four
 * figures, and behind one «i» the rest. DLMM Pro's four: liquidity, what a limit order earns, the fee now, the price's
 * step; DLMM's and DAMM v2's: liquidity, the day's volume and fees, the fee now. The far right stays free.
 */
function PoolHead({ pool, usd, quoteUsd, pro, logoOf: logo, spot, sym }: { pool: DeskPool; usd: number | null; quoteUsd: number | null; pro: Read<readonly ProPoolRow[]>; logoOf: (mint: string) => readonly string[]; spot: string; sym: string }) {
  const w = useWords(POOL);
  const lang = useLang();
  const pair = pairOf(pool);
  const quote = tickerOf(pair.quote);
  // A pool priced in dollars says its price once — in dollars; any other says it in the coin it is priced in too: from
  // the pool's own price, else — a DAMM v2 pool, which has no bins to read it from — from the two coins' dollar prices
  // (1WIN/SOL said «—» where Meteora says 0.000587 SOL).
  const dollars = DOLLAR_MINTS.has(pair.quote.mint);
  const own = !dollars && pool.price !== null && pool.price > 0 ? coinPriceIn({ x: pool.x, y: pool.y, price: pool.price }) : null;
  const inQuote = own ?? (!dollars && usd !== null && usd > 0 && quoteUsd !== null && quoteUsd > 0 ? usd / quoteUsd : null);
  const pct = (bps: number) => digits(pctOfBps(bps), lang);
  const pctOf = (value: number | null) => (value === null ? '—' : pct(value * 100));
  const usdOf = (value: number | null) => (value !== null ? usdText(value, lang) : '—');
  const row = pool.pro;
  const figures: [string, string, ('up' | undefined)?][] = row
    ? [
        [w.liquidity, usdOf(row.tvlUsd)],
        [w.bonus, `+${pct(row.bonusBps)}`, 'up'],
        [w.fee, pct(row.fee.totalBps)],
        [w.step, pct(row.stepBps)],
      ]
    : [
        [w.liquidity, usdOf(pool.tvlUsd)],
        [w.volume24, usdOf(pool.volume24hUsd)],
        [w.fees24, usdOf(pool.fees24hUsd)],
        [w.fee, pctOf(pool.feePct)],
      ];
  const facts: (readonly [string, string])[] = row
    ? [
        [w.baseFee, pct(row.fee.baseBps)],
        [w.dynamicFee, pct(row.fee.dynamicBps)],
        [w.feeMode, row.fee.mode === 'fixed' ? w.modeFixed : row.fee.mode === 'time' ? w.modeTime : w.modeCap],
        [w.protocol, pct(row.fee.protocolShareBps)],
        [w.feeIn, row.fee.collectedIn === 'tokenY' ? tickerOf(row.y) : w.feeOut],
        [w.rewards, row.rewards > 0 ? w.rewardsOn(row.rewards) : '—'],
        [w.kind, row.kind === 'launch' ? w.kindLaunch : row.kind === 'dynamic' ? w.kindDynamic : w.kindStatic],
      ]
    : // DAMM v2 has no price step: no row for it.
      pool.stepBps !== null
      ? [[w.step, pct(pool.stepBps)]]
      : [];
  return (
    <div className={`${h.head} ${p.poolHead}`} data-pool-head="">
      <PairPick pool={pool} pro={pro} logo={logo} />
      <div className={h.quote}>
        {/* A price under a tenth of a cent folds its zeros as the chart does: «$0.0₅9698», not «$0.000009698» across the head. */}
        <b className={h.price}>{usd === null ? '—' : usd < 0.001 ? digits(`$${stepFigure(usd, null)}`, lang) : priceText(usd, lang)}</b>
        {dollars ? null : <span className={p.inQuote}>{inQuote !== null ? `${digits(quoteFigure(inQuote, pool.stepBps), lang)} ${quote}` : '—'}</span>}
      </div>
      <dl className={h.figures}>
        {figures.map(([label, value, tone]) => (
          <div key={label} className={h.figure}>
            <dt>{label}</dt>
            <dd className={tone === 'up' ? p.up : undefined}>{value}</dd>
          </div>
        ))}
      </dl>
      <span className={p.headTools}>
        <Info label={w.details} word={w.details}>
          <span className={p.facts}>
            {facts.map(([label, value]) => (
              <span key={label} className={p.fact}>
                <span>{label}</span>
                <b>{value}</b>
              </span>
            ))}
            <Address address={pool.address} />
            {pool.page ? (
              <a className={p.venueLink} href={pool.page} target="_blank" rel="noopener noreferrer">
                {w.venuePage}
                <Icon name="arrow" size="s" />
              </a>
            ) : null}
          </span>
        </Info>
        <QuietLink href={spot} size="s">
          {/* On a narrow laptop the link says «Spot» and keeps the coin's name for a screen reader. */}
          {w.spotWord}
          <span className={p.spotSym}>{` ${sym}`}</span>
        </QuietLink>
      </span>
      <span className={h.grow} />
    </div>
  );
}

/**
 * The pair as a picker, as Meteora's head has it: a tap lists every pool of the same two coins in groups by kind — DLMM Pro's, limit orders with a bonus; DLMM's, the most liquidity; DAMM v2's — each the deepest first,
 * each row its kind, fee, step and liquidity, and a Pro pool's limit bonus; how the kinds differ is one line behind «i»;
 * the page's own is marked. A tap opens that pool on the same page — its own mark and ticket — on the tab the person
 * stood on where that pool has it. A pair with one pool is its name alone.
 */
function PairPick({ pool, pro, logo }: { pool: DeskPool; pro: Read<readonly ProPoolRow[]>; logo: (mint: string) => readonly string[] }) {
  const w = useWords(POOL);
  const lang = useLang();
  const pair = pairOf(pool);
  const quote = tickerOf(pair.quote);
  const tab = partOf(useAddressTail(), 'tab');
  const [catalog, setCatalog] = useState<readonly EarnPool[]>([]);
  useEffect(() => {
    let live = true;
    void readPools().then((pools) => {
      if (live) setCatalog(pools);
    });
    return () => {
      live = false;
    };
  }, []);
  // The page's own row says the head's figure: one read of the pool, never two numbers for it side by side.
  const pools = useMemo(() => pairPools(pool, pro.status === 'ready' ? pro.value : [], catalog).map((entry) => (entry.here && pool.tvlUsd !== null ? { ...entry, tvlUsd: pool.tvlUsd } : entry)), [pool, pro, catalog]);
  const [open, setOpen] = useState(false);
  // A group shows its deepest five (and the page's own); «+N» opens the rest of it.
  const [whole, setWhole] = useState<ReadonlySet<string>>(() => new Set());
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, box, () => setOpen(false));
  const names = (
    <>
      <span className={p.pair} aria-hidden="true">
        <CoinLogo src={logo(pair.coin.mint)[0] ?? null} also={logo(pair.coin.mint).slice(1)} symbol={tickerOf(pair.coin)} size="l" eager />
        <CoinLogo src={logo(pair.quote.mint)[0] ?? null} also={logo(pair.quote.mint).slice(1)} symbol={quote} size="l" eager />
      </span>
      <span className={h.names}>
        <span className={h.symRow}>
          <b className={h.sym}>{pair.name}</b>
          {pools.length > 1 ? <Icon name="chevron" size="s" /> : null}
        </span>
        <span className={p.badge}>{VENUE_MARK[pool.venue]}</span>
      </span>
    </>
  );
  if (pools.length <= 1) return <span className={p.pairHead}>{names}</span>;
  const pct = (bps: number) => digits(pctOfBps(bps), lang);
  const row = (entry: PairPool) => (
    <li key={entry.address}>
      <Link className={`${h.pickRow} ${p.pairRow}`} href={poolHref(entry.address, carriedTab(tab, entry.venue))} aria-current={entry.here ? 'page' : undefined} data-here={entry.here || undefined} onClick={() => setOpen(false)}>
        <span className={p.pairVenue}>
          {entry.here ? <Icon name="check" size="s" /> : null}
          {VENUE_SHORT[entry.venue]}
          {entry.here ? <span className={p.srOnly}>{` · ${w.thisPool}`}</span> : null}
        </span>
        <b className={p.pairFee}>{entry.feePct !== null ? pct(entry.feePct * 100) : '—'}</b>
        <span className={p.pairStep}>{entry.stepBps !== null ? pct(entry.stepBps) : ''}</span>
        <b className={p.pairNum}>{entry.tvlUsd !== null ? usdText(entry.tvlUsd, lang) : '—'}</b>
        <b className={`${p.pairNum} ${p.up}`}>{entry.bonusBps !== null ? `+${pct(entry.bonusBps)}` : ''}</b>
      </Link>
    </li>
  );
  return (
    <div className={h.anchor} ref={box}>
      <button type="button" className={`${u.pickBtn} ${p.pairBtn}`} aria-haspopup="dialog" aria-expanded={open} aria-label={`${pair.name} — ${w.otherPools}`} onClick={() => setOpen((was) => !was)}>
        {names}
      </button>
      {open ? (
        <div className={`${h.picker} ${p.pairPicker}`} role="dialog" aria-label={w.otherPools}>
          <div className={p.pairTitle}>
            <span>{w.otherPools}</span>
            <Info label={w.pairDiffer}>{w.pairWhy}</Info>
          </div>
          <div className={`${h.pickList} ${p.pairList}`}>
            {pairGroups(pools).map((group) => {
              const shown = whole.has(group.venue) ? group.pools : group.pools.filter((entry, at) => at < GROUP_ROWS || entry.here);
              const rest = group.pools.length - shown.length;
              return (
              <section key={group.venue} className={p.pairGroup} aria-label={VENUE_MARK[group.venue]} data-pair-group={group.venue}>
                <p className={p.pairGroupHead}>
                  <b>{VENUE_MARK[group.venue]}</b>
                  {group.venue === 'pro' ? <span>{` · ${w.groupPro}`}</span> : group.venue === 'dlmm' ? <span>{` · ${w.groupDlmm}`}</span> : null}
                </p>
                <p className={p.pairCols} aria-hidden="true">
                  <span>{w.colVenue}</span>
                  <span>{w.fee}</span>
                  <span>{group.venue === 'damm' ? '' : w.step}</span>
                  <span>{w.liquidity}</span>
                  <span>{group.venue === 'pro' ? w.bonus : ''}</span>
                </p>
                <ul className={p.pairRows}>{shown.map(row)}</ul>
                {rest > 0 ? (
                  <button type="button" className={p.pairMore} onClick={() => setWhole((was) => new Set(was).add(group.venue))}>
                    {`+${digits(String(rest), lang)}`}
                  </button>
                ) : null}
              </section>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Address({ address }: { address: string }) {
  const w = useWords(POOL);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1_600);
    } catch {
      // The browser keeps its clipboard shut: the address stays on screen to select.
    }
  };
  return (
    <span className={p.fact} data-address="">
      <span>{w.address}</span>
      <code className={p.address}>{address}</code>
      <button type="button" className={u.iconBtn} aria-label={w.copy} title={copied ? w.copied : w.copy} onClick={() => void copy()} data-done={copied || undefined}>
        {copied ? <Icon name="check" size="s" /> : <CoinGlyph name="copy" />}
      </button>
    </span>
  );
}
