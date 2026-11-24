'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { run } from '@/city/lib/command/run';
import { digits, useWords } from '@/city/lib/i18n/dict';
import type { Tower } from '@/city/lib/market/types';
import { readCoinFacts } from '@/city/lib/search/sources';
import { coinLink } from '@/city/lib/share/coin-link';
import { useLadder } from '@/city/lib/trade/pro-store';
import { useTrade } from '@/city/lib/trade/store';
import { payAssetFor } from '@/city/lib/trade/tiles';
import { useWallet } from '@/city/lib/trade/wallet';
import { isNativeToken } from '@/lib/spot/token-page';
import { noteDayMoves, useDayMove } from '@/terminal/market/day-move';
import { logoOf } from '@/terminal/market/depth-view';
import { startSaved, toggleSaved, useSaved } from '@/terminal/market/saved';
import { setAskSubject } from '@/terminal/shell/ask';
import { useAskHere } from '@/terminal/shell/useAskHere';
import { useMarket } from '@/terminal/shell/useMarket';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { POOL } from '@/terminal/pool/words';
import { StockCoinFacts } from '@/terminal/stocks/StockCoinFacts';
import { StockPoolsShelf } from '@/terminal/stocks/pools/StockPoolsShelf';
import { Icon, Page, QuietLink, Tabs } from '@/terminal/ui';
import { useCoinDepth } from './CoinDepth';
import { CoinFacts } from './CoinFacts';
import { CoinHead, type HeadCoin } from './CoinHead';
import { CoinLost } from './CoinLost';
import { answeredReads } from './coin-view';
import { CoinUnder, type MoreTabSpec, type UnderTab } from './CoinUnder';
import { CreatorTab } from './creator/CreatorTab';
import { CREATOR } from './creator/words';
import { figure, standIn, type Named } from './coin-view';
import { Desk } from './Desk';
import { CoinPools, EarnDrawer, EarnHereReads, useCoinHasPool } from './earn-here/EarnHere';
import { openBest, useDrawerReset } from './earn-here/store';
import { setDeskFolded, useDesk } from './desk-store';
import { DESK } from './desk-words';
import { coinDoors } from './doors';
import { HEAD } from './head-words';
import { HoldersMap } from './holders-map/HoldersMap';
import { HOLDER_MAP } from './holders-map/words';
import { Holders, MarketTrades, Traders } from './MarketTabs';
import { bare } from './parts';
import { useLang } from '@/city/lib/i18n/lang';
import { PassportFigures, PassportRiskSentence } from './passport/Passport';
import { headFiguresKnown, riskSentence } from './passport/passport-data.ts';
import { useCoinPassport } from './passport/usePassport';
import { quickSums } from './staples';
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

type Look = Readonly<{ mint: string; status: 'looking' | 'none' | 'failed' } | { mint: string; status: 'ready'; coin: Named }>;

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
 *
 * `creator` — the deployment opens the creator's tab and the largest holders' links (a server switch read by
 * the page): on a desk two tabs of the bottom panel, on a phone two parts of «About».
 */
