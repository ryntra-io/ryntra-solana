'use client';

import { useMemo } from 'react';
import { pctText, sparkOf, type ProvenStrategy } from '@/city/lib/earn/captain';
import { RISK } from '@/city/lib/earn/flag';
import { useEarn } from '@/city/lib/earn/open';
import { pierOf, solPiers, STYLE_RISK, type Pier } from '@/city/lib/earn/pier';
import { PIER_MODE } from '@/city/lib/earn/pier-gate';
import { PIER_LOCKED, usePier } from '@/city/lib/earn/pier-store';
import { useEarnData } from '@/city/lib/earn/store';
import type { Words } from '@/city/lib/earn/words';
import { useZap } from '@/city/lib/earn/zap-store';
import { digits } from '@/city/lib/i18n/dict';
import { BackGlyph, CityFrame, Coin, Line, Notify, RiskDots } from './bits';
import { PierCard, StyleGlyph } from './PierCard';
import s from './earn.module.css';

/**
 * «Like the Captain» (CITY-99): strategies with a proven record — the city's own pier recipes, each with at least
 * thirty days of record and copies from at least five wallets. A card shows the record against holding at full size,
 * its deepest fall always beside it, how many copied it and for how long, and one action: copy. Copying opens the
 * strategy's pier with its style fixed; the person chooses the amount and signs in their own wallet. Until a strategy
 * has a record, a calm window says when one will show — nothing is drawn that is not measured.
 */
export function Captain({ words }: { words: Words }) {
  const name = words.products.captain.name;
  const w = words.captain;
  const read = useEarnData((st) => st.captain);
  const list = useEarnData((st) => st.piers);
  const pool = usePier((st) => st.pool);
  const copy = usePier((st) => st.copy);
  const phase = usePier((st) => st.phase);

  const piers = useMemo(() => new Map<string, Pier>(list.status === 'ready' ? solPiers(list.value.pools).map((pier) => [pier.pool.address, pier]) : []), [list]);
  // Only a strategy on a pier listed now can be copied from here: the others wait off the card.
  const strategies = read.status === 'ready' ? read.value.strategies.filter((strategy) => piers.has(strategy.pool)) : [];

  const copying = pool && copy ? pierOf(pool) : null;
  const strategy = copy && read.status === 'ready' ? read.value.strategies.find((st) => st.id === copy.strategy) ?? null : null;
  if (copying && strategy) return <PierCard words={words} pier={copying} copy={strategy} />;

  const loading = read.status === 'idle' || read.status === 'loading' || list.status === 'loading' || list.status === 'idle';
  return (
    <section className={s.product} aria-label={name}>
      <button type="button" className={s.back} onClick={() => useEarn.getState().openProduct(null)} disabled={PIER_LOCKED.has(phase)}>
        <BackGlyph />
        {words.back}
      </button>
      {/* The cards are the screen once there are records; the live city heads the calm window. */}
      {strategies.length ? null : <CityFrame district="harbor" />}
      <div className={s.cardHead}>
        <h3 className={`${s.display} ${s.productName}`}>{name}</h3>
        <RiskDots dots={RISK.captain} words={words} />
      </div>

      {strategies.length ? (
        <>
          <span className={s.kicker}>{w.strategies}</span>
          <ul className={s.captainList}>
            {strategies.map((item) => (
              <StrategyCard key={item.id} words={words} strategy={item} pier={piers.get(item.pool)!} />
            ))}
          </ul>
        </>
      ) : loading ? (
        <div className={s.bones} aria-busy="true">
          <span />
          <span />
        </div>
      ) : read.status === 'error' ? (
        <>
          <p className={s.empty}>{words.unavailable}</p>
          <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => void useEarnData.getState().loadCaptain()}>
            {words.tryAgain}
          </button>
        </>
      ) : (
        <div className={s.calm}>
          <b className={s.display}>{w.noneTitle}</b>
          <p className={s.lead}>{w.noneLine}</p>
        </div>
      )}

      <Line label={words.details} line={words.products.captain.line}>
        <p className={s.fine}>{w.fine}</p>
      </Line>
      <div className={s.grow} />
      {strategies.length && PIER_MODE === 'open' ? null : <Notify product="captain" words={words} />}
    </section>
  );
}

