'use client';

import { count } from '@/city/lib/chart/facts';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { DepthCoin, DepthWindow } from '@/lib/market-depth/model';
import type { SpotMarket } from '@/lib/spot/markets';
import { buyShare } from '@/terminal/market/depth-view';
import { IssuerPowers } from '@/terminal/stocks/IssuerPowers';
import { Info } from '@/terminal/ui';
import { DESK } from './desk-words';
import { aboutOf } from './head-view';
import type { CoinPassport } from './passport/passport-data';
import { PASSPORT } from './passport/words';
import f from './facts.module.css';

const WINDOWS: readonly DepthWindow[] = ['5m', '1h', '6h', '24h'];
const WINDOW_WORDS: Readonly<Record<DepthWindow, Readonly<{ en: string; uk: string }>>> = {
  '5m': { en: '5m', uk: '5 хв' },
  '1h': { en: '1h', uk: '1 год' },
  '6h': { en: '6h', uk: '6 год' },
  '24h': { en: '24h', uk: '24 год' },
};

/**
 * «About the coin», one block: who holds it — the holders, the ten largest
 * holders' share, the creator (what they hold, how many coins they launched and how many of those listed) — and its
 * rights in plain words, a stock's issuer's among them; under them the buys against the sells over 5 minutes, an hour,
 * six hours and a day. The coin's passport speaks first; the market's and the depth's reads fill what it lacks. A row
 * nobody can fill is not drawn: a creator nobody names leaves no «—» behind. Where the sources stand — behind «i».
 * `issuerPowers` — a stock's issuer's powers in «Rights»; off where the stock's own facts stand beside and say them.
 */
export function CoinFacts({ market, depth, passport, flow = true, issuerPowers = true }: { market: SpotMarket | null; depth: DepthCoin | null; passport?: CoinPassport | null; flow?: boolean; issuerPowers?: boolean }) {
  const d = useWords(DESK);
  const p = useWords(PASSPORT);
  const lang = useLang();
  if (!market && !depth && !passport) return null;
  const about = aboutOf({ market, depth, passport: passport ?? null }, lang);
  return (
    <section className={f.facts} aria-label={d.facts}>
      <div className={f.headRow}>
        <span className={f.title}>{d.facts}</span>
        <Info label={d.facts}>{d.factsWhy}</Info>
      </div>
      {/* The cells say it once: no sentence on top that repeats them (flaws 79 and 124 — «Creator launched 3
          coins, 1 listed; top 10 hold 25%» stood over «Top 10 hold 25%» and «Creator's coins 3 · 1 listed»). */}
      <dl className={f.grid}>
        <div className={f.cell}>
          <dt>{d.holders}</dt>
          <dd>{about.holders !== null ? digits(count(about.holders), lang) : '—'}</dd>
        </div>
        <div className={f.cell}>
          <dt>{p.factTop10}</dt>
          <dd data-tone={about.top10.warn ? 'warn' : undefined}>{about.top10.text}</dd>
        </div>
        {about.creatorHolds ? (
          <div className={f.cell}>
            <dt>{p.factCreator}</dt>
            <dd data-tone={about.creatorHolds.warn ? 'warn' : undefined}>{about.creatorHolds.text}</dd>
          </div>
        ) : null}
        {about.creatorCoins ? (
          <div className={f.cell}>
            <dt>{p.factLaunches}</dt>
            <dd>{about.creatorCoins}</dd>
          </div>
        ) : null}
        <div className={f.cell} data-wide="">
          <dt>{d.rights}</dt>
          <dd className={f.rights}>
            {about.rights.map((right) => (
              <span key={right.key} data-tone={right.tone}>
                {right.text}
              </span>
            ))}
            {issuerPowers ? <IssuerPowers mint={market?.mint ?? depth?.id ?? passport?.mint} /> : null}
            {about.rights.length ? null : <span>—</span>}
          </dd>
        </div>
      </dl>
      {flow && depth ? (
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
