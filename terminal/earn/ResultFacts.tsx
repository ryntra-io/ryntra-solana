'use client';

import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { solUsd, type PoolResult } from '@/lib/portfolio/pool-result';
import { Info } from '@/terminal/ui';
import { resultTone, sumText } from './rows';
import { EARN } from './words';
import e from './earn.module.css';

/** A day of the year in the language's own form: «18 Nov», «18 лист.». */
export function dayText(ms: number, lang: Lang): string {
  return new Date(ms).toLocaleDateString(lang === 'uk' ? 'uk-UA' : 'en-GB', { day: 'numeric', month: 'short' });
}

/** SOL to three places, the language's digits: what a deposit says. */
const solText = (sol: number, lang: Lang): string => digits(sol.toLocaleString('en-US', { maximumFractionDigits: 3, minimumFractionDigits: 0 }), lang);

/**
 * A DLMM Pro position's result, as its ticket and its pool's page say it: what went in, now, the fees it earned, what
 * the price's move did against holding, the network's and the swap's fees, and the whole — in dollars at SOL's price
 * now. Behind one «i»: how it is counted and from when. What is not known is one line in place of the figures.
 */
export function ResultFacts({ result, solPriceUsd }: { result: PoolResult; solPriceUsd: number | null }) {
  const w = useWords(EARN);
  const lang = useLang();
  const usd = (sol: number | null) => solUsd(sol, solPriceUsd);
  if (result.unknown !== null) {
    const line = result.unknown === 'entry' ? w.resultEntry : result.unknown === 'changed' ? w.resultChanged : result.unknown === 'lost' ? w.resultLost : w.resultPrice;
    return <p className={`${e.cap} ${e.capWrap}`} data-earn-result="unknown">{line}</p>;
  }
  const net = usd(result.net);
  return (
    <div className={e.resultBox} data-earn-result="">
      <dl className={e.kv}>
        <dt>{w.putIn}</dt>
        <dd>{sumText(usd(result.invested), lang)}</dd>
        <dt>{w.feesAll}</dt>
        <dd className={e.up}>{sumText(usd(result.fees), lang, true)}</dd>
        <dt>{w.priceMove}</dt>
        <dd data-tone={resultTone(usd(result.price))}>{sumText(usd(result.price), lang, true)}</dd>
        <dt>{w.costs}</dt>
        <dd>{sumText(usd(result.costs === null ? null : -result.costs), lang, true)}</dd>
      </dl>
      <div className={e.resultNet}>
        <span className={e.headInfo}>
          {w.vsHold}
          <Info label={w.vsHoldTitle}>
            <span className={e.resultWhy}>
              <span>{w.vsHoldWhy}</span>
              {result.since !== null ? <span>{w.since(dayText(result.since, lang))}</span> : null}
              {result.rent !== null && result.rent > 0 ? <span>{w.rentBack(solText(result.rent, lang))}</span> : null}
              {result.rewardsLeftOut ? <span>{w.rewardsOut}</span> : null}
            </span>
          </Info>
        </span>
        <b data-tone={resultTone(net)}>{sumText(net, lang, true)}</b>
      </div>
    </div>
  );
}
