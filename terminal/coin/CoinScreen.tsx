'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { count } from '@/city/lib/chart/facts';
import { run } from '@/city/lib/command/run';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Tower } from '@/city/lib/market/types';
import { readCoinFacts } from '@/city/lib/search/sources';
import { coinLink } from '@/city/lib/share/coin-link';
import { useTrade } from '@/city/lib/trade/store';
import { coinName } from '@/terminal/market/market-view';
import { startSaved, toggleSaved, useSaved } from '@/terminal/market/saved';
import { setAskSubject } from '@/terminal/shell/ask';
import { shelfHref } from '@/terminal/shell/shelves';
import { useAskHere } from '@/terminal/shell/useAskHere';
import { useMarket } from '@/terminal/shell/useMarket';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { Chip, CoinLogo, Figure, Icon, Kick, Panel, QuietLink, Title, changeText, changeTone, coinIcon, priceText, usdText } from '@/terminal/ui';
import { CoinFlow, CoinTiles, useCoinDepth } from './CoinDepth';
import { CoinLine } from './CoinLine';
import { CoinUnder, type UnderTab } from './CoinUnder';
import { factsOf, figure, standIn, type FactName, type Named } from './coin-view';
import { coinDoors } from './doors';
import { bare } from './parts';
import { Ticket, TICKET_OPEN } from './Ticket';
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

const FACT_WORDS: Readonly<Record<FactName, 'mcap' | 'liquidity' | 'volume' | 'traders'>> = { mcap: 'mcap', liquidity: 'liquidity', volume24h: 'volume', traders1h: 'traders' };

type Look = Readonly<{ mint: string; status: 'looking' | 'none' } | { mint: string; status: 'ready'; coin: Named }>;

/**
 * A coin's own screen, as the approved design draws it: its head with the price and the day's move, the chart of the
 * engine's candles, the ticket to buy or sell it, the facts the market read measured, and under the chart the
 * person's own position, orders and trades. Every figure is the engine's: the market read (`/api/city`), the candles
 * (`/api/spot/candles`), the trade card's price and order (`city/lib/trade/**`). A coin outside the market read is
 * named by the engine and shown with what the engine has of it — its chart and its ticket.
 *
 * The screen names its coin to the agent's line, so «buy 50» means it; a sentence handed here fills the ticket's
 * fields and signs nothing.
 */
export function CoinScreen({ mint }: { mint: string }) {
  const w = useWords(COIN);
  const lang = useLang();
  const towers = useMarket().towers;
  const live = useMemo(() => towers.find((tower) => tower.id === mint) ?? null, [towers, mint]);
  const look = useNamed(mint, live === null);
  const outside = useMemo(() => (look?.status === 'ready' ? standIn(look.coin) : null), [look]);
  const coin: Tower | null = live ?? outside;
  const [chartPrice, setChartPrice] = useState<number | null>(null);
  const [tab, setTab] = useState<UnderTab>('position');
  const saved = useSaved((st) => st.mints.includes(mint));
  const [copied, setCopied] = useState(false);
  // A phone keeps the ticket under the chart as the approved design draws it: the market price, unless a limit or a stop
  // was asked for.
  const narrow = useNarrow();
  // A desk draws the candles, the buys and sells and the holders; a phone the plain line and four tiles.
  const desk = !narrow;
  const depth = useCoinDepth(mint);
  // The candles chart's own price leaves with the chart: back in A, the live read speaks.
  useEffect(() => {
    if (!desk) setChartPrice(null);
  }, [desk]);

  useEffect(() => startSaved(), []);
  useStopsWatch(mint);

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
  const price = chartPrice ?? depth?.price ?? (measured !== null && measured > 0 ? measured : null);
  const change = depth?.stats['24h']?.change ?? figure(coin, 'change24h');
  const facts = factsOf(coin);
  const ref = { id: coin.id, symbol: coin.symbol, name: coin.name, icon: coin.icon };
  const star = (
    <button type="button" className={u.iconBtn} aria-label={saved ? w.saved : w.save} aria-pressed={saved} onClick={() => toggleSaved(mint)}>
      <Icon name="star" />
    </button>
  );

  return (
    <>
      <div className={u.head}>
        <Link className={u.iconBtn} href={shelfHref('market', 'live')} aria-label={w.back}>
          <Icon name="back" />
        </Link>
        <CoinLogo src={coinIcon(coin)} symbol={sym} size="xl" className={u.logo} />
        <div className={u.names}>
          <div className={u.nameRow}>
            <Title className={u.sym}>{sym}</Title>
            {coin.verified ? (
              <span className={u.vetted}>
                <Chip tone="ok">
                  <Icon name="check" size="s" />
                  {w.verified}
                </Chip>
              </span>
            ) : (
              <Chip tone="warn">{w.unverified}</Chip>
            )}
          </div>
          <span className={u.name}>{coinName(coin)}</span>
        </div>
        <div className={u.quote}>
          <Figure className={u.price} value={price !== null ? priceText(price, lang) : '—'} />
          {change !== null ? (
            <span className={u.move}>
              <span className={u.change} data-tone={changeTone(change)}>
                {changeText(change, lang)}
              </span>
              <span className={u.window}>{w.h24}</span>
            </span>
          ) : null}
        </div>
        <span className={u.grow} />
        <span className={u.deskOnly}>{star}</span>
        <span className={u.anchor}>
          <button type="button" className={u.iconBtn} aria-label={w.share} onClick={() => void share()}>
            <Icon name="share" />
          </button>
          {copied ? (
            <span className={u.copied} role="status">
              {w.copied}
            </span>
          ) : null}
        </span>
      </div>

      <div className={u.grid}>
        <div className={u.main}>
          {desk ? (
            <div className={u.chart}>
              <CoinChart coin={coin} sym={sym} aside={star} onHead={setChartPrice} />
            </div>
          ) : (
            <div className={u.chart}>
              <CoinLine mint={mint} />
            </div>
          )}
          {!desk && depth ? (
            <div className={u.tilesPlace}>
              <CoinTiles coin={depth} />
            </div>
          ) : null}
          {desk && facts.length ? (
            <div className={u.factsRow} role="group" aria-label={w.about}>
              {facts.map((fact) => (
                <div key={fact.name} className={u.tile}>
                  <Kick>{w[FACT_WORDS[fact.name]]}</Kick>
                  <Figure size="s" value={fact.name === 'traders1h' ? count(fact.value) : usdText(fact.value, lang)} />
                </div>
              ))}
            </div>
          ) : null}
          <div className={u.under}>
            <CoinUnder coin={coin} price={price} tab={tab} onTab={setTab} onSell={() => useTrade.getState().setSide('sell')} />
          </div>
        </div>
        <aside className={u.aside}>
          {TICKET_OPEN ? <Ticket coin={ref} modes={!narrow} lean limits usd={price} onOrders={() => setTab('orders')} className={u.ticket} /> : null}
          {desk && depth ? <CoinFlow coin={depth} /> : null}
          {!desk && !depth && facts.length ? (
            <Panel label={w.about} className={u.facts}>
              <div className={u.tiles}>
                {facts.map((fact) => (
                  <div key={fact.name} className={u.tile}>
                    <Kick>{w[FACT_WORDS[fact.name]]}</Kick>
                    <Figure size="s" value={fact.name === 'traders1h' ? count(fact.value) : usdText(fact.value, lang)} />
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
        </aside>
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
