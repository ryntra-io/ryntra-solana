'use client';

import { useMemo } from 'react';
import type { PositionView } from '@/lib/liquidity/catalog/positions';
import { reviewFigures } from '@/city/lib/districts/harbor/review';
import type { PierRow } from '@/city/lib/earn/mine';
import { solPiers, solShort, solUsd } from '@/city/lib/earn/pier';
import { PIER_BUSY, poolReviewOf, targetKey, usePier } from '@/city/lib/earn/pier-store';
import { SOL_MINT } from '@/city/lib/earn/lst';
import { useEarnData } from '@/city/lib/earn/store';
import type { Words } from '@/city/lib/earn/words';
import { digits } from '@/city/lib/i18n/dict';
import { useWallet } from '@/city/lib/trade/wallet';
import { BackGlyph, Line, SolFigure } from './bits';
import { Outcome, PierAction, PierNote } from './PierCard';
import s from './earn.module.css';

/**
 * A position moored at the pier: a boat lit by its own lamps while the price is inside its range, and dark on the water
 * when it is out. Nothing here is a figure.
 */
export function Boat({ lit, size = 56 }: { lit: boolean; size?: number }) {
  return (
    <svg className={`${s.boat} ${lit ? s.boatOn : ''}`} width={size} height={size * 0.62} viewBox="0 0 90 56" aria-hidden="true">
      <defs>
        <linearGradient id="earn-boat-hull" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.95" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id="earn-boat-water" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="0.5" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M44 6v26" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
      <path d="M44 9l17 19H44z" fill="currentColor" opacity="0.28" />
      <circle className={s.boatLamp} cx="44" cy="5" r="2.6" />
      <path d="M30 26h22l4 6H26z" fill="currentColor" opacity="0.55" />
      <rect className={s.boatWindow} x="33" y="27.6" width="4" height="2.6" rx="0.6" />
      <rect className={s.boatWindow} x="40" y="27.6" width="4" height="2.6" rx="0.6" />
      <rect className={s.boatWindow} x="47" y="27.6" width="4" height="2.6" rx="0.6" />
      <path d="M8 32h76l-9 13H17z" fill="url(#earn-boat-hull)" />
      <path d="M8 32h76" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4 50c6-3 12-3 18 0s12 3 18 0 12-3 18 0 12 3 18 0 8-2 10-1" stroke="url(#earn-boat-water)" strokeWidth="1.6" fill="none" />
    </svg>
  );
}

/** A boat's own card: what it holds and earned in SOL, against holding, and the two things to do with it. */
export function BoatCard({ words, view, row }: { words: Words; view: PositionView; row: PierRow | null }) {
  const w = words.pier;
  const phase = usePier((st) => st.phase);
  const target = usePier((st) => st.target);
  const reviewed = usePier((st) => st.reviewed);
  const notice = usePier((st) => st.notice);
  const outcome = usePier((st) => st.outcome);
  const states = usePier((st) => st.states);
  const list = useEarnData((st) => st.piers);
  const connection = useWallet((st) => st.connection);
  const holdings = useWallet((st) => st.holdings);
  const busy = PIER_BUSY.has(phase);
  const lit = view.rangeState === 'in_range';
  const may = Boolean(connection && states?.owner === connection.address && states.value.exit === 'on');

  // SOL's dollar price for the boat's worth: the piers' own, or the boat's SOL side.
  const price = useMemo(() => {
    const pier = list.status === 'ready' ? solPiers(list.value.pools)[0] : undefined;
    const fromPier = pier ? solUsd(pier) : null;
    if (fromPier !== null) return fromPier;
    const side = view.x.mint === SOL_MINT ? view.x : view.y.mint === SOL_MINT ? view.y : null;
    return side?.priceUsd ?? null;
  }, [list, view]);
  const worth = view.valueUsd !== null && price ? BigInt(Math.round((view.valueUsd / price) * 1e9)) : null;

  const acting = target && target.kind !== 'add' && target.position.address === view.address ? target : null;
  const shown = acting && connection && reviewed?.key === targetKey(connection.address, acting) ? reviewed : null;
  const poolReview = poolReviewOf(shown);
  const figures = poolReview && acting ? reviewFigures(poolReview, { x: view.x.symbol, y: view.y.symbol }, null) : null;
  const choose = (kind: 'claim' | 'exit') => {
    if (!connection || busy) return;
    void usePier.getState().prepare(connection, { kind, position: view }, holdings);
  };

  if (outcome) return <Outcome words={words} />;

  return (
    <section className={s.saver} aria-label={view.name}>
      <button type="button" className={s.back} onClick={() => usePier.getState().back()} disabled={phase === 'wallet' || phase === 'sending'}>
        <BackGlyph />
        {words.back}
      </button>
      <div className={`${s.boatHero} ${lit ? s.boatLit : ''}`}>
        <Boat lit={lit} size={120} />
        <div className={s.boatName}>
          <h3 className={`${s.display} ${s.productName}`}>{view.name}</h3>
          <span className={lit ? s.gain : s.dim}>{lit ? w.inRange : w.outOfRange}</span>
        </div>
      </div>
      <div className={s.headline}>
        <span className={s.headFigure}>
          <span className={s.kicker}>{words.earned} · SOL</span>
          <SolFigure lamports={row?.feesLamports ?? null} unit={false} />
        </span>
        <span className={s.headFigure}>
          <span className={s.kicker}>{words.vsHold} · SOL</span>
          <SolFigure lamports={row?.vsHoldLamports ?? null} unit={false} />
        </span>
      </div>
      <Line label={words.details} line={<>{w.holds} {worth !== null ? `${digits(solShort(worth))} SOL` : '—'}</>}>
        <p className={s.fine}>{words.mine.vsHoldFine}</p>
        {view.feesElsewhere ? <p className={s.fine}>{w.feesElsewhere}</p> : null}
      </Line>

      {may ? (
        <div className={s.pair2} role="radiogroup" aria-label={view.name}>
          {(['claim', 'exit'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={acting?.kind === kind}
              className={`${s.display} ${s.secondary} ${acting?.kind === kind ? s.chosen : ''}`}
              onClick={() => choose(kind)}
              disabled={busy || (kind === 'claim' && (view.feesElsewhere || !(view.x.unclaimed > 0 || view.y.unclaimed > 0)))}
            >
              {kind === 'claim' ? w.take : w.leave}
            </button>
          ))}
        </div>
      ) : null}

      {figures && acting ? (
        <div className={s.get}>
          <span className={s.kicker}>{acting.kind === 'claim' ? w.youTake : w.youGetBack}</span>
          <b>{figures.amounts.length ? figures.amounts.join(' + ') : w.nothingToTake}</b>
          <span>
            {w.network} {figures.networkSol} SOL{figures.rentReturnedSol ? ` · ${w.rent} +${figures.rentReturnedSol} SOL` : ''} · {acting.kind === 'exit' ? w.closes : w.stays}
          </span>
        </div>
      ) : acting && phase === 'reviewing' ? (
        <div className={s.bones} aria-busy="true">
          <span />
        </div>
      ) : null}
      <PierNote notice={notice ?? (figures?.note ? { tone: 'warn', text: figures.note } : null)} />
      <div className={s.grow} />
      {acting ? <PierAction words={words} verb={acting.kind === 'claim' ? w.take : w.leave} ready={Boolean(shown)} blocked={null} onPrepare={() => choose(acting.kind)} /> : null}
    </section>
  );
}
