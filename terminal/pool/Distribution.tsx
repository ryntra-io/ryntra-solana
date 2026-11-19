'use client';

import { useMemo } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { EarnBinsAnswer } from '@/lib/earn-pools/bins';
import type { BinsState } from '@/terminal/earn/range/useBins';
import { distributionOf, quoteFigure } from './pool-view';
import { POOL } from './words';
import p from './pool.module.css';

/** A price of the coin in the coin it is priced in, short: as many figures as the pool's step needs, zeros folded. */
const short = (value: number, stepBps: number, lang: ReturnType<typeof useLang>) => digits(quoteFigure(value, stepBps), lang);

/**
 * «Liquidity by price», as Meteora draws it beside a pool: a column a step of the pool's price, as tall as
 * what lies on it; under the price the coin it is priced in (mint), over it the coin itself (violet), the price's own
 * step both, and the pool's price as a dashed rule with its tag. Prices run left to right in the coin's own terms
 * («SOL per MET»). Every column is the chain's read (`/api/v1/earn/pro/bins`).
 */
export function Distribution({ bins, side, coin, quote }: { bins: BinsState; side: 'x' | 'y'; coin: string; quote: string }) {
  const w = useWords(POOL);
  const lang = useLang();
  const answer: EarnBinsAnswer | null = bins.status === 'ready' ? bins.value : null;
  const view = useMemo(() => (answer ? distributionOf(answer, side) : null), [answer, side]);
  if (!view) {
    return <div className={p.distWait} aria-busy={bins.status === 'reading' || undefined} role="status" aria-label={bins.status === 'reading' ? w.looking : w.empty} />;
  }
  if (!view.columns.some((column) => column.share > 0)) {
    return (
      <p className={p.quietLine} role="status">
        {w.empty}
      </p>
    );
  }
  const pair = `${coin} / ${quote}`;
  return (
    <figure className={p.dist} aria-label={w.distributionLabel(pair)}>
      <div className={p.distPlot} style={{ ['--here' as string]: `${view.herePct}%` }}>
        {view.columns.map((column) => (
          <span
            key={column.id}
            className={p.distCol}
            data-side={column.side}
            style={{ ['--h' as string]: `${Math.max(column.share > 0 ? 3 : 0, Math.round(column.share * 100))}%`, ['--coin' as string]: `${Math.round(column.coinShare * 100)}%` }}
            title={`${short(column.price, answer!.stepBps, lang)} ${quote}`}
          />
        ))}
        <span className={p.distHere} aria-hidden="true">
          <span className={p.distTag}>{w.poolPrice}</span>
        </span>
      </div>
      <figcaption className={p.distAxis}>
        <span>{short(view.low, answer!.stepBps, lang)}</span>
        <b>
          {short(view.price, answer!.stepBps, lang)} {quote}
        </b>
        <span>{short(view.high, answer!.stepBps, lang)}</span>
      </figcaption>
    </figure>
  );
}
