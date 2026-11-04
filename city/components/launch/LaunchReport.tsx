'use client';

import { useState } from 'react';
import { REPORT_REASONS, sendReport, type ReportReason } from '@/city/lib/launch/report';
import type { LaunchTower } from '@/city/lib/launch/towers';
import { useWords, type TextKey } from '@/city/lib/i18n/dict';
import s from './launch.module.css';
import { LAUNCH } from './words';

const REASON_WORD: Readonly<Record<ReportReason, TextKey<typeof LAUNCH>>> = {
  scam: 'reasonScam',
  pretends: 'reasonPretends',
  picture: 'reasonPicture',
  other: 'reasonOther',
};

/** The flag in a launch tower's head that opens «Report» (CITY-139). */
export function ReportFlag({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const w = useWords(LAUNCH);
  return (
    <button className={`${s.close} ${s.flag}`} aria-label={w.report} aria-pressed={on} onClick={onToggle}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
      </svg>
    </button>
  );
}

/**
 * «Report»: one reason, one press, into the inbox the team reads first (MC-1). The takedown procedure decides; a report
 * hides nothing by itself.
 */
export function ReportPanel({ launch }: { launch: LaunchTower }) {
  const w = useWords(LAUNCH);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [state, setState] = useState<'open' | 'sending' | 'sent' | 'rate' | 'failed'>('open');
  if (state === 'sent') {
    return (
      <div className={s.dockDone} role="status">
        {w.reportSent}
      </div>
    );
  }
  const send = async () => {
    if (!reason) return;
    setState('sending');
    const answer = await sendReport({ token: launch.token, symbol: launch.symbol, reason, route: window.location.pathname });
    setState(answer.ok ? 'sent' : answer.reason);
  };
  return (
    <div className={s.report}>
      <div className={s.reasons} role="radiogroup" aria-label={w.reportOf(launch.symbol)}>
        {REPORT_REASONS.map((item) => (
          <button key={item} type="button" role="radio" aria-checked={reason === item} className={`${s.reason} ${reason === item ? s.reasonOn : ''}`} onClick={() => setReason(item)}>
            {w[REASON_WORD[item]]}
          </button>
        ))}
      </div>
      {(state === 'rate' || state === 'failed') && (
        <div className={s.problem} role="alert">
          {state === 'rate' ? w.reportRate : w.reportFailed}
        </div>
      )}
      <button className={`${s.display} ${s.action}`} onClick={send} disabled={!reason || state === 'sending'}>
        {state === 'sending' ? w.reportSending : w.reportSend}
      </button>
    </div>
  );
}
