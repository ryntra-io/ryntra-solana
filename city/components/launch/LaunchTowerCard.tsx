'use client';

import { useEffect, useMemo, useState } from 'react';
import { postIntentUrl } from '@/lib/mission-control/scene';
import { useCity } from '@/city/lib/city/store';
import { coinLink } from '@/city/lib/share/coin-link';
import { launchTowerIn, useLaunch } from '@/city/lib/launch/district';
import { sinceLaunch, usd } from '@/city/lib/launch/format';
import type { LaunchTower } from '@/city/lib/launch/towers';
import { CloseGlyph } from '../hud/glyphs';
import s from './launch.module.css';

const CHECK_DAYS = [7, 30, 90] as const;
/** A launch of this browser is a liftoff for its first minutes. */
const LIFTOFF_MS = 5 * 60_000;

/**
 * A launch's tower, picked in the city: where it is on its way — the curve, the pool, the checks of days 7, 30 and 90 —
 * with the engine's own figures and the time it has flown. A figure the engine did not read is not shown.
 */
export function LaunchTowerCard({ token }: { token: string }) {
  const feed = useLaunch((st) => st.feed);
  const mine = useLaunch((st) => st.mine);
  const launch = useMemo(() => launchTowerIn({ feed, mine }, token), [feed, mine, token]);
  const stub = useLaunch((st) => st.stub);
  const select = useCity((st) => st.select);
  const now = useNow();
  if (!launch) return null;
  const liftoff = launch.mine && now - (Date.parse(launch.launchedAt ?? '') || 0) < LIFTOFF_MS;
  const since = sinceLaunch(launch.launchedAt, now);
  const accent = launch.phase === 'lost' ? 'var(--text-dim)' : launch.migrated ? 'var(--amber)' : 'var(--mint)';
  // In the Ryntra app the link to X opens outside the city through the bridge (CITY-6b), as in a browser's new tab.
  const share = launch.network === 'solana:mainnet' && !stub && launch.phase !== 'lost';
  return (
    <div className={`${s.panel} ${s.card}`} style={{ ['--accent' as string]: accent }} role="dialog" aria-label={`$${launch.symbol}`}>
      <div className={s.cardTop}>
        <div className={s.kicker}>
          {!launch.migrated && launch.phase !== 'lost' && <span className={s.pulse} aria-hidden="true" />}
          {kicker(launch, liftoff)}
          {since && <span className={s.kickerTime}>· {since}</span>}
        </div>
        <button className={s.close} aria-label="Close" onClick={() => select(null)}>
          <CloseGlyph />
        </button>
      </div>
      <div className={s.cardHead}>
        <Picture src={launch.image} className={s.cardPic} />
        <div className={s.cardTitle}>
          <div className={`${s.display} ${s.cardSymbol}`}>${launch.symbol}</div>
          <div className={s.cardName}>{launch.name}</div>
        </div>
        {launch.holders !== null && (
          <div className={s.holders}>
            <b>{launch.holdersAtLeast ? '≥' : ''}{launch.holders.toLocaleString('en-US')}</b> holders
          </div>
        )}
      </div>
      <div className={s.tags}>
        {launch.mine && <span className={`${s.tag} ${s.tagMine}`}>Your tower</span>}
        <span className={s.tag}>Ryntra Launch</span>
        {launch.network === 'solana:devnet' && <span className={`${s.tag} ${s.tagNet}`}>Devnet</span>}
        {launch.ryntraTest && <span className={s.tag}>Ryntra test</span>}
        {stub && <span className={`${s.tag} ${s.tagNet}`}>Stub data</span>}
        <span className={`${s.tag} ${s.tagWarn}`}>Not verified by Jupiter</span>
      </div>
      {!launch.migrated && launch.phase !== 'lost' && (
        <div className={s.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={launch.progress ?? undefined} aria-label="Way to the skyline">
          <div className={s.barFill} style={{ width: `${Math.max(2, Math.min(100, launch.progress ?? 0))}%` }} />
        </div>
      )}
      <div className={s.cardLine}>{line(launch)}</div>
      <div className={s.checks} aria-label="Survival checks">
        {CHECK_DAYS.map((day, index) => (
          <span key={day} className={`${s.check} ${checkClass(launch.checks[index]!)}`}>
            Day {day}
            {launch.checks[index] === 'alive' ? ' ✓' : launch.checks[index] === 'quiet' ? ' · quiet' : ''}
          </span>
        ))}
      </div>
      {share && (
        <a
          className={`${s.display} ${s.action}`}
          href={postIntentUrl(launch.migrated ? `$${launch.symbol} moved into the skyline on Ryntra.` : `$${launch.symbol} is rising in the Launch Docks of Ryntra City.`, coinLink(launch.token))}
          target="_blank"
          rel="noreferrer"
        >
          Share ${launch.symbol}
        </a>
      )}
    </div>
  );
}

function kicker(launch: LaunchTower, liftoff: boolean): string {
  if (launch.phase === 'lost') return 'Quiet';
  if (launch.phase === 'star') return 'Landmark';
  if (launch.migrated) return 'In the skyline';
  return liftoff ? 'Liftoff' : 'Rising now';
}

/** One line under the bar: how far it is, or where it stands now; a quiet check said as the chain has it. */
function line(launch: LaunchTower): string {
  if (launch.phase === 'lost') {
    const day = CHECK_DAYS[launch.checks.indexOf('quiet')] ?? 7;
    return `Nobody but its creator and Ryntra traded it in the week before day ${day}. It can still be traded.`;
  }
  if (launch.migrated) return launch.liquidityUsd !== null ? `In its Meteora pool · ${usd(launch.liquidityUsd)} liquidity, locked forever` : 'In its Meteora pool · liquidity locked forever';
  if (launch.marketCapUsd !== null && launch.graduationUsd !== null) return `${usd(launch.marketCapUsd)} of ${usd(launch.graduationUsd)} to the skyline`;
  if (launch.progress !== null) return `${Math.floor(launch.progress)}% of the way to the skyline`;
  return 'Reading its curve…';
}

function checkClass(state: string): string {
  return state === 'alive' ? s.checkOk : state === 'quiet' ? s.checkQuiet : s.checkAhead;
}

/** The creator's picture right after the launch, or the engine's copy, on the same origin; a picture that fails leaves the disc. */
function Picture({ src, className }: { src: string | null; className: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <span className={className} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={src} alt="" onError={() => setFailed(src)} />;
}

/** The clock the card counts its time by, a tick a second while it is open. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
