'use client';

import { useEffect, useMemo, useState } from 'react';
import { openBerth } from '@/city/lib/launch/berth-store';
import { launchTowerIn, useLaunch } from '@/city/lib/launch/district';
import { sinceLaunch } from '@/city/lib/launch/format';
import type { LaunchTower } from '@/city/lib/launch/towers';
import type { Progress } from '@/city/lib/launch/trade';
import { towerHalo } from '@/city/lib/launch/shield';
import { crownRings, mergeFlow, omitGraduationPill, silhouetteOf, SILHOUETTE_RULE, towerFlowOf, type Silhouette } from '@/city/lib/launch/silhouette';
import { SILHOUETTE_WORDS, TRUST_WORDS } from '@/city/lib/launch/words';
import { num, useWords, type Same } from '@/city/lib/i18n/dict';
import type { RingState } from '@/lib/launch/flow/counts';
import { BerthGlyph } from '../berth/glyphs';
import { ReportFlag, ReportPanel } from './LaunchReport';
import { LaunchTradePanel } from './LaunchTradePanel';
import { LaunchTrust, useLaunchFlow } from './LaunchTrust';
import s from './launch.module.css';
import { LAUNCH } from './words';

type W = Same<(typeof LAUNCH)['en']>;
type SW = Same<(typeof SILHOUETTE_WORDS)['en']>;

const CHECK_DAYS = [7, 30, 90] as const;
/** A launch of this browser is a liftoff for its first minutes. */
const LIFTOFF_MS = 5 * 60_000;

/**
 * A launch's tower in the tower's one window (CITY-78, CITY-138): under the window's own head, where the coin is on its
 * way and how long it has flown, the checks of days 7, 30 and 90, then Buy and Sell on its curve or in its pool. Every
 * figure is the engine's; a figure it did not read is not shown. Sharing is the window's own, in its head.
 *
 * After its graduation the line on top says where the tower stands (L7, CITY-144): in the skyline, or still in the
 * Docks as a «Fast exit» or «Graduated with N buyers». The checks are the crown's rings, lit only by a trade outside the
 * creator's wallets; the rule and «not advice» are behind the «i» beside them.
 */
