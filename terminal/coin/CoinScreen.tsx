'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { run } from '@/city/lib/command/run';
import { useWords } from '@/city/lib/i18n/dict';
import type { Tower } from '@/city/lib/market/types';
import { readCoinFacts } from '@/city/lib/search/sources';
import { coinLink } from '@/city/lib/share/coin-link';
import { useLadder } from '@/city/lib/trade/pro-store';
import { useTrade } from '@/city/lib/trade/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { noteDayMoves, useDayMove } from '@/terminal/market/day-move';
import { logoOf } from '@/terminal/market/depth-view';
import { startSaved, toggleSaved, useSaved } from '@/terminal/market/saved';
import { setAskSubject } from '@/terminal/shell/ask';
import { shelfHref } from '@/terminal/shell/shelves';
import { useAskHere } from '@/terminal/shell/useAskHere';
import { useMarket } from '@/terminal/shell/useMarket';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { POOL } from '@/terminal/pool/words';
import { Icon, Page, QuietLink, Title } from '@/terminal/ui';
import { useCoinDepth } from './CoinDepth';
import { CoinFacts } from './CoinFacts';
import { CoinHead, type HeadCoin } from './CoinHead';
import { CoinUnder, type UnderTab } from './CoinUnder';
import { figure, standIn, type Named } from './coin-view';
import { Desk } from './Desk';
import { setDeskFolded, useDesk } from './desk-store';
import { DESK } from './desk-words';
import { coinDoors } from './doors';
import { Holders, MarketTrades, Traders } from './MarketTabs';
import { bare } from './parts';
import { Liquidity, Tape, type TapeTab } from './Tape';
import { Ticket, TICKET_OPEN } from './Ticket';
import { useSpotMarket, useTape } from './useCoinMarket';
import { useStopsWatch } from './useStopsWatch';
import { COIN } from './words';
import u from './coin.module.css';

/** The chart draws in the browser only: its engine is loaded with the screen, and the frame waits in its place. */
const CoinChart = dynamic(() => import('./CoinChart').then((m) => m.CoinChart), {
  ssr: false,
  loading: () => <div className={u.chartWait} aria-busy="true" />,
});

/** How long «Link copied» stands after a tap on Share. */
const COPIED_MS = 2_000;

type Look = Readonly<{ mint: string; status: 'looking' | 'none' } | { mint: string; status: 'ready'; coin: Named }>;

/**
 * A coin's own screen — the Spot desk. On a desk: the
 * head with the coin as a picker, its price and the trader's figures; the chart on the core 0.14.0 as the main area; the
 * market's trades and liquidity beside it; the ticket the whole height on the right with the coin's facts at its foot;
 * the bottom panel with the person's own and the market's tables. Every border is dragged, the column and the panel
 * fold, and the browser keeps it. On a phone: the coin and its price on top, the chart the whole width, the tables in
 * tabs under it, and Buy and Sell over the tab bar opening the ticket as a sheet.
 *
 * Every figure is the engine's: the market read (`/api/city`), the coin's market (`/api/spot/market`), the candles
 * (`/api/spot/candles`), the trades, holders and pools (`/api/spot/token`), the trade card's price and order
 * (`city/lib/trade/**`). Routes, fees and signatures are the engine's as they are; nothing here trades by itself.
 *
 * The screen names its coin to the agent's line, so «buy 50» means it; a sentence handed here fills the ticket's
 * fields and signs nothing.
 */
