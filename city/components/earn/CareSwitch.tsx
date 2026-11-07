'use client';

import { useEffect } from 'react';
import { CARE_MODE, CARE_STOPS, careWords, useCare } from '@/city/lib/earn/care';
import { digits } from '@/city/lib/i18n/dict';
import { useWallet } from '@/city/lib/trade/wallet';
import { Wallets } from './bits';
import type { Words } from '@/city/lib/earn/words';
import s from './earn.module.css';
import c from './care.module.css';

/** Whether the care is offered here: the switch opens it on devnet first, on mainnet by its release. */
export const careOpen = () => CARE_MODE !== 'closed';

/**
 * «Your agent looks after it» on the pier card (CITY-203): one switch, the stop as three chips, one line of safety. The
 * how stays behind «Details». On, the card's one action becomes «Give it to my agent».
 */
export function CareSwitch({ busy }: { busy: boolean }) {
  const w = careWords();
  const on = useCare((st) => st.on);
  const stop = useCare((st) => st.stop);
  if (!careOpen()) return null;
  return (
    <div className={`${c.care} ${on ? c.careOn : ''}`}>
      <button type="button" role="switch" aria-checked={on} className={c.row} onClick={() => useCare.getState().setOn(!on)} disabled={busy}>
        <span className={c.glyph} aria-hidden="true">
          <AgentGlyph />
        </span>
        <span className={c.names}>
          <b>{w.title}</b>
          <span>{w.line}</span>
        </span>
        <span className={c.toggle} aria-hidden="true">
          <span />
        </span>
      </button>
      {on ? (
        <>
          <div className={c.stops} role="radiogroup" aria-label={w.stop}>
            <span className={c.stopLabel}>{w.stop}</span>
            {CARE_STOPS.map((pct) => (
              <button key={pct} type="button" role="radio" aria-checked={stop === pct} className={`${c.chip} ${stop === pct ? c.chipOn : ''}`} onClick={() => useCare.getState().setStop(pct)} disabled={busy}>
                {digits(w.stops[pct])}
              </button>
            ))}
          </div>
          <details className={c.details}>
            <summary>{w.details}</summary>
            {w.detailsBody.map((line) => (
              <p key={line} className={s.fine}>
                {line}
              </p>
            ))}
          </details>
        </>
      ) : null}
    </div>
  );
}

/** The card's one action with the care on: one approval in the wallet, then the agent opens and looks after it. */
export function CareAction({ words, pool, lamports, width, shape, blocked }: { words: Words; pool: string; lamports: bigint | null; width: number; shape: string; blocked: boolean }) {
  const w = careWords();
  const phase = useCare((st) => st.phase);
  const notice = useCare((st) => st.notice);
  const connection = useWallet((st) => st.connection);
  if (!connection) return <Wallets words={words} />;
  if (phase === 'done') {
    return (
      <div className={c.done} role="status">
        <span className={c.glyph} aria-hidden="true">
          <AgentGlyph />
        </span>
        <span className={c.names}>
          <b>{w.done}</b>
          <span>{w.doneLine}</span>
        </span>
      </div>
    );
  }
  const waiting = phase === 'building' || phase === 'wallet' || phase === 'sending';
  const label = phase === 'building' ? w.building : phase === 'wallet' ? w.wallet : phase === 'sending' ? w.sending : w.give;
  return (
    <>
      {notice ? <p className={`${s.note} ${s.noteWarn}`}>{notice === 'cancelled' ? w.cancelled : w.failed}</p> : null}
      <button
        type="button"
        className={`${s.display} ${s.action} ${s.cta} ${waiting ? s.waiting : ''}`}
        disabled={waiting || blocked || !lamports}
        onClick={() => lamports && void useCare.getState().give(connection, { pool, lamports, width, shape })}
      >
        {label}
      </button>
    </>
  );
}

/** «Mine»: the piers the agent looks after, each with its state today and the person's own «Stop and take it back». */
export function CaredPiers({ owner }: { owner: string | null }) {
  const w = careWords();
  const cares = useCare((st) => st.cares);
  const connection = useWallet((st) => st.connection);
  const notice = useCare((st) => st.notice);
  useEffect(() => {
    if (owner && careOpen()) void useCare.getState().load(owner);
  }, [owner]);
  if (!careOpen() || !owner || !cares?.length) return null;
  const live = cares.filter((row) => row.status === 'working');
  if (!live.length) return null;
  return (
    <>
      <h4 className={s.label}>{w.mine}</h4>
      <ul className={s.rows}>
        {live.map((row) => (
          <li key={row.key} className={s.row}>
            <span className={`${s.status} ${row.inRange !== false ? s.statusOn : ''}`} aria-hidden="true" />
            <span className={s.names}>
              <b>{w.working}</b>
              <span>{row.inRange === false ? w.outOfRange : w.inRange}</span>
            </span>
            <span className={s.figures}>
              <b className={`${s.figure} ${row.day.claimedInY + row.day.reinvestedInY > 0 ? s.gain : ''} ${s.rowFigure}`}>
                +{digits((row.day.claimedInY + row.day.reinvestedInY).toLocaleString('en-US', { maximumFractionDigits: 6 }))}
                <small> SOL</small>
              </b>
              {connection ? (
                <button type="button" className={c.take} onClick={() => void useCare.getState().takeBack(connection, row.key)}>
                  {w.stopAction}
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {notice ? <p className={`${s.note} ${s.noteWarn}`}>{notice === 'cancelled' ? w.cancelled : w.failed}</p> : null}
    </>
  );
}

/** The agent: a small orange spark in a ring — the city's own mark for «someone works for you». */
function AgentGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.4" />
      <path d="M12 5.5l1.6 4.2 4.4.4-3.4 2.8 1.1 4.3L12 14.8 8.3 17.2l1.1-4.3L6 10.1l4.4-.4z" fill="currentColor" />
    </svg>
  );
}