/** One strategy: its pier and style, the record against holding at full size, its fall, its copies, one action. */
function StrategyCard({ words, strategy, pier }: { words: Words; strategy: ProvenStrategy; pier: Pier }) {
  const w = words.captain;
  const spark = sparkOf(strategy.series, 160, 44);
  const tone = strategy.resultPct > 0.005 ? s.gain : strategy.resultPct < -0.005 ? s.loss : '';
  const pair = pier.lst ? `${pier.lst.symbol} · SOL` : `SOL · ${pier.other.symbol}`;
  const styleName = words.pier.styles[strategy.style];
  const acts = PIER_MODE === 'open';
  const open = (event: { currentTarget: HTMLElement }) => {
    // The copy's card starts at its top, wherever the list was scrolled to.
    let scroller: HTMLElement | null = event.currentTarget.parentElement;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement;
    useZap.getState().reset();
    usePier.getState().openCopy(pier.pool, { strategy: strategy.id, style: strategy.style });
    scroller?.scrollTo({ top: 0 });
  };
  const fall = strategy.drawdownPct > 0.005 ? `−${strategy.drawdownPct.toFixed(strategy.drawdownPct >= 10 ? 1 : 2)}%` : '0%';
  return (
    <li className={`${s.strategy} ${acts ? s.cardLive : ''}`} data-earn-strategy={strategy.id}>
      <button type="button" className={s.cardHit} onClick={open} aria-label={`${w.copy} · ${pair} · ${styleName}`} />
      <div className={s.cardHead}>
        <span className={s.pierTitle}>
          <span className={s.pierCoins} aria-hidden="true">
            <Coin mint={pier.other.mint} size={26} symbol={pier.other.symbol} />
            <Coin mint={pier.sol.mint} size={26} symbol="SOL" />
          </span>
          <span className={s.strategyName}>
            <b className={s.display}>{pair}</b>
            <span className={s.styleChip}>
              <StyleGlyph style={strategy.style} />
              {styleName}
            </span>
          </span>
        </span>
        <RiskDots dots={STYLE_RISK[strategy.style]} words={words} />
      </div>
      <div className={s.strategyBody}>
        <span className={s.strategyBig}>
          <span className={s.kicker}>
            {w.vsHold} · {digits(w.days(strategy.days))}
          </span>
          <b className={`${s.display} ${tone}`}>{digits(pctText(strategy.resultPct))}</b>
        </span>
        {spark ? (
          <svg className={s.spark} viewBox="0 0 160 44" preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" x2="160" y1={spark.zero} y2={spark.zero} className={s.sparkZero} />
            <path d={spark.line} className={`${s.sparkLine} ${strategy.resultPct < 0 ? s.sparkDown : ''}`} />
            <circle cx={spark.end.x - 2} cy={spark.end.y} r="2.6" className={s.pastDot} />
          </svg>
        ) : null}
      </div>
      <dl className={s.facts}>
        <div>
          <dt>{w.fall}</dt>
          <dd className={strategy.drawdownPct > 0.005 ? s.loss : undefined}>{digits(fall)}</dd>
        </div>
        <div>
          <dt>{w.copies}</dt>
          <dd>{digits(String(strategy.copies))}</dd>
        </div>
        <div>
          <dt>{w.fees}</dt>
          <dd>{digits(pctText(strategy.feesPct))}</dd>
        </div>
      </dl>
      <button type="button" className={`${s.display} ${acts ? s.action : s.secondary} ${s.cardAction}`} onClick={open}>
        {acts ? w.copy : words.open}
      </button>
    </li>
  );
}
