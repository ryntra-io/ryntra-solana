'use client';

import { useState } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { launchOpenHere, useLaunch } from '@/city/lib/launch/district';
import { logPosition, logValue, usdShort } from '@/city/lib/partners/calc';
import { CREATOR, CREATOR_CURVE_PERCENT, creatorEarns, percent } from '@/city/lib/partners/facts';
import { Info, openLaunchSheet, Slider } from './bits';
import { LockGlyph } from './glyphs';
import s from './partners.module.css';
import { PARTNERS } from './words';

const CURVE = { min: 1_000, max: 1_000_000 } as const;
const POOL = { min: 1_000, max: 5_000_000 } as const;

/**
 * The creator's tab (CITY-126): what a creator's own coin pays them, from the launch preset's terms — the share of the
 * curve's volume and an example of the graduated pool. The share of a partner who brings a creator is the operator's to
 * decide (D-P1), so no figure stands for it: the card says «Coming». The arithmetic sits behind «i».
 */
export function CreatorTab() {
  const lang = useLang();
  const w = useWords(PARTNERS);
  const [curve, setCurve] = useState(75_000);
  const [pool, setPool] = useState(250_000);
  const [model, setModel] = useState(false);
  // Only where the Launch docks open their sheet: a closed district is never a button that leads nowhere.
  const launchOpen = useLaunch(launchOpenHere);
  const earns = creatorEarns(curve, pool);
  const usd = (value: number) => digits(usdShort(value), lang);
  return (
    <div className={s.creator}>
      <div className={s.result}>
        <div className={s.resultMain}>
          <span className={s.resultLabel}>{w.creatorCoin}</span>
          <b className={`${s.display} ${s.resultBig}`}>
            {percent(CREATOR_CURVE_PERCENT, lang)}
            <small>{w.creatorBig}</small>
          </b>
        </div>
        <Info open={model} label={w.details} onToggle={() => setModel((v) => !v)} className={s.infoInline} />
        <div className={s.resultRow}>
          <span>
            {w.creatorFromCurve}
            <b>{usd(earns.curve)}</b>
          </span>
          <span>
            {w.creatorFromPool} · {w.creatorExample}
            <b>{usd(earns.pool)}</b>
          </span>
        </div>
      </div>
      {model ? (
        <ul className={`${s.notes} ${s.rules}`}>
          <li>{w.creatorModelCurve(percent(CREATOR.curveFeePercent, lang), percent(CREATOR.curveSharePercent, lang))}</li>
          <li>{w.creatorModelPool(percent(CREATOR.poolFeePercent, lang), percent(CREATOR.poolSharePercent, lang))}</li>
          <li>{w.creatorModelLink}</li>
        </ul>
      ) : null}
      <div className={s.inputs}>
        <Slider label={w.creatorCurve} value={usd(curve)} position={logPosition(curve, CURVE.min, CURVE.max)} onChange={(t) => setCurve(logValue(t, CURVE.min, CURVE.max))} />
        <Slider label={w.creatorPool} value={usd(pool)} position={logPosition(pool, POOL.min, POOL.max)} onChange={(t) => setPool(logValue(t, POOL.min, POOL.max))} />
      </div>
      <div className={s.locked}>
        <span className={s.lockMark}>
          <LockGlyph />
        </span>
        <b className={`${s.display} ${s.lockName}`}>{w.creatorPartner}</b>
        <span className={`${s.pill} ${s.pillWait}`}>{w.soon}</span>
      </div>
      {launchOpen ? (
        <button type="button" className={`${s.display} ${s.action}`} onClick={openLaunchSheet}>
          {w.creatorLaunch}
        </button>
      ) : null}
    </div>
  );
}
