'use client';

import { useEffect, useMemo, useState } from 'react';
import { downloadReceipt } from '@/lib/solana/send-receipt-vault.client';
import { useRyntraApp } from '@/city/lib/app-mode';
import { useBackPanel } from '@/city/lib/back/panels';
import { activityLines, type ActivityLine } from '@/city/lib/money/activity';
import { useLang } from '@/city/lib/i18n/lang';
import { dateText, useWords } from '@/city/lib/i18n/dict';
import { readAge } from '@/city/lib/money/assets';
import { keptReceipts, useMoneyStore, type ShownReceipt } from '@/city/lib/money/store';
import { Note, Refresh } from './bits';
import { MONEY } from './words';
import s from './money.module.css';

/**
 * Activity: what this wallet did through Ryntra — sent, swapped, moved between networks, bought at a launch — from the
 * engine's ledger, each with where it stands, its transaction on the chain and its receipt. Read when the tab opens.
 */
export function Activity({ owner }: { owner: string }) {
  const activity = useMoneyStore((st) => st.activity);
  const w = useWords(MONEY);
  const lang = useLang();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void useMoneyStore.getState().readActivity();
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [owner]);

  const lines = useMemo(
    () => (activity.read ? activityLines(activity.read.actions, keptReceipts(owner), now) : []),
    // The rows are worded in the language on screen: a new one words them again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activity.read, owner, now, lang],
  );
  const byId = useMemo(() => new Map((activity.read?.actions ?? []).map((action) => [action.actionId, action])), [activity.read]);
  const shownLine = activity.shown ? lines.find((line) => line.id === activity.shown?.actionId) : undefined;
  useBackPanel('receipt', Boolean(activity.shown), () => useMoneyStore.getState().closeReceipt());

  if (!activity.read) {
    return activity.status === 'failed' ? (
      <p className={s.empty}>
        {w.activityUnavailable}{' '}
        <button type="button" className={s.link} onClick={() => void useMoneyStore.getState().readActivity()}>
          {w.tryAgain}
        </button>
      </p>
    ) : (
      <div className={s.bones} aria-label={w.readingActivity}>
        <span />
        <span />
        <span />
      </div>
    );
  }

  if (activity.shown && shownLine) {
    return <Receipt shown={activity.shown} line={shownLine} startedAt={byId.get(shownLine.id)?.startedAt ?? null} />;
  }

  return (
    <section className={s.tabBody} aria-label={w.activity}>
      <div className={s.bar}>
        {activity.read.complete ? <span /> : <p className={s.note}>{w.someRecords}</p>}
        <Refresh onClick={() => void useMoneyStore.getState().readActivity()} title={w.readAt(readAge(activity.read.at, now))} />
      </div>
      {lines.length === 0 ? (
        <p className={s.empty}>{w.nothingYet}</p>
      ) : (
        <ul className={s.rows}>
          {lines.map((line) => {
            const action = byId.get(line.id);
            return (
              <li key={line.id} className={s.activityRow}>
                <span className={s.names}>
                  <b>{line.title}</b>
                  <span>
                    {line.sub} · {line.when}
                  </span>
                </span>
                <span className={`${s.state} ${s[`tone_${line.tone}`] ?? ''}`}>{line.state}</span>
                <span className={s.rowLinks}>
                  {line.link ? (
                    <a className={s.link} href={line.link.href} target="_blank" rel="noreferrer">
                      {line.link.label}
                    </a>
                  ) : null}
                  {line.receipt && action ? (
                    <button type="button" className={s.link} onClick={() => void useMoneyStore.getState().openReceipt(action)} disabled={activity.opening !== null}>
                      {activity.opening === line.id ? w.issuing : w.receipt}
                    </button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Note line={activity.line} />
    </section>
  );
}

/**
 * A receipt, read in the window (CITY-150, the operator's pass on the Seeker: «Receipt» opened nothing — the app's WebView
 * saves no file). What happened, where it stands, when, and its transaction on the chain; a browser can also save the
 * engine's signed copy.
 */
function Receipt({ shown, line, startedAt }: { shown: ShownReceipt; line: ActivityLine; startedAt: string | null }) {
  const w = useWords(MONEY);
  const app = useRyntraApp();
  const at = startedAt ? Date.parse(startedAt) : NaN;
  const close = () => useMoneyStore.getState().closeReceipt();
  return (
    <section className={`${s.tabBody} ${s.receipt}`} aria-label={w.receipt}>
      <button type="button" className={s.receiptBack} onClick={close} aria-label={w.backToActivity}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {w.receipt}
      </button>
      <div className={s.receiptCard}>
        <span className={`${s.state} ${s[`tone_${line.tone}`] ?? ''}`}>{line.state}</span>
        <b className={s.receiptTitle}>{line.title}</b>
        {line.sub ? <span className={s.receiptSub}>{line.sub}</span> : null}
        {Number.isFinite(at) ? (
          <span className={s.receiptWhen}>{dateText(at, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        ) : null}
      </div>
      <div className={s.receiptActs}>
        {line.link ? (
          <a className={s.receiptAct} href={line.link.href} target="_blank" rel="noreferrer">
            {w.transaction} · {line.link.label}
          </a>
        ) : null}
        {app ? null : (
          <button type="button" className={s.receiptAct} onClick={() => downloadReceipt(shown.receipt)}>
            {w.downloadReceipt}
          </button>
        )}
      </div>
    </section>
  );
}