export function CoinScreen({ mint, creator = false }: { mint: string; creator?: boolean }) {
  const w = useWords(COIN);
  const cw = useWords(CREATOR);
  const lw = useWords(HOLDER_MAP);
  const d = useWords(DESK);
  const hw = useWords(HEAD);
  const towers = useMarket().towers;
  const live = useMemo(() => towers.find((tower) => tower.id === mint) ?? null, [towers, mint]);
  const market = useSpotMarket(mint);
  // The coin's passport: the figures the head lacks, the risk line, «About the coin» — the market read handed in once.
  const { passport, status: passportStatus } = useCoinPassport(mint, { market });
  const passportLang = useLang();
  // The one sentence of risk over the buy button (under the price on a phone): none stands, or the passport did not
  // come — no line at all.
  const risk = riskSentence(passport, passportLang) ? <PassportRiskSentence passport={passport} /> : null;
  const [round, setRound] = useState(0);
  const look = useNamed(mint, live === null, round);
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
  const [view, setView] = useState<PhoneView>('chart');
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
  // Earn's ticket in a drawer over the coin — shut on every coin; «Earn on it» after a buy only where a pool is.
  useDrawerReset(mint);
  const withPool = useCoinHasPool(mint);
  const earnOn = useMemo(() => (withPool ? () => openBest(mint) : undefined), [withPool, mint]);
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
    if (window.location.hash !== '#orders') return;
    setTab('orders');
    setView('mine');
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
    if (next === 'position' || next === 'lp' || next === 'orders' || next === 'trades') setView('mine');
    if (useDesk.getState().memory.folded.bottom) setDeskFolded('bottom', false);
  }, []);

  // No coin to draw: still asked, the engine names none at the address, or it did not answer —
  // a source that is silent never reads as «not found».
  if (!coin) return <CoinLost look={look?.status === 'none' || look?.status === 'failed' ? look.status : 'looking'} onRetry={() => setRound((n) => n + 1)} />;

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

  // The coin's quiet controls: the star and Share stand together on the head's first line on every coin (flaw 76); the
  // door to its DLMM Pro pool is a part of its own, which a phone's head leaves to the desk.
  const tools = (
    <>
      {proPool ? (
        <span className={u.proDoor}>
          <QuietLink href={`/pool/${proPool}`} size="s">
            {pw.pro}
          </QuietLink>
        </span>
      ) : null}
      <span className={u.tools}>
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
    </>
  );

  const marketTab = (which: 'market' | 'holders' | 'traders' | 'depth'): ReactNode =>
    which === 'market' ? <MarketTrades tape={tape} sym={sym} legend={narrow || !wide} /> : which === 'holders' ? <Holders mint={mint} sym={sym} /> : which === 'traders' ? <Traders tape={tape} /> : <Liquidity mint={mint} usd={price} />;
  // A coin with a creator to name: not SOL, not a company's token.
  const withCreator = creator && !stock && !isNativeToken(mint);
  const more: readonly MoreTabSpec[] = withCreator
    ? [
        { id: 'creator', label: cw.tab, draw: () => <CreatorTab mint={mint} /> },
        { id: 'links', label: lw.tab, draw: () => <HoldersMap mint={mint} /> },
      ]
    : [];
  // A phone's panel of the person's own offers «My pools» only: the coin's pools are a view of their own there.
  const under = (extra: readonly ('market' | 'depth')[], phone = false) => (
    <CoinUnder coin={coin} logo={logo} price={price} tab={tab} onTab={pickTab} onSell={() => useTrade.getState().setSide('sell')} market={marketTab} extra={extra} more={more} earn={phone ? 'mine' : 'all'} onPools={phone ? () => setView('pools') : undefined} />
  );
  const chart = (phone: boolean) => <CoinChart coin={coin} sym={sym} cap={cap} trades={tape.trades} tradesStale={tape.stale} onHead={setChartPrice} phone={phone} />;
  // «About the coin»: a company's token says whose it is and how its exchange stands first; then the coin's facts.
  const facts = (flow: boolean) => (
    <>
      {/* On a desk the head says whose token it is and how its exchange stands: the facts do not say it twice (flaw 74). */}
      {stock ? <StockCoinFacts mint={mint} headSays={!narrow} /> : null}
      {/* The stock's pools on Meteora under its facts (not in the phone's sheet); the facts above say the hours and the rights once. */}
      {stock && flow ? <StockPoolsShelf mint={mint} facts={false} /> : null}
      {/* The stock's facts already say what its issuer can do: «Rights» does not say it twice. */}
      <CoinFacts market={market} depth={depth} passport={passport} flow={flow} issuerPowers={!stock} />
    </>
  );

  // «About» on a phone: the coin's facts, then — where the deployment opens them — its creator and its holders' links.
  const about = (
    <div className={u.phoneAbout}>
      {facts(true)}
      {withCreator ? <CreatorTab mint={mint} phone /> : null}
      {withCreator ? <HoldersMap mint={mint} phone /> : null}
    </div>
  );
  /*
   * The phone's views of the coin, in the order they stand: Chart · Trades · Holders · Pools · About, and the person's own once
   * a wallet is in. A task that brings a view of its own adds it here — an id in `PhoneView`, its words in
   * `head-words.ts`, what it draws — and nothing else on this screen changes. What a view draws is its own file's: the
   * chart is `CoinChart`'s, the tables `MarketTabs`' and `CoinUnder`'s.
   */
  const phoneViews: readonly PhoneViewSpec[] = [
    { id: 'chart', label: hw.chart, draw: () => chart(true), keep: true },
    { id: 'trades', label: hw.trades, draw: () => <MarketTrades tape={tape} sym={sym} /> },
    { id: 'holders', label: hw.holders, draw: () => <Holders mint={mint} sym={sym} /> },
    { id: 'pools', label: hw.pools, draw: () => <CoinPools mint={mint} sym={sym} phone /> },
    { id: 'about', label: hw.about, draw: () => about, page: true },
    ...(connected ? [{ id: 'mine' as const, label: hw.mine, draw: () => under([], true) }] : []),
  ];
  const shownView: PhoneView = phoneViews.some((one) => one.id === view) ? view : 'chart';

  // One page of the template's kind «desk»: the coin's head in the page's head row, then the desk.
  return (
    <Page kind="desk">
      <CoinHead coin={head} market={market} price={price} change={change} tools={tools} figures={headFiguresKnown(passport) || (!passport && passportStatus === 'reading') ? <PassportFigures passport={passport} status={passportStatus} /> : undefined} stockMint={stock ? mint : null} />
      {narrow ? (
        <>
          {/* Under the price: the one sentence of risk, when the coin has one — its facts stand in «About». */}
          {risk ? <div className={u.phoneRisk}>{risk}</div> : null}
          <div className={u.phoneViews}>
            <div className={u.phoneTabs}>
              <Tabs bare fill label={hw.views} value={shownView} onChange={setView} items={phoneViews.map(({ id, label }) => ({ id, label }))} />
            </div>
            {phoneViews.map((one) =>
              one.id === shownView || one.keep ? (
                <div key={one.id} className={u.phonePane} data-view={one.id} data-page={one.page ? '' : undefined} hidden={one.id !== shownView}>
                  {one.draw()}
                </div>
              ) : null,
            )}
          </div>
          {TICKET_OPEN ? <PhoneTicket coin={ref} sym={sym} price={price} foot={facts(false)} supply={cap} onOrders={() => pickTab('orders')} onEarn={earnOn} /> : null}
        </>
      ) : (
        <Desk
          chart={chart(false)}
          tape={<Tape mint={mint} tape={tape} usd={price} tab={tapeTab} onTab={setTapeTab} />}
          ticket={
            TICKET_OPEN ? (
              <div className={u.ticketCol}>
                <Ticket coin={ref} modes limits desk usd={price} onOrders={() => pickTab('orders')} onEarn={earnOn} foot={facts(true)} risk={risk ?? undefined} supply={cap} />
              </div>
            ) : (
              facts(true)
            )
          }
          bottom={under(wide ? [] : ['market', 'depth'])}
          tapeLabel={d.tape}
          bottomLabel={connected ? w.under : d.market}
          onWide={setWide}
        />
      )}
      <EarnHereReads />
      <EarnDrawer mint={mint} sym={sym} />
    </Page>
  );
}

