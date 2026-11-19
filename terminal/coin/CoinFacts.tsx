'use client';

import { count } from '@/city/lib/chart/facts';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { DepthCoin, DepthWindow } from '@/lib/market-depth/model';
import type { SpotMarket } from '@/lib/spot/markets';
import { buyShare } from '@/terminal/market/depth-view';
import { Info } from '@/terminal/ui';
import { DESK } from './desk-words';
import f from './facts.module.css';

const WINDOWS: readonly DepthWindow[] = ['5m', '1h', '6h', '24h'];
const WINDOW_WORDS: Readonly<Record<DepthWindow, Readonly<{ en: string; uk: string }>>> = {
  '5m': { en: '5m', uk: '5 хв' },
  '1h': { en: '1h', uk: '1 год' },
  '6h': { en: '6h', uk: '6 год' },
  '24h': { en: '24h', uk: '24 год' },
};

const pct = (value: number | null, lang: 'en' | 'uk') => (value === null ? '—' : digits(`${value < 10 ? value.toFixed(1) : Math.round(value)}%`, lang));

/**
 * The coin's facts at the ticket's foot, one block: the holders, the ten largest holders' share and the
 * creator's, the mint's rights; under them the buys against the sells over 5 minutes, an hour, six hours and a day.
 * Where the sources stand and what a right means — behind «i». All Jupiter's and the chain's, through the engine.
 */
export function CoinFacts({ market, depth }: { market: SpotMarket | null; depth: DepthCoin | null }) {
  const d = useWords(DESK);
  const lang = useLang();
  const holders = market?.holders ?? depth?.holders ?? null;
  const top = market?.audit.topHoldersPct ?? depth?.topHolders ?? null;
  const dev = market?.audit.devBalancePct ?? null;
  const mint = market ? (market.audit.mintAuthorityDisabled === null ? null : market.audit.mintAuthorityDisabled ? 'off' : 'on') : (depth?.mint ?? null);
  const freeze = market ? (market.audit.freezeAuthorityDisabled === null ? null : market.audit.freezeAuthorityDisabled ? 'off' : 'on') : (depth?.freeze ?? null);
  if (!market && !depth) return null;
  return (
    <section className={f.facts} aria-label={d.facts}>
      <div className={f.headRow}>
        <span className={f.title}>{d.facts}</span>
        <Info label={d.facts}>{d.factsWhy}</Info>
      </div>
      <dl className={f.grid}>
        <div className={f.cell}>
          <dt>{d.holders}</dt>
          <dd>{holders !== null ? digits(count(holders), lang) : '—'}</dd>
        </div>
        <div className={f.cell}>
          <dt>{d.top10}</dt>
          <dd data-tone={top !== null && top >= 50 ? 'warn' : undefined}>{pct(top, lang)}</dd>
        </div>
        <div className={f.cell}>
          <dt>{d.dev}</dt>
          <dd data-tone={dev !== null && dev >= 10 ? 'warn' : undefined}>{pct(dev, lang)}</dd>
        </div>
        <div className={f.cell}>
          <dt>{d.rights}</dt>
          <dd className={f.rights}>
            {mint !== null ? <span data-tone={mint === 'on' ? 'warn' : 'ok'}>{mint === 'on' ? d.mintOn : d.mintOff}</span> : null}
            {freeze !== null ? <span data-tone={freeze === 'on' ? 'warn' : 'ok'}>{freeze === 'on' ? d.freezeOn : d.freezeOff}</span> : null}
            {mint === null && freeze === null ? '—' : null}
          </dd>
        </div>
      </dl>
      {depth ? (
        <div className={f.flow} role="table" aria-label={d.flowWhy}>
          {WINDOWS.map((window) => {
            const stats = depth.stats[window];
            const share = buyShare(stats);
            return (
              <div key={window} role="row" className={f.flowRow}>
                <span role="cell" className={f.win}>
                  {WINDOW_WORDS[window][lang]}
                </span>
                <span role="cell" className={f.buys}>
                  {stats?.buys != null ? digits(count(stats.buys), lang) : '—'}
                </span>
                <span role="cell" className={f.bar} aria-hidden="true" style={{ ['--buy' as string]: `${share !== null ? Math.round(share * 100) : 50}%` }} />
                <span role="cell" className={f.sells}>
                  {stats?.sells != null ? digits(count(stats.sells), lang) : '—'}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
