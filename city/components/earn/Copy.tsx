'use client';

import { useEffect, useRef } from 'react';
import { pctText, sparkOf, type ProvenStrategy } from '@/city/lib/earn/captain';
import { solShort, type Pier } from '@/city/lib/earn/pier';
import type { Words } from '@/city/lib/earn/words';
import { useZap, ZAP_BUSY, zapKey, type ZapLeg } from '@/city/lib/earn/zap-store';
import { digits } from '@/city/lib/i18n/dict';
import { figuresOf } from '@/city/lib/trade/figures';
import { useWallet } from '@/city/lib/trade/wallet';
import s from './earn.module.css';

/** With a wallet the Harbor admits, the exact order of the Zap's first half follows the card after this pause. */
const AUTO_ORDER_MS = 450;

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

export type ZapView = Readonly<{
  /** The exact order of the first half for this leg, when built: its fee, what arrives at least. */
  fee: string | null;
  minimum: string | null;
  /** The first half landed and the wallet is being read again. */
  settling: boolean;
}>;

/** What the copy's card says of the Zap's first half: its fee and least arrival from the engine's exact order. */
export function useZapView(leg: ZapLeg | null): ZapView {
  const owner = useWallet((st) => st.connection?.address ?? null);
  const review = useZap((st) => st.review);
  const settling = useZap((st) => st.settling);
  if (!leg || !owner) return { fee: null, minimum: null, settling };
  const mine = review && review.key === zapKey(owner, leg) ? figuresOf(review.order.order, leg.decimals, 'order') : null;
  return { fee: mine?.fee ?? null, minimum: mine ? `${mine.minimum} ${leg.symbol}` : null, settling };
}

/**
 * The copy's action while the wallet lacks the pier's other coin: the Zap's first half — the trade engine's own swap
 * of SOL for what is missing — built while the card is read and signed with one tap; the add follows on the same card.
 */
export function ZapAction({ words, pier, leg, admitted }: { words: Words; pier: Pier; leg: ZapLeg; admitted: boolean }) {
  const w = words.captain;
  const p = words.pier;
  const connection = useWallet((st) => st.connection);
  const phase = useZap((st) => st.phase);
  const key = useZap((st) => st.key);
  const review = useZap((st) => st.review);
  const notice = useZap((st) => st.notice);
  const settling = useZap((st) => st.settling);
  const done = useZap((st) => st.done);
  const owner = connection?.address ?? null;
  const legKey = owner ? zapKey(owner, leg) : null;
  // After a landed purchase of this coin nothing is bought again by itself: the person decides.
  const boughtHere = Boolean(done && owner && done.key.startsWith(`${owner}:${leg.mint}:`));
  // The leg is a fresh object each render; the order follows its key, and is asked for with the latest one.
  const latest = useRef(leg);
  latest.current = leg;

  useEffect(() => {
    if (!connection || !admitted || !legKey || phase !== 'idle' || boughtHere || settling) return;
    if (key === legKey && (review || notice)) return;
    const timer = setTimeout(() => void useZap.getState().prepare(connection, latest.current), AUTO_ORDER_MS);
    return () => clearTimeout(timer);
  }, [connection, admitted, legKey, phase, key, review, notice, boughtHere, settling]);

  if (!connection) return null;
  const waiting = phase === 'preparing' || ZAP_BUSY.has(phase) || settling;
  const label = settling ? p.sending : phase === 'preparing' ? p.building : phase === 'wallet' ? p.wallet : phase === 'sending' || phase === 'checking' ? p.sending : w.zap(pier.other.symbol);
  return (
    <>
      {notice ? (
        <p className={`${s.note} ${notice.tone === 'error' ? s.noteError : s.noteWarn}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
          {notice.text}
        </p>
      ) : null}
      {settling || boughtHere ? <p className={`${s.note} ${s.noteGood}`}>{w.zapDone(pier.other.symbol)}</p> : null}
      <button type="button" className={`${s.display} ${s.action} ${s.cta} ${waiting ? s.waiting : ''}`} onClick={() => void useZap.getState().press(connection, leg)} disabled={waiting || !admitted}>
        {label}
      </button>
      <p className={s.zapLine}>{digits(w.zapLine(solShort(leg.lamports), pier.other.symbol))}</p>
    </>
  );
}
