'use client';

import { useEffect, useMemo, useState } from 'react';
import { launchTowerIn, useLaunch } from '@/city/lib/launch/district';
import { sinceLaunch } from '@/city/lib/launch/format';
import type { LaunchTower } from '@/city/lib/launch/towers';
import type { Progress } from '@/city/lib/launch/trade';
import { num, useWords, type Same } from '@/city/lib/i18n/dict';
import { LaunchTradePanel } from './LaunchTradePanel';
import s from './launch.module.css';
import { LAUNCH } from './words';

type W = Same<(typeof LAUNCH)['en']>;

const CHECK_DAYS = [7, 30, 90] as const;
/** A launch of this browser is a liftoff for its first minutes. */
const LIFTOFF_MS = 5 * 60_000;

/**
 * A launch's tower in the tower's one window (CITY-78, CITY-138): under the window's own head, where the coin is on its
 * way and how long it has flown, the checks of days 7, 30 and 90, then Buy and Sell on its curve or in its pool. Every
 * figure is the engine's; a figure it did not read is not shown. Sharing is the window's own, in its head.
 */
export function LaunchTowerBody({ token, onBusy }: { token: string; onBusy?: (busy: boolean) => void }) {
  const feed = useLaunch((st) => st.feed);
  const mine = useLaunch((st) => st.mine);
  const launch = useMemo(() => launchTowerIn({ feed, mine }, token), [feed, mine, token]);
  const stub = useLaunch((st) => st.stub);
  const now = useNow();
  const w = useWords(LAUNCH);
  if (!launch) return null;
  const liftoff = launch.mine && now - (Date.parse(launch.launchedAt ?? '') || 0) < LIFTOFF_MS;
  const since = sinceLaunch(launch.launchedAt, now);
  const accent = launch.phase === 'lost' ? 'var(--text-dim)' : launch.migrated ? 'var(--amber)' : 'var(--mint)';
  return (
    <div className={s.body} style={{ ['--accent' as string]: accent }}>
      <div className={s.cardTop}>
        <div className={s.kicker}>
          {!launch.migrated && launch.phase !== 'lost' && <span className={s.pulse} aria-hidden="true" />}
          {kicker(w, launch, liftoff)}
          {since && <span className={s.kickerTime}>· {since}</span>}
        </div>
        {launch.holders !== null && (
          <div className={s.holders}>
            <b>{launch.holdersAtLeast ? '≥' : ''}{num(launch.holders)}</b> {w.holders}
          </div>
        )}
      </div>
      {launch.phase === 'lost' && <div className={s.cardLine}>{lostLine(w, launch)}</div>}
      <div className={s.tags}>
        {launch.mine && <span className={`${s.tag} ${s.tagMine}`}>{w.yourTower}</span>}
        <span className={s.tag}>{w.ryntraLaunch}</span>
        {launch.network === 'solana:devnet' && <span className={`${s.tag} ${s.tagNet}`}>{w.devnet}</span>}
        {launch.ryntraTest && <span className={s.tag}>{w.ryntraTest}</span>}
        {stub && <span className={`${s.tag} ${s.tagNet}`}>{w.stub}</span>}
        <span className={`${s.tag} ${s.tagWarn}`}>{w.notVerified}</span>
      </div>
      <div className={s.checks} aria-label={w.checks}>
        {CHECK_DAYS.map((day, index) => (
          <span key={day} className={`${s.check} ${checkClass(launch.checks[index]!)}`}>
            {w.day(day)}
            {launch.checks[index] === 'alive' ? ' ✓' : launch.checks[index] === 'quiet' ? w.quiet : ''}
          </span>
        ))}
      </div>
      {/* Buy and Sell last, so their pinned dock (the fee, the one line and the action) closes the window. */}
      <LaunchTradePanel key={launch.token} token={launch.token} symbol={launch.symbol} fallback={fallbackOf(launch)} onBusy={onBusy} />
    </div>
  );
}

function kicker(w: W, launch: LaunchTower, liftoff: boolean): string {
  if (launch.phase === 'lost') return w.kickerQuiet;
  if (launch.phase === 'star') return w.kickerLandmark;
  if (launch.migrated) return w.kickerSkyline;
  return liftoff ? w.kickerLiftoff : w.kickerRising;
}

/** A quiet check, said as the chain has it. */
function lostLine(w: W, launch: LaunchTower): string {
  return w.lineQuiet(CHECK_DAYS[launch.checks.indexOf('quiet')] ?? 7);
}

/** The way to the DEX as the city's feed last read it, until the trade panel's own read of the market is here. */
function fallbackOf(launch: LaunchTower): Progress {
  if (launch.migrated) return { migrated: true, jupiter: false };
  return { migrated: false, pct: Math.floor(launch.progress ?? 0), capUsd: launch.marketCapUsd, graduationUsd: launch.graduationUsd };
}

function checkClass(state: string): string {
  return state === 'alive' ? s.checkOk : state === 'quiet' ? s.checkQuiet : s.checkAhead;
}

/** The clock the body counts its time by, a tick a second while it is open. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