/** The phone's views of the coin; the registry stands in `CoinScreen`. */
type PhoneView = 'chart' | 'trades' | 'holders' | 'pools' | 'about' | 'mine';
/**
 * One view: its words, what it draws. `keep` — it stays mounted while another view is open (the chart keeps its
 * candles and its tools); `page` — it stands in the page, not in a box of its own height.
 */
type PhoneViewSpec = Readonly<{ id: PhoneView; label: string; draw: () => ReactNode; keep?: boolean; page?: boolean }>;

/**
 * The phone's ticket: Buy and Sell over the tab bar, a thumb's reach, with the quick sums over them — a sum opens the
 * ticket on the buy side with that amount in its field, where the person reads the price and confirms; nothing is
 * signed from the bar. Each button opens the ticket as a sheet on its side — the whole ticket, Market · Limit · Stop,
 * with the coin's facts at its foot. The sheet closes with its grip, a tap over the page, or Escape. The page keeps room
 * for the bar under its last block, so the bar never covers a table's last rows.
 */
function PhoneTicket({ coin, sym, price, foot, supply, onOrders, onEarn }: { coin: Readonly<{ id: string; symbol: string; name: string; icon: string | null }>; sym: string; price: number | null; foot: ReactNode; supply: number | null; onOrders: () => void; onEarn?: () => void }) {
  const d = useWords(DESK);
  const hw = useWords(HEAD);
  const [open, setOpen] = useState(false);
  const side = useTrade((st) => st.side);
  // The quick sums are in what a buy is paid with on this coin's ticket: SOL, or dollars with USDC or USDT.
  const payMint = useTrade((st) => (st.tower?.mint === coin.id ? payAssetFor(coin.id, st.pay, st.other).mint : null));
  const paySymbol = useTrade((st) => (st.tower?.mint === coin.id ? bare(payAssetFor(coin.id, st.pay, st.other).symbol) : null));
  const quick = payMint ? quickSums(payMint) : null;
  // The sum the ticket holds now, when it is one of the quick sums: it stands chosen, so the bar says what «Buy» opens
  // with (flaw 77: none was marked).
  const held = useTrade((st) => (st.tower?.mint === coin.id && st.side === 'buy' ? st.typed : null));
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
  // A quick sum fills the buy's field and opens the ticket: the price and the button stand there, under the person's eye.
  const startWith = (sum: string) => {
    const trade = useTrade.getState();
    trade.setSide('buy');
    trade.setTyped(sum);
    setOpen(true);
  };
  const unit = quick?.dollars ? null : paySymbol;
  return (
    <>
      <div className={u.barRoom} data-quick={quick ? '' : undefined} aria-hidden="true" />
      <div className={u.buyBar} data-quick={quick ? '' : undefined}>
        {quick ? (
          <div className={u.quick} role="group" aria-label={hw.quick}>
            {unit ? <span className={u.quickUnit}>{unit}</span> : null}
            {quick.sums.map((sum) => (
              <button key={sum} type="button" className={u.quickBtn} aria-pressed={held !== null && Number(held) === Number(sum)} aria-label={hw.quickBuy(quick.dollars ? `$${sum}` : `${sum} ${unit ?? ''}`.trim())} onClick={() => startWith(sum)}>
                {quick.dollars ? `$${digits(sum)}` : digits(sum)}
              </button>
            ))}
          </div>
        ) : null}
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
          <Ticket coin={coin} limits desk usd={price} onOrders={() => (setOpen(false), onOrders())} onEarn={onEarn ? () => (setOpen(false), onEarn()) : undefined} foot={foot} supply={supply} />
        </div>
      </div>
    </>
  );
}

/**
 * The engine's name for a coin the market read does not hold (`city/lib/search/sources.ts`, as the city's search
 * names it): asked once per address (and again on `round`), only when the market has no such coin. «None» only when
 * every read the search made was answered and named no coin; a read that failed — the network, the engine's 5xx, its
 * limit — makes it «failed», never «not found».
 */
function useNamed(mint: string, wanted: boolean, round = 0): Look | null {
  const [look, setLook] = useState<Look | null>(null);
  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    const reads = answeredReads();
    setLook({ mint, status: 'looking' });
    void readCoinFacts(mint, { signal: controller.signal, fetch: reads.fetch })
      .then((facts) => {
        if (controller.signal.aborted) return;
        setLook(facts ? { mint, status: 'ready', coin: { mint, symbol: facts.symbol, name: facts.name, icon: facts.icon, verified: facts.verified } } : { mint, status: reads.failed() ? 'failed' : 'none' });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLook({ mint, status: 'failed' });
      });
    return () => controller.abort();
  }, [mint, wanted, round]);
  return look && look.mint === mint ? look : null;
}
