'use client';

import { useMemo, useState } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { calculate, countShort, DEFAULT_INPUT, GROWTH, logPosition, logValue, usdShort, type CalcInput } from '@/city/lib/partners/calc';
import { MIX_IDS, OFFER, percent, receivedPer1000, type MixId } from '@/city/lib/partners/facts';
import { Info, Slider } from './bits';
import s from './partners.module.css';
import { PARTNERS, type PartnersWords } from './words';

const AUDIENCE = { min: 100, max: 1_000_000 } as const;
const VOLUME = { min: 100, max: 100_000 } as const;
const MIX_WORD = { majors: 'mixMajors', mixed: 'mixMixed', memes: 'mixMemes' } as const satisfies Record<MixId, keyof PartnersWords>;

/**
 * The referrer's calculator (CITY-126): five guesses in, twelve months out on the operator's terms (decision 93) — the
 * month-12 figure, the year, what the friends kept by their discount, and the months as bars, the first share's months
 * lit. The model's rules sit behind «i».
 */
export function Calculator() {
  const lang = useLang();
  const w = useWords(PARTNERS);
  const [input, setInput] = useState<CalcInput>(DEFAULT_INPUT);
  const [model, setModel] = useState(false);
  const result = useMemo(() => calculate(input), [input]);
  const peak = Math.max(...result.months.map((m) => m.partner), 1);
  const put = (patch: Partial<CalcInput>) => setInput((prev) => ({ ...prev, ...patch }));
  const usd = (value: number) => digits(usdShort(value), lang);

  return (
    <section className={s.calc} aria-label={w.chart}>
      <div className={s.result}>
        <div className={s.resultMain}>
          <span className={s.resultLabel}>{w.month12}</span>
          <b className={`${s.display} ${s.resultBig}`}>
            {usd(result.month12)}
            <small>{w.perMonth}</small>
          </b>
        </div>
        <Info open={model} label={w.details} onToggle={() => setModel((v) => !v)} className={s.infoInline} />
        <div className={s.resultRow}>
          <span>
            {w.year}
            <b>{usd(result.year)}</b>
          </span>
          <span>
            {w.saved}
            <b>{usd(result.saved)}</b>
          </span>
        </div>
        <div className={s.bars} role="img" aria-label={`${w.chart}: ${result.months.map((m) => usd(m.partner)).join(', ')}`}>
          {result.months.map((m) => (
            <span key={m.month} className={s.bar} data-window={m.first ? '' : undefined}>
              <span className={s.barFill} style={{ transform: `scaleY(${Math.max(0.015, m.partner / peak).toFixed(4)})`, transitionDelay: `${m.month * 22}ms` }} />
            </span>
          ))}
        </div>
        <div className={s.barAxis} aria-hidden="true">
          <span>1</span>
          <span>6</span>
          <span>12</span>
        </div>
        {OFFER ? (
          <div className={s.legend}>
            <span data-window="">{w.legendFirst(percent(OFFER.firstPercent, lang), OFFER.firstDays)}</span>
            <span>{w.legendAfter(percent(OFFER.afterPercent, lang))}</span>
          </div>
        ) : null}
      </div>

      {model && OFFER ? (
        <ul className={`${s.notes} ${s.rules}`}>
          <li>{w.modelCohorts(percent(GROWTH * 100, lang))}</li>
          <li>{w.modelFee(percent(OFFER.discountPercent, lang))}</li>
          <li>{w.modelShare(percent(OFFER.firstPercent, lang), OFFER.firstDays, percent(OFFER.afterPercent, lang))}</li>
          <li>{w.modelPromise}</li>
        </ul>
      ) : null}

      <div className={s.inputs}>
        <Slider
          label={w.calcAudience}
          value={digits(countShort(input.audience), lang)}
          position={logPosition(input.audience, AUDIENCE.min, AUDIENCE.max)}
          onChange={(t) => put({ audience: logValue(t, AUDIENCE.min, AUDIENCE.max) })}
        />
        <Slider label={w.calcShare} value={percent(input.sharePct, lang)} position={(input.sharePct - 0.5) / 19.5} onChange={(t) => put({ sharePct: Math.round((0.5 + t * 19.5) * 2) / 2 })} />
        <Slider
          label={w.calcVolume}
          value={usd(input.volumeUsd)}
          position={logPosition(input.volumeUsd, VOLUME.min, VOLUME.max)}
          onChange={(t) => put({ volumeUsd: logValue(t, VOLUME.min, VOLUME.max) })}
        />
        <Slider label={w.calcRetention} value={percent(input.retentionPct, lang)} position={(input.retentionPct - 30) / 65} onChange={(t) => put({ retentionPct: Math.round((30 + t * 65) / 5) * 5 })} />
        <div className={s.mixField}>
          <span className={s.fieldLabel}>{w.calcMix}</span>
          <div className={s.mixes} role="radiogroup" aria-label={w.calcMix}>
            {MIX_IDS.map((mix) => (
              <button key={mix} type="button" role="radio" aria-checked={input.mix === mix} className={s.mix} onClick={() => put({ mix })}>
                <b>{w[MIX_WORD[mix]]}</b>
                <span>{w.per1000(digits(`$${receivedPer1000(mix).toFixed(2)}`, lang))}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
