'use client';

import { pctText, sparkOf, type ProvenStrategy } from '@/city/lib/earn/captain';
import type { Words } from '@/city/lib/earn/words';
import { digits } from '@/city/lib/i18n/dict';
import s from './earn.module.css';

const fallText = (pct: number) => (pct > 0.005 ? `−${pct.toFixed(pct >= 10 ? 1 : 2)}%` : '0%');

/** The record above a copy's card (CITY-99): what the strategy did against holding, its fall, its copies, how long. */
export function CopyRecord({ words, strategy }: { words: Words; strategy: ProvenStrategy }) {
  const w = words.captain;
  const tone = strategy.resultPct > 0.005 ? s.gain : strategy.resultPct < -0.005 ? s.loss : undefined;
  const spark = sparkOf(strategy.series, 300, 56);
  return (
    <figure className={s.past} aria-label={w.vsHold}>
      <figcaption className={s.pastFigures}>
        <span className={s.kicker}>
          {words.pier.styles[strategy.style]} · {digits(w.days(strategy.days))}
        </span>
        <span className={s.recordRow}>
          <span>
            <small>{w.vsHold}</small>
            <b className={tone}>{digits(pctText(strategy.resultPct))}</b>
          </span>
          <span>
            <small>{w.fall}</small>
            <b className={strategy.drawdownPct > 0.005 ? s.loss : undefined}>{digits(fallText(strategy.drawdownPct))}</b>
          </span>
          <span>
            <small>{w.copies}</small>
            <b>{digits(String(strategy.copies))}</b>
          </span>
        </span>
      </figcaption>
      {spark ? (
        <svg className={s.pastPlot} viewBox="0 0 300 56" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" x2="300" y1={spark.zero} y2={spark.zero} className={s.sparkZero} />
          <path d={spark.line} className={`${s.sparkLine} ${strategy.resultPct < 0 ? s.sparkDown : ''}`} />
          <circle cx={spark.end.x - 2} cy={spark.end.y} r="3" className={s.pastDot} />
        </svg>
      ) : null}
    </figure>
  );
}
