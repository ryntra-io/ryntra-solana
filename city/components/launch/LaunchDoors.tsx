'use client';

import { useMemo, useState } from 'react';
import type { EarlyAccessRules } from '@/lib/core/launch/early-access';
import { useLaunch } from '@/city/lib/launch/district';
import { earlyCaps, earlyTimes } from '@/city/lib/launch/early';
import type { Opened } from '@/city/lib/launch/flow';
import { pct, shortAddress, usd } from '@/city/lib/launch/format';
import { SHARE_MAX_OTHERS, keptPercent, nextRow, shareProblem, type ShareProblem, type ShareRow } from '@/city/lib/launch/share';
import { locale, useWords, type Same } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import s from './launch.module.css';
import { LAUNCH } from './words';

type W = Same<(typeof LAUNCH)['en']>;

/**
 * The launch's two doors (CITY-212). Each is one quiet row in the review until the creator opens it, and each says the
 * goal, not the protocol: «Share earnings» splits the creator's fees between wallets for ever; «Your people first» lets
 * the creator's people in before everyone. What holds them — the vault, the program, the window's arithmetic — is in
 * the review's «i»; the bytes are the engine's and the city reads them back before the wallet opens.
 */

const PLUS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const CROSS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M7 7l10 10M17 7L7 17" />
  </svg>
);

/** The colours of the split's segments after the creator's amber: mint, violet, ice, pearl — the city's own palette. */
const TONES = ['var(--mint)', 'var(--violet)', 'var(--ice)', 'var(--pearl)'] as const;

function problemWords(w: W, problem: ShareProblem): string {
  const words: Record<ShareProblem, string> = {
    address: w.shareAddressBad,
    repeated: w.shareRepeated,
    self: w.shareSelf,
    small: w.shareSmall,
    whole: w.shareWhole,
    tooMuch: w.shareTooMuch,
    tooMany: w.shareTooMany,
  };
  return words[problem];
}

/* ---------------------------------------------------------------- «Share earnings» */