export function CoinScreen({ mint }: { mint: string }) {
  const w = useWords(COIN);
  const d = useWords(DESK);
  const towers = useMarket().towers;
  const live = useMemo(() => towers.find((tower) => tower.id === mint) ?? null, [towers, mint]);
  const market = useSpotMarket(mint);
  const look = useNamed(mint, live === null);
  // A coin the market read does not hold is named by whichever answers first: its market (`/api/spot/market`) or the
  // city's search.
  const named = market && !live ? market : null;
  const fromMarket = useMemo(
    () => (named ? standIn({ mint, symbol: named.symbol, name: named.name, icon: named.icon, verified: named.verified }) : null),
    // The market is read again every half minute: the coin is made again only when its name or logo changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mint, named?.symbol, named?.name, named?.icon, named?.verified],
  );
  const outside = useMemo(() => (look?.status === 'ready' ? standIn(look.coin) : null), [look]);
  const coin: Tower | null = live ?? fromMarket ?? outside;
  const depth = useCoinDepth(mint);
  const tape = useTape(mint, true, coin && coin.price > 0 ? coin.price : null);
  const [chartPrice, setChartPrice] = useState<number | null>(null);
  const [tab, setTab] = useState<UnderTab>('position');
  const [tapeTab, setTapeTab] = useState<TapeTab>('trades');
  const [wide, setWide] = useState(true);
  const saved = useSaved((st) => st.mints.includes(mint));
  const [copied, setCopied] = useState(false);
  const narrow = useNarrow();
  const connected = useWallet((st) => Boolean(st.connection));
  const pw = useWords(POOL);
  // The coin's Meteora DLMM Pro pool, where its ticket's ladders rest: its own desk is one tap from the head.
  const proPool = useLadder((st) => (st.mint === mint && st.market.status === 'ready' && st.market.value ? st.market.value.pool : null));

  useEffect(() => startSaved(), []);
  useStopsWatch(mint);
  // The day's move is one figure on every screen: this coin's market read is noted beside the others' reads.
  // Every answer of the coin's market is noted as it comes (each poll is a new answer, even with the same figure).
  useEffect(() => {
    const move = market?.mint === mint ? market.change24hPct : null;
    if (move !== null && move !== undefined) noteDayMoves([{ mint, change: move }], Date.now());
  }, [mint, market]);
  const dayMove = useDayMove(mint);

  // The agent's line knows which coin is in front: «buy 50» means this one.
  const symbol = coin?.symbol ?? null;
  const name = coin?.name ?? null;
  const icon = coin?.icon ?? null;
  useEffect(() => {
    if (!symbol || !name) return;
    setAskSubject({ mint, symbol, name, icon: icon ? `/api/icon/${mint}` : null, tower: live !== null });
    return () => setAskSubject(null);
  }, [mint, symbol, name, icon, live]);

  // A sentence handed to this screen fills the ticket's own fields; the person confirms there.
  useAskHere((ask) => run(ask.command, coinDoors(mint)));

  // «My orders» from another screen (the Swap screen's Limit tab) arrives as `#orders`: the orders open.
  useEffect(() => {
    if (window.location.hash === '#orders') setTab('orders');
  }, [mint]);

  const share = useCallback(async () => {
    const url = coinLink(mint);
    try {
      if (typeof navigator.share === 'function') return await navigator.share({ url });
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // The person closed the share sheet, or the browser keeps its clipboard shut: nothing to say.
    }
  }, [mint]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  // A tab picked on a folded bottom panel opens it.
  const pickTab = useCallback((next: UnderTab) => {
    setTab(next);
    if (useDesk.getState().memory.folded.bottom) setDeskFolded('bottom', false);
  }, []);

  if (!coin) {
    return (
      <div className={u.lost} role="status">
        <Title as="p">{look?.status === 'none' ? w.notFound : w.looking}</Title>
        {look?.status === 'none' ? <QuietLink href={shelfHref('market', 'live')}>{w.toMarket}</QuietLink> : null}
      </div>
    );
  }

  const sym = bare(coin.symbol);
  const measured = figure(coin, 'price');
  // The chart's own price first — the live price, else the engine's newest close — so the head and the last bar agree.
  const price = chartPrice ?? market?.price ?? depth?.price ?? (measured !== null && measured > 0 ? measured : null);
  const change = dayMove ?? market?.change24hPct ?? depth?.stats['24h']?.change ?? figure(coin, 'change24h');
  const logo = logoOf({ id: mint, icon: market?.icon ?? depth?.icon ?? coin.icon });
  const head: HeadCoin = { mint, symbol: coin.symbol, name: market?.name ?? coin.name, logo, verified: market?.verified ?? coin.verified };
  // The supply the market cap is counted on: Jupiter's capitalisation over its price; a company's token has none.
  const stock = coin.district === 'avenue' || depth?.kind === 'stock' || depth?.kind === 'preipo' || market?.category === 'stock';
  const capOf = (mcap: number | null | undefined, at: number | null | undefined) => (mcap != null && at != null && mcap > 0 && at > 0 ? mcap / at : null);
  const cap = stock ? null : (capOf(market?.marketCapUsd, market?.price) ?? capOf(depth?.mcap, depth?.price));
  const ref = { id: coin.id, symbol: coin.symbol, name: coin.name, icon: coin.icon };

  const tools = (
    <span className={u.tools}>
      {proPool ? (
        <QuietLink href={`/pool/${proPool}`} size="s">
          {pw.pro}
        </QuietLink>
      ) : null}
      <button type="button" className={u.iconBtn} aria-label={saved ? w.saved : w.save} title={saved ? w.saved : w.save} aria-pressed={saved} onClick={() => toggleSaved(mint)}>
        <Icon name="star" size="s" />
      </button>
      <span className={u.anchor}>
        <button type="button" className={u.iconBtn} aria-label={w.share} title={w.share} onClick={() => void share()}>
          <Icon name="share" size="s" />
        </button>
        {copied ? (
          <span className={u.copied} role="status">
            {w.copied}
          </span>
        ) : null}
      </span>
    </span>
  );

  const marketTab = (which: 'market' | 'holders' | 'traders' | 'depth'): ReactNode =>
    which === 'market' ? <MarketTrades tape={tape} sym={sym} /> : which === 'holders' ? <Holders mint={mint} sym={sym} /> : which === 'traders' ? <Traders tape={tape} /> : <Liquidity mint={mint} usd={price} />;
  const under = (extra: readonly ('market' | 'depth')[]) => <CoinUnder coin={coin} logo={logo} price={price} tab={tab} onTab={pickTab} onSell={() => useTrade.getState().setSide('sell')} market={marketTab} extra={extra} />;
  const chart = (phone: boolean) => <CoinChart coin={coin} sym={sym} cap={cap} trades={tape.trades} tradesStale={tape.stale} onHead={setChartPrice} phone={phone} />;

  // One page of the template's kind «desk»: the coin's head in the page's head row, then the desk.
  return (
    <Page kind="desk">
      <CoinHead coin={head} market={market} price={price} change={change} tools={tools} />
      {narrow ? (
        <>
          <div className={u.phoneChart}>{chart(true)}</div>
          <div className={u.phoneUnder}>{under(['market'])}</div>
          {TICKET_OPEN ? <PhoneTicket coin={ref} sym={sym} price={price} market={market} depth={depth} onOrders={() => pickTab('orders')} /> : null}
        </>
      ) : (
        <Desk
        chart={chart(false)}
        tape={<Tape mint={mint} tape={tape} usd={price} tab={tapeTab} onTab={setTapeTab} />}
        ticket={
          TICKET_OPEN ? (
            <div className={u.ticketCol}>
              <Ticket coin={ref} modes limits desk usd={price} onOrders={() => pickTab('orders')} foot={<CoinFacts market={market} depth={depth} />} />
            </div>
          ) : (
            <CoinFacts market={market} depth={depth} />
          )
        }
        bottom={under(wide ? [] : ['market', 'depth'])}
        tapeLabel={d.tape}
        bottomLabel={connected ? w.under : d.market}
        onWide={setWide}
      />
      )}
    </Page>
  );
}

/**
 * The phone's ticket: Buy and Sell over the tab bar, each opening the ticket as a sheet on its side — the whole ticket,
 * Market · Limit · Stop, with the coin's facts at its foot. The sheet closes with its grip, a tap over the page, or Escape.
 */
function PhoneTicket({ coin, sym, price, market, depth, onOrders }: { coin: Readonly<{ id: string; symbol: string; name: string; icon: string | null }>; sym: string; price: number | null; market: ReturnType<typeof useSpotMarket>; depth: ReturnType<typeof useCoinDepth>; onOrders: () => void }) {
  const d = useWords(DESK);
  const [open, setOpen] = useState(false);
  const side = useTrade((st) => st.side);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // The sheet takes the focus as it opens; Escape closes it.
    sheet.current?.focus();
    const key = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open]);
  const start = (side: 'buy' | 'sell') => {
    useTrade.getState().setSide(side);
    setOpen(true);
  };
  return (
    <>
      <div className={u.barRoom} aria-hidden="true" />
      <div className={u.buyBar}>
        {/* The verb alone: the coin stands in the head above, and a long name never breaks the button (QA 19.11). */}
        <button type="button" className={u.buyBtn} data-side="buy" aria-label={d.buyCoin(sym)} onClick={() => start('buy')}>
          {d.buyNow}
        </button>
        <button type="button" className={u.buyBtn} data-side="sell" aria-label={d.sellCoin(sym)} onClick={() => start('sell')}>
          {d.sellNow}
        </button>
      </div>
      {/* The ticket stays mounted under the sheet, so what the person typed is still there when it opens again. */}
      <div hidden={!open}>
        <div className={u.sheetScrim} onClick={() => setOpen(false)} aria-hidden="true" />
        <div ref={sheet} tabIndex={-1} className={u.sheet} role="dialog" aria-modal="true" aria-label={side === 'sell' ? d.sellCoin(sym) : d.buyCoin(sym)}>
          <button type="button" className={u.sheetGrip} aria-label={d.close} onClick={() => setOpen(false)} />
          <Ticket coin={coin} limits desk usd={price} onOrders={() => (setOpen(false), onOrders())} foot={<CoinFacts market={market} depth={depth} />} />
        </div>
      </div>
    </>
  );
}

/**
 * The engine's name for a coin the market read does not hold (`city/lib/search/sources.ts`, as the city's search
 * names it): asked once per address, only when the market has no such coin.
 */
function useNamed(mint: string, wanted: boolean): Look | null {
  const [look, setLook] = useState<Look | null>(null);
  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    setLook({ mint, status: 'looking' });
    void readCoinFacts(mint, { signal: controller.signal })
      .then((facts) => {
        if (controller.signal.aborted) return;
        setLook(facts ? { mint, status: 'ready', coin: { mint, symbol: facts.symbol, name: facts.name, icon: facts.icon, verified: facts.verified } } : { mint, status: 'none' });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLook({ mint, status: 'none' });
      });
    return () => controller.abort();
  }, [mint, wanted]);
  return look && look.mint === mint ? look : null;
}