export function LaunchTowerBody({ token, onBusy }: { token: string; onBusy?: (busy: boolean) => void }) {
  const feed = useLaunch((st) => st.feed);
  const mine = useLaunch((st) => st.mine);
  const launch = useMemo(() => launchTowerIn({ feed, mine }, token), [feed, mine, token]);
  const stub = useLaunch((st) => st.stub);
  const wallet = useLaunch((st) => st.connection?.address ?? null);
  const now = useNow();
  const w = useWords(LAUNCH);
  const t = useWords(TRUST_WORDS);
  const sw = useWords(SILHOUETTE_WORDS);
  const [reporting, setReporting] = useState<string | null>(null);
  const [aboutOf, setAboutOf] = useState<string | null>(null);
  const { flow, settled } = useLaunchFlow(token);
  if (!launch) return null;
  // The window says what its own read of the flow says, the feed's until it is in — a floor never below the feed's, as
  // the city counts it: a ring lights only on a trade traced outside the creator's wallets, and the top line says where
  // the graduation stands.
  const read = flow ? mergeFlow(launch.flow, towerFlowOf(flow)) : launch.flow;
  const rings = crownRings(launch.checks, read?.survival ?? null);
  const silhouette = silhouetteOf({ ...launch, flow: read });
  const below = silhouette.status === 'fast' || silhouette.status === 'few';
  const liftoff = launch.mine && now - (Date.parse(launch.launchedAt ?? '') || 0) < LIFTOFF_MS;
  const since = sinceLaunch(launch.launchedAt, now);
  const accent = launch.phase === 'lost' || launch.hidden ? 'var(--text-dim)' : below ? 'var(--warm)' : launch.migrated ? 'var(--amber)' : 'var(--mint)';
  /* The shield's halo (CITY-169), on the window's own read of the creator's wallet once it is in. */
  const halo = towerHalo({ ...launch, flow: read });
  const report = reporting === launch.token;
  const about = aboutOf === launch.token;
  return (
    <div className={s.body} style={{ ['--accent' as string]: accent }}>
      <div className={s.cardTop}>
        <div className={s.kicker}>
          {!launch.migrated && launch.phase !== 'lost' && !launch.hidden && <span className={s.pulse} aria-hidden="true" />}
          {kicker(w, sw, launch, silhouette, rings, liftoff)}
          {since && <span className={s.kickerTime}>· {since}</span>}
        </div>
        {launch.holders !== null && !(launch.holdersAtLeast && launch.holders === 0) && (
          <div className={s.holders}>
            <b>{launch.holdersAtLeast ? '≥' : ''}{num(launch.holders)}</b> {w.holders}
          </div>
        )}
        {/* «Report» on someone else's coin that Ryntra has not taken down (MC-1). */}
        {!launch.mine && launch.creator !== wallet && !launch.hidden && <ReportFlag on={report} onToggle={() => setReporting(report ? null : launch.token)} />}
      </div>
      {launch.hidden && <div className={s.cardLine}>{w.lineHidden}</div>}
      {launch.phase === 'lost' && !launch.hidden && <div className={s.cardLine}>{lostLine(w, launch)}</div>}
      {report ? (
        <ReportPanel launch={launch} />
      ) : (
        <>
          <div className={s.tags}>
            {/* The creator's own tower opens «Моя вежа» on it (CITY-141, CITY-168). */}
            {(launch.mine || (wallet !== null && launch.creator === wallet)) && (
              <button type="button" className={`${s.tag} ${s.tagBerth}`} data-launch-berth="" onClick={() => openBerth(launch.token)}>
                <BerthGlyph />
                {w.myBerth}
              </button>
            )}
            {halo && (
              <span className={`${s.tag} ${s.tagHalo}`} data-launch-halo="">
                <span className={s.haloMark} aria-hidden="true" />
                {w.halo}
              </span>
            )}
            <span className={s.tag}>{w.ryntraLaunch}</span>
            {launch.network === 'solana:devnet' && <span className={`${s.tag} ${s.tagNet}`}>{w.devnet}</span>}
            {launch.ryntraTest && <span className={s.tag}>{w.ryntraTest}</span>}
            {stub && <span className={`${s.tag} ${s.tagNet}`}>{w.stub}</span>}
            <span className={`${s.tag} ${s.tagWarn}`}>{w.notVerified}</span>
          </div>
          {/* Who bought it and how (L3, CITY-140): facts of the chain above the trade, never a verdict. */}
          {/* «Graduated with N buyers» is said on top: the flow's own pill of it would say it twice. */}
          <LaunchTrust flow={flow} settled={settled} omit={omitGraduationPill(silhouette, flow?.graduation.singleTrade ?? false) ? ['graduation'] : undefined} />
          <div className={s.checks} aria-label={w.checks}>
            {CHECK_DAYS.map((day, index) => (
              <span key={day} className={`${s.check} ${checkClass(rings[index]!)}`} title={rings[index] === 'unproven' ? t.ringDevTitle : undefined}>
                {w.day(day)}
                {rings[index] === 'alive' ? ' ✓' : rings[index] === 'quiet' ? w.quiet : rings[index] === 'unproven' ? t.ringDev : ''}
              </span>
            ))}
            <button type="button" className={`${s.info} ${s.checksInfo} ${about ? s.infoOpen : ''}`} aria-expanded={about} aria-label={sw.about} data-launch-status="" onClick={() => setAboutOf(about ? null : launch.token)}>
              i
            </button>
          </div>
          {about && (
            <ul className={s.method}>
              <li>{sw.rule(num(SILHOUETTE_RULE.minBuyers), num(SILHOUETTE_RULE.minCurveMinutes))}</li>
              <li>{sw.rings}</li>
              {halo && <li>{sw.halo}</li>}
              <li>{sw.notAdvice}</li>
            </ul>
          )}
        </>
      )}
      {/* Buy and Sell last, so their pinned dock (the fee, the one line and the action) closes the window; it stays
          mounted under «Report» so a trade in flight is never dropped. A coin Ryntra took down is only sold. */}
      <div hidden={report}>
        <LaunchTradePanel key={launch.token} token={launch.token} symbol={launch.symbol} fallback={fallbackOf(launch)} onBusy={onBusy} sellOnly={launch.hidden} launchedAt={launch.launchedAt} logo={Boolean(launch.image)} />
      </div>
    </div>
  );
}

function kicker(w: W, sw: SW, launch: LaunchTower, silhouette: Silhouette, rings: readonly RingState[], liftoff: boolean): string {
  if (launch.hidden) return w.kickerHidden;
  if (launch.phase === 'lost') return w.kickerQuiet;
  if (!launch.migrated) return liftoff ? w.kickerLiftoff : w.kickerRising;
  switch (silhouette.status) {
    case 'skyline':
      return rings[2] === 'alive' ? w.kickerLandmark : w.kickerSkyline;
    case 'fast':
      return sw.fastExit;
    case 'few': {
      /* No independent buyer counted yet: the flow's own pill says what was read. */
      const n = silhouette.buyers ?? 0;
      return n > 0 ? sw.graduatedWith(n, `${silhouette.atLeast ? '≥' : ''}${num(n)}`) : sw.graduated;
    }
    default:
      return sw.graduated;
  }
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

function checkClass(state: RingState): string {
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
