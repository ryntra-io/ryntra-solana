'use client';

import { useEffect, useState } from 'react';
import { useCity } from '@/city/lib/city/store';
import { useLaunch } from '@/city/lib/launch/district';
import type { Pooled } from '@/city/lib/launch/flow';
import { POOL_AFTER, POOL_DEFAULT, POOL_FEE, POOL_LADDER, countdown, poolOpensAt, usePool, type PoolChoice, feeText } from '@/city/lib/launch/pool';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { clock } from './LaunchDoors';
import s from './launch.module.css';
import { POOL_WORDS } from './pool-words';

/**
 * «Straight to a pool»: the launch's third door — one quiet row in the review until the creator opens it.
 * It says the goal, not the protocol: the coin trades in its own pool from a time the creator picks. What holds it —
 * the fee that falls with the market cap, the lock, who earns what — is in the review's «i»; the bytes are the
 * engine's and the city reads them back before the wallet opens.
 */

/** Seconds on the creator's own clock, ticking: for a countdown and for the time a choice opens at. */
export function useSeconds(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function PoolDoor({ disabled }: { disabled: boolean }) {
  const choice = usePool((st) => st.choice);
  const setChoice = usePool((st) => st.setChoice);
  const w = useWords(POOL_WORDS);
  useLang();
  const now = useSeconds();
  const on = choice !== null;
  const labels = [w.in15, w.in1h, w.in6h];
  return (
    <div className={s.early} data-launch-pool={on ? 'on' : 'off'}>
      <button type="button" role="switch" aria-checked={on} className={`${s.shield} ${on ? s.shieldOn : ''}`} disabled={disabled} onClick={() => setChoice(on ? null : POOL_DEFAULT)}>
        <span className={s.shieldLabel}>{w.doorTitle}</span>
        <span className={s.shieldValue}>{on ? clock(poolOpensAt(choice, now)) : w.doorOff}</span>
        <span className={s.shieldTrack} aria-hidden="true">
          <span className={s.shieldKnob} />
        </span>
      </button>
      {on && (
        <div className={s.earlyCaps} role="radiogroup" aria-label={w.opens}>
          <span>{w.opens}</span>
          {POOL_AFTER.map((after, index) => {
            const picked = choice.at === null && choice.after === after;
            return (
              <button key={after} type="button" role="radio" aria-checked={picked} className={`${s.earlyCap} ${picked ? s.earlyCapOn : ''}`} disabled={disabled} onClick={() => setChoice({ ...choice, after, at: null })}>
                {labels[index]}
              </button>
            );
          })}
        </div>
      )}
      {on && (
        <div className={s.earlyCaps}>
          <span>{w.ladder}</span>
          <button type="button" role="switch" aria-checked={choice.ladder} data-launch-pool-ladder={choice.ladder ? 'on' : 'off'} className={`${s.earlyCap} ${choice.ladder ? s.earlyCapOn : ''}`} disabled={disabled} onClick={() => setChoice({ ...choice, ladder: !choice.ladder })}>
            {choice.ladder ? w.ladderOn(feeText(POOL_LADDER.shareBps), `×${POOL_LADDER.near}`, `×${POOL_LADDER.far}`) : w.doorOff}
          </button>
        </div>
      )}
    </div>
  );
}

/** The two facts of a launch into a pool, where the preset's two stand otherwise: when it trades, and what snipers pay. */
export function PoolFacts({ choice }: { choice: PoolChoice }) {
  const w = useWords(POOL_WORDS);
  useLang();
  const now = useSeconds();
  return (
    <div className={s.facts}>
      <div className={s.fact}>
        <span>{w.factOpens}</span>
        <b className={s.display}>{clock(poolOpensAt(choice, now))}</b>
      </div>
      <div className={s.fact}>
        <span>{w.factFee}</span>
        <b className={s.display}>{w.feeFall(feeText(POOL_FEE.startBps), feeText(POOL_FEE.endBps))}</b>
      </div>
    </div>
  );
}

/** What a launch into a pool costs, measured on the program (rehearsal of 15.11.2026): the pool's rent and two locked positions'. The engine's own figure replaces it at the first build. */
export const POOL_COST_ABOUT_LAMPORTS = 100_000_000;

/** The cost line of a launch into a pool: no launch fee, and the network's rent — the engine's figure once it built a step. */
export function PoolCost() {
  const cost = useLaunch((st) => st.costLamports);
  const w = useWords(POOL_WORDS);
  useLang();
  const lamports = cost !== null && /^\d+$/.test(cost) ? Number(cost) : POOL_COST_ABOUT_LAMPORTS;
  return (
    <div className={s.cost} data-launch-cost="pool">
      <b>{w.costFree}</b>
      <span>{w.costAbout((lamports / 1e9).toFixed(2))}</span>
    </div>
  );
}

/** The launch is in its pool: when trading opens — counted down — and one way on, its tower. */
export function PooledCard({ pooled, onClose }: { pooled: Pooled; onClose: () => void }) {
  const w = useWords(POOL_WORDS);
  useLang();
  const now = useSeconds();
  const left = pooled.opensAt - now;
  return (
    <div className={s.opened} role="status" data-launch-pooled="">
      <b className={`${s.display} ${s.openedTitle}`}>{w.setTitle(pooled.symbol)}</b>
      <span className={s.openedLine}>{left > 0 ? `${w.setLine(clock(pooled.opensAt))} · ${countdown(left)}` : w.setOpen}</span>
      <button
        className={`${s.display} ${s.action} ${s.actionBig}`}
        data-launch-pooled-tower=""
        onClick={() => {
          onClose();
          useCity.getState().select(pooled.mint);
        }}
      >
        {w.seeTower}
      </button>
    </div>
  );
}
