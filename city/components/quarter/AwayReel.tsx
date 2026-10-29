'use client';

import { useEffect, useRef } from 'react';
import { ago, awayFor } from '@/city/lib/quarter/away';
import { awayStore, useAway, type AwayChannel } from '@/city/lib/quarter/away-store';
import { useQuarter } from '@/city/lib/quarter/store';
import { useCity } from '@/city/lib/city/store';
import { useRun } from '@/city/lib/run/store';
import { ownedMints, useWallet } from '@/city/lib/trade/wallet';
import s from '../hud/hud.module.css';
import a from './away.module.css';

/** How long the reel waits for the city's live read before it plays without the market's lines. */
const MARKET_WAIT_MS = 4_000;
/** While the person is here, «since» moves with them. */
const SEEN_EVERY_MS = 60_000;

/**
 * Starts «While you were away» when a signed-in wallet's quarter comes on screen in the city, and keeps the next
 * «since» moving while the person stays. A visitor without a wallet has no quarter and no reel.
 */
export function useAwayWatch() {
  const owner = useQuarter((st) => (typeof st.owner === 'string' ? st.owner : null));
  const me = useQuarter((st) => (st.status === 'resident' ? st.me : null));
  const mode = useQuarter((st) => st.mode);
  const running = useRun((st) => st.phase !== 'off');
  const live = useCity((st) => st.snapshot.source === 'live');
  const picked = useCity((st) => st.selectedId !== null);

  // Another account, or none: the next one is checked afresh.
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (owner !== last.current) {
      last.current = owner;
      awayStore.getState().reset();
    }
  }, [owner]);

  useEffect(() => {
    if (!owner || !me || mode !== 'city' || running || picked || awayStore.getState().status !== 'idle') return;
    const go = () => {
      const city = useCity.getState().snapshot;
      const wallet = useWallet.getState();
      const holdings = wallet.connection && wallet.holdings?.owner === wallet.connection.address ? wallet.holdings : null;
      void awayStore.getState().check({ owner, me, market: city, held: ownedMints(holdings) });
    };
    if (live) {
      go();
      return;
    }
    const timer = setTimeout(go, MARKET_WAIT_MS);
    return () => clearTimeout(timer);
  }, [owner, me, mode, running, picked, live]);

  useEffect(() => {
    const here = () => awayStore.getState().seen();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') here();
    }, SEEN_EVERY_MS);
    const hidden = () => {
      if (document.visibilityState === 'hidden') here();
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', here);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', here);
    };
  }, []);
}

/**
 * The reel over the city: twenty seconds, one line at a time, while the camera flies over each change
 * (`AwayCamera`). Every line says its source and when; a tap goes to the next, «Skip» or Escape ends it, and the city's
 * screen comes back. Below the line, the person may let the report reach them in Telegram or by push: off until they
 * turn it on, and nothing is sent from here.
 */
export function AwayReel() {
  const lines = useAway((st) => st.lines);
  const index = useAway((st) => st.index);
  const paused = useAway((st) => st.paused);
  const since = useAway((st) => st.since);
  const until = useAway((st) => st.until);
  const line = lines[index] ?? null;

  useEffect(() => {
    if (!line || paused) return;
    const timer = setTimeout(() => awayStore.getState().next(), line.ms);
    return () => clearTimeout(timer);
  }, [line, paused]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') awayStore.getState().finish();
      else if (e.key === 'ArrowRight') awayStore.getState().next();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  if (!line) return null;
  const now = Date.now();
  return (
    <div className={a.layer} aria-live="polite">
      <div className={a.top}>
        <div className={a.bars} aria-hidden="true">
          {lines.map((l, i) => (
            <span key={l.id} className={a.bar}>
              <span
                key={i === index ? `${l.id}:${paused}` : l.id}
                className={`${a.fill} ${i < index ? a.fillDone : i === index ? a.fillNow : ''} ${paused ? a.fillHeld : ''}`}
                style={{ animationDuration: `${l.ms}ms` }}
              />
            </span>
          ))}
        </div>
        <div className={a.head}>
          <div className={`${s.kicker} ${a.kicker}`}>
            <span className={a.spark} aria-hidden="true" />
            While you were away
            {since && until && <span className={a.for}>· {awayFor(since, until)}</span>}
          </div>
          <button className={`${s.display} ${a.skip}`} onClick={() => awayStore.getState().finish()}>
            Skip
          </button>
        </div>
      </div>

      <div className={`${s.panel} ${a.card}`}>
        <button className={a.tap} onClick={() => awayStore.getState().next()} aria-label={index + 1 < lines.length ? 'Next' : 'Done'}>
          <span key={line.id} className={a.lineIn}>
            <span className={`${a.tone} ${line.tone === 'mine' ? a.toneMine : a.toneAround}`}>{line.tone === 'mine' ? 'Yours' : 'Around you'}</span>
            <span className={a.text}>{line.text}</span>
            {line.sub && <span className={a.sub}>{line.sub}</span>}
            <span className={a.meta}>
              <span className={a.source}>{line.source}</span>
              <time dateTime={line.at} title={line.at}>
                {ago(line.at, now)}
              </time>
              <span className={a.count}>
                {index + 1}/{lines.length}
              </span>
            </span>
          </span>
        </button>
        <Consent />
      </div>
    </div>
  );
}

const CHANNELS: { id: AwayChannel; label: string }[] = [
  { id: 'telegram', label: 'Telegram' },
  { id: 'push', label: 'Push' },
];

/** Where else the report may reach the person: two switches, off until they turn one on. */
function Consent() {
  const consent = useAway((st) => st.consent);
  const busy = useAway((st) => st.consentBusy);
  const error = useAway((st) => st.consentError);
  if (!consent?.canConsent) return null;
  return (
    <div className={a.consent}>
      <span className={a.consentWord}>{error ?? 'Also tell me in'}</span>
      {CHANNELS.map((c) => (
        <button
          key={c.id}
          role="switch"
          aria-checked={consent[c.id]}
          className={`${a.switch} ${consent[c.id] ? a.switchOn : ''}`}
          disabled={busy !== null}
          aria-busy={busy === c.id}
          onClick={() => {
            awayStore.getState().pause(true);
            void awayStore.getState().toggle(c.id);
          }}
        >
          <span className={a.knob} aria-hidden="true" />
          {c.label}
        </button>
      ))}
    </div>
  );
}
