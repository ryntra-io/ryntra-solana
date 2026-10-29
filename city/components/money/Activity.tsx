'use client';

import { useEffect, useMemo, useState } from 'react';
import { activityLines } from '@/city/lib/money/activity';
import { readAge } from '@/city/lib/money/assets';
import { keptReceipts, useMoneyStore } from '@/city/lib/money/store';
import { Note, Refresh } from './bits';
import s from './money.module.css';

/**
 * Activity: what this wallet did through Ryntra — sent, swapped, moved between networks, bought at a launch — from the
 * engine's ledger, each with where it stands, its transaction on the chain and its receipt. Read when the tab opens.
 */
export function Activity({ owner }: { owner: string }) {
  const activity = useMoneyStore((st) => st.activity);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void useMoneyStore.getState().readActivity();
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [owner]);

  const lines = useMemo(() => (activity.read ? activityLines(activity.read.actions, keptReceipts(owner), now) : []), [activity.read, owner, now]);
  const byId = useMemo(() => new Map((activity.read?.actions ?? []).map((action) => [action.actionId, action])), [activity.read]);

  if (!activity.read) {
    return activity.status === 'failed' ? (
      <p className={s.empty}>
        Your activity is unavailable right now.{' '}
        <button type="button" className={s.link} onClick={() => void useMoneyStore.getState().readActivity()}>
          Try again
        </button>
      </p>
    ) : (
      <div className={s.bones} aria-label="Reading your activity">
        <span />
        <span />
        <span />
      </div>
    );
  }

  return (
    <section className={s.tabBody} aria-label="Activity">
      <div className={s.bar}>
        {activity.read.complete ? <span /> : <p className={s.note}>Some records could not be read.</p>}
        <Refresh onClick={() => void useMoneyStore.getState().readActivity()} title={`Read ${readAge(activity.read.at, now)}`} />
      </div>
      {lines.length === 0 ? (
        <p className={s.empty}>Nothing yet.</p>
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
                      {activity.opening === line.id ? 'Issuing…' : 'Receipt'}
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
