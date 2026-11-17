'use client';

import { useEffect, useState } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { DepthAnswer, DepthCoin, DepthWindow } from '@/lib/market-depth/model';
import { buyShare, countText } from '@/terminal/market/depth-view';
import { usdText } from '@/terminal/ui';
import { COIN_DEPTH } from './depth-words';
import l from './line.module.css';

const WINDOWS: readonly DepthWindow[] = ['5m', '1h', '6h', '24h'];
const WORD = { '5m': 'w5m', '1h': 'w1h', '6h': 'w6h', '24h': 'w24h' } as const;
const REFRESH_MS = 30_000;

/** One coin's depth from the engine (`/api/v1/market/depth?list=saved&mints=`), read again while the screen is open. */
export function useCoinDepth(mint: string): DepthCoin | null {
  const [coin, setCoin] = useState<DepthCoin | null>(null);
  useEffect(() => {
    let live = true;
    setCoin(null);
    const read = () =>
      fetch(`/api/v1/market/depth?list=saved&mints=${encodeURIComponent(mint)}`, { headers: { accept: 'application/json' } })
        .then((res) => (res.ok ? (res.json() as Promise<DepthAnswer>) : null))
        .then((body) => {
          const found = body?.coins.find((c) => c.id === mint) ?? null;
          if (live && found) setCoin(found);
        })
        .catch(() => undefined);
    void read();
    const timer = setInterval(() => document.visibilityState === 'visible' && void read(), REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [mint]);
  return coin;
}

/** Direction A's four tiles under the chart: market cap, liquidity, the day's volume, holders. */
export function CoinTiles({ coin }: { coin: DepthCoin }) {
  const w = useWords(COIN_DEPTH);
  const lang = useLang();
  const tiles: [string, string][] = [
    [w.mcap, coin.mcap === null ? '—' : usdText(coin.mcap, lang)],
    [w.liquidity, coin.liquidity === null ? '—' : usdText(coin.liquidity, lang)],
    [w.volume, coin.stats['24h']?.volume == null ? '—' : usdText(coin.stats['24h'].volume, lang)],
    [w.holders, countText(coin.holders, lang)],
  ];
  return (
    <div className={l.tiles}>
      {tiles.map(([word, value]) => (
        <div key={word} className={l.tile}>
          <span className={l.tileWord}>{word}</span>
          <b className={l.tileValue}>{value}</b>
        </div>
      ))}
    </div>
  );
}

/**
 * «Pro» (B's density, macket `B-Coin`): the coin's buys and sells over 5 minutes, an hour, six hours and a day with the
 * traders and the volume, the holders and the top ten's share, the mint and freeze rights — all Jupiter's, through the
 * engine.
 */
export function CoinFlow({ coin }: { coin: DepthCoin }) {
  const w = useWords(COIN_DEPTH);
  const lang = useLang();
  return (
    <section className={l.flow} aria-label={w.flow}>
      <p className={l.flowTitle}>{w.flow}</p>
      <div className={l.flowTable} role="table" aria-label={w.flow}>
        <div role="row" className={l.flowHead}>
          <span role="columnheader">{w.window}</span>
          <span role="columnheader">{w.buys}</span>
          <span role="columnheader">{w.sells}</span>
          <span role="columnheader">{w.traders}</span>
        </div>
        {WINDOWS.map((window) => {
          const s = coin.stats[window];
          const share = buyShare(s);
          return (
            <div key={window} role="row" className={l.flowRow}>
              <span role="cell" className={l.flowWin}>
                {w[WORD[window]]}
              </span>
              <span role="cell" className={l.buy}>
                {countText(s?.buys ?? null, lang)}
              </span>
              <span role="cell" className={l.sell}>
                {countText(s?.sells ?? null, lang)}
              </span>
              <span role="cell">{countText(s?.traders ?? null, lang)}</span>
              {share !== null ? <span className={l.flowBar} style={{ ['--buy' as string]: `${Math.round(share * 100)}%` }} aria-hidden="true" /> : null}
            </div>
          );
        })}
      </div>
      <div className={l.flowFacts}>
        <span>
          <span className={l.tileWord}>{w.holders}</span>
          <b>{countText(coin.holders, lang)}</b>
        </span>
        <span>
          <span className={l.tileWord}>{w.top10}</span>
          <b>{coin.topHolders === null ? '—' : digits(`${coin.topHolders.toFixed(1)}%`, lang)}</b>
        </span>
        <span>
          <span className={l.tileWord}>{w.rights}</span>
          <b className={l.rights}>
            {coin.mint !== null ? <span data-on={coin.mint === 'on' ? '' : undefined}>{coin.mint === 'on' ? w.mintOn : w.mintOff}</span> : null}
            {coin.freeze !== null ? <span data-on={coin.freeze === 'on' ? '' : undefined}>{coin.freeze === 'on' ? w.freezeOn : w.freezeOff}</span> : null}
            {coin.mint === null && coin.freeze === null ? '—' : null}
          </b>
        </span>
      </div>
    </section>
  );
}