export function ShareDoor({ disabled, creator }: { disabled: boolean; creator: string | null }) {
  const rows = useLaunch((st) => st.shares);
  const setRows = useLaunch((st) => st.setShares);
  const w = useWords(LAUNCH);
  useLang();
  const [editing, setEditing] = useState(false);
  const [tried, setTried] = useState(false);
  const problem = shareProblem(rows, creator);
  /* An empty address is not yet a mistake; a wrong one, or anything else, is said at once. */
  const shown = problem && (tried || problem !== 'address' || rows.some((row) => row.address.trim() !== '')) ? problem : null;

  if (!rows.length) {
    return (
      <button
        type="button"
        className={`${s.shield} ${s.door}`}
        disabled={disabled}
        data-launch-share=""
        onClick={() => {
          setRows([nextRow([])]);
          setEditing(true);
          setTried(false);
        }}
      >
        <span className={s.shieldLabel}>{w.shareTitle}</span>
        <span className={s.shieldValue}>{w.shareOnlyYou}</span>
        <span className={s.doorPlus}>{PLUS}</span>
      </button>
    );
  }

  const change = (i: number, next: Partial<ShareRow>) => setRows(rows.map((row, j) => (j === i ? { ...row, ...next } : row)));
  const remove = (i: number) => {
    const left = rows.filter((_, j) => j !== i);
    setRows(left);
    if (!left.length) setEditing(false);
  };
  const open = editing || problem !== null;

  return (
    <div className={s.split} data-launch-share="" data-launch-share-open={open ? '' : undefined}>
      <div className={s.splitHead}>
        <span className={s.shieldLabel}>{w.shareTitle}</span>
        {!open && !disabled && (
          <button type="button" className={s.link} onClick={() => setEditing(true)}>
            {w.shareEdit}
          </button>
        )}
      </div>
      <SplitBar rows={rows} w={w} />
      {open ? (
        <>
          <div className={s.splitRows}>
            {rows.map((row, i) => (
              <div key={i} className={s.splitRow}>
                <span className={s.splitTone} style={{ background: TONES[i % TONES.length] }} aria-hidden="true" />
                <input
                  className={s.splitAddress}
                  value={row.address}
                  placeholder={w.shareAddress}
                  aria-label={w.shareAddress}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={disabled}
                  onChange={(event) => change(i, { address: event.target.value.trim() })}
                />
                <label className={s.splitPercent}>
                  <input
                    value={Number.isFinite(row.percent) ? String(row.percent) : ''}
                    inputMode="numeric"
                    aria-label={w.sharePercent}
                    disabled={disabled}
                    onChange={(event) => {
                      const digitsOnly = event.target.value.replace(/[^0-9]/g, '').slice(0, 2);
                      change(i, { percent: digitsOnly === '' ? 0 : Number(digitsOnly) });
                    }}
                  />
                  <i aria-hidden="true">%</i>
                </label>
                <button type="button" className={s.splitRemove} aria-label={w.shareRemove} disabled={disabled} onClick={() => remove(i)}>
                  {CROSS}
                </button>
              </div>
            ))}
          </div>
          <div className={s.splitWays}>
            {rows.length < SHARE_MAX_OTHERS && keptPercent(rows) > 1 && (
              <button type="button" className={s.link} disabled={disabled} onClick={() => setRows([...rows, nextRow(rows)])}>
                {w.shareAdd}
              </button>
            )}
            <button
              type="button"
              className={`${s.link} ${s.splitDone}`}
              disabled={disabled}
              onClick={() => {
                setTried(true);
                if (!problem) setEditing(false);
              }}
            >
              {w.shareDone}
            </button>
          </div>
          {shown && (
            <div className={s.problem} role="status" data-launch-share-problem={shown}>
              {problemWords(w, shown)}
            </div>
          )}
        </>
      ) : (
        <ul className={s.splitChips} data-launch-shares="">
          <li>
            <span className={s.splitTone} style={{ background: 'var(--amber)' }} aria-hidden="true" />
            {w.shareYou} <b>{pct(keptPercent(rows) * 100)}</b>
          </li>
          {rows.map((row, i) => (
            <li key={row.address || i}>
              <span className={s.splitTone} style={{ background: TONES[i % TONES.length] }} aria-hidden="true" />
              {shortAddress(row.address)} <b>{pct(row.percent * 100)}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Who gets what, as one bar: the creator's amber first, each wallet's tone after it, and what the creator keeps. */
function SplitBar({ rows, w }: { rows: readonly ShareRow[]; w: W }) {
  const kept = Math.max(0, keptPercent(rows));
  return (
    <div className={s.splitBarWrap}>
      <div className={s.splitBar} aria-hidden="true">
        <span style={{ flexGrow: kept, background: 'var(--amber)' }} />
        {rows.map((row, i) => (
          <span key={i} style={{ flexGrow: Math.max(0, row.percent), background: TONES[i % TONES.length] }} />
        ))}
      </div>
      <span className={s.splitKeep}>{w.shareKeep(pct(kept * 100))}</span>
    </div>
  );
}

/* ---------------------------------------------------------------- «Your people first» */

export function EarlyDoor({ disabled }: { disabled: boolean }) {
  const early = useLaunch((st) => st.early);
  const setEarly = useLaunch((st) => st.setEarly);
  const bounds = useLaunch((st) => st.earlyBounds);
  const w = useWords(LAUNCH);
  useLang();
  /* The amounts are read once for the sheet: the bounds do not move while it is open. */
  const caps = useMemo(() => (bounds ? earlyCaps(bounds, Math.floor(Date.now() / 1000)) : []), [bounds]);
  if (!bounds || !caps.length) return null;
  const on = early !== null;
  return (
    <div className={s.early} data-launch-early={on ? 'on' : 'off'}>
      <button type="button" role="switch" aria-checked={on} className={`${s.shield} ${on ? s.shieldOn : ''}`} disabled={disabled} onClick={() => setEarly(on ? null : { capUsd: caps[Math.min(1, caps.length - 1)]! })}>
        <span className={s.shieldLabel}>{w.earlyTitle}</span>
        <span className={s.shieldValue}>{on ? usd(early.capUsd) : w.earlyOff}</span>
        <span className={s.shieldTrack} aria-hidden="true">
          <span className={s.shieldKnob} />
        </span>
      </button>
      {on && (
        <div className={s.earlyCaps} role="radiogroup" aria-label={w.earlyBring}>
          <span>{w.earlyBring}</span>
          {caps.map((capUsd) => (
            <button key={capUsd} type="button" role="radio" aria-checked={early.capUsd === capUsd} className={`${s.earlyCap} ${early.capUsd === capUsd ? s.earlyCapOn : ''}`} disabled={disabled} onClick={() => setEarly({ capUsd })}>
              {usd(capUsd)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A unix second as the clock on the creator's screen: 14:05. */
export function clock(seconds: number): string {
  return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(seconds * 1000));
}

/** The two moments of an early launch, where the preset's two facts stand otherwise. */
export function EarlyFacts({ rules }: { rules: EarlyAccessRules }) {
  const w = useWords(LAUNCH);
  useLang();
  const times = earlyTimes(rules);
  return (
    <div className={s.facts}>
      <div className={s.fact}>
        <span>{w.earlyOpensFact}</span>
        <b className={s.display}>{clock(times.opensAt)}</b>
      </div>
      <div className={s.fact}>
        <span>{w.earlyPublicFact}</span>
        <b className={s.display}>{clock(times.publicAt)}</b>
      </div>
    </div>
  );
}

/** The early launch is set: when the creator's people get in, when everyone does, and one way on. */
export function OpenedCard({ opened, onClose }: { opened: Opened; onClose: () => void }) {
  const w = useWords(LAUNCH);
  useLang();
  return (
    <div className={s.opened} role="status" data-launch-opened="">
      <b className={`${s.display} ${s.openedTitle}`}>{w.openedTitle(opened.symbol)}</b>
      <span className={s.openedLine}>{w.openedLine(clock(opened.opensAt), clock(opened.publicAt))}</span>
      {opened.state === 'PENDING' && <span className={s.openedLine}>{w.openedPending}</span>}
      <button className={`${s.display} ${s.action} ${s.actionBig}`} onClick={onClose}>
        {w.close}
      </button>
    </div>
  );
}
