"use client";

import { useId } from "react";

import { useSolanaI18n } from "../i18n/provider.tsx";
import { RankBadge, tilt } from "./badge.tsx";
import { rankCopy, type RankId } from "./rank-copy.ts";
import styles from "./rewards.module.css";

/**
 * The rank, inside Rewards — where the Points card used to stand.
 *
 * The rank's name is the heading, its badge before it; the ring beside it is how far through the
 * rank this wallet is, from the rank's own start to the next threshold, with
 * the points of the last 30 days inside it. Under the name: the distance to
 * the next rank and one line saying where the points came from. Below, the
 * ladder of all five ranks with the share a friend's trade pays at each —
 * this wallet's step marked, the steps behind it quiet. The shares and
 * thresholds come from the server under the rules in force. The rules
 * sit in the page's own disclosure stack. Nothing here mentions a token, an
 * airdrop or a conversion, and no other wallet is named.
 */

export type RankSummary = Readonly<{
  rank: RankId;
  points: string;
  fromTrades: string;
  fromFriends: string;
  fromLaunches: string;
  rankFrom: string;
  next: Readonly<{ rank: RankId; at: string; toGo: string; friendShare: number }> | null;
  friendShare: number;
  secondLevelShare: number;
  ladder: readonly Readonly<{ rank: RankId; from: string; friendShare: number }>[];
  windowDays: number;
  rulesVersion: string;
}>;

/** A grouped figure back to its whole number; display only, never money. */
function whole(grouped: string): number {
  const value = Number(grouped.replace(/\D/g, ""));
  return Number.isFinite(value) ? value : 0;
}

/** How far through the current rank, from its start to the next threshold. */
export function rankProgress(rank: Pick<RankSummary, "points" | "rankFrom" | "next">): number {
  if (rank.next === null) return 100;
  const span = whole(rank.next.at) - whole(rank.rankFrom);
  if (span <= 0) return 100;
  const done = Math.max(0, Math.min(span, whole(rank.points) - whole(rank.rankFrom)));
  return Math.round((done / span) * 100);
}

const RING_RADIUS = 40;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

export function RankCard({ rank, inviterWindow = null, firstTen = false }: { rank: RankSummary | null; inviterWindow?: Readonly<{ share: number; days: number }> | null; firstTen?: boolean }) {
  const { locale } = useSolanaI18n();
  const copy = rankCopy(locale);
  const gradient = `rw-ring-${useId().replace(/:/g, "")}`;
  if (!rank) {
    return (
      <section className={`${styles.panel} ${styles.points} ${styles.rankUnavailable}`} id="rewards-rank" aria-label={copy.title}>
        <div className={styles.panelHead}>
          <h2 className={styles.title}>{copy.title}</h2>
        </div>
        <p className={styles.pointsLead}>{copy.unavailable}</p>
      </section>
    );
  }
  const percent = rankProgress(rank);
  const name = copy.rank[rank.rank];
  const fresh = whole(rank.points) === 0;
  /* From six digits the ring shows thousands — «112k» — and the full figure
     is read aloud in the ring's label. */
  const compact = whole(rank.points) >= 1_000_000
    ? copy.millions(Math.floor(whole(rank.points) / 1_000_000))
    : whole(rank.points) >= 100_000 ? copy.thousands(Math.floor(whole(rank.points) / 1000)) : null;
  const figure = compact ? compact.figure : copy.number(rank.points);
  const length = figure.replace(/\D/g, "").length;
  return (
    <section className={`${styles.panel} ${styles.points}`} id="rewards-rank" aria-label={copy.title} data-rank={rank.rank.toLowerCase()}>
      <div className={styles.panelHead}>
        <h2 className={styles.title}>{copy.title}</h2>
        <span className={styles.chip} data-tone="quiet">{copy.window(rank.windowDays)}</span>
      </div>

      <div className={styles.pointsBody}>
        <div className={styles.ring} role="img" aria-label={`${name} · ${copy.points(rank.points)} · ${percent}%`}>
          <svg viewBox="0 0 96 96" aria-hidden="true">
            <defs>
              <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" style={{ stopColor: "var(--ry-iris)" }} />
                <stop offset="1" style={{ stopColor: "var(--ry-iris-deep)" }} />
              </linearGradient>
            </defs>
            <circle className={styles.ringTrack} cx="48" cy="48" r={RING_RADIUS} />
            <circle
              className={styles.ringFill}
              style={{ stroke: `url(#${gradient})` }}
              cx="48"
              cy="48"
              r={RING_RADIUS}
              strokeDasharray={RING_LENGTH}
              strokeDashoffset={RING_LENGTH * (1 - percent / 100)}
            />
          </svg>
          <div className={styles.ringLabel} aria-hidden="true">
            <span className={styles.ringPoints} data-len={length >= 6 && figure.length > 6 ? "long" : String(length)} translate="no">{figure}</span>
            <span className={styles.ringUnit}>{compact ? compact.unit : copy.unit(rank.points)}</span>
          </div>
        </div>
        <div>
          <p className={styles.rankTitle}>
            {/* The rank's own badge: it glows in its metal and, under a
                pointer, leans toward it and catches a sheen. */}
            <span className={styles.rankBadgeHold} {...tilt}>
              <RankBadge rank={rank.rank} size={36} className={`${styles.badgeArt} ${styles.rankBadge}`} />
            </span>
            {name}
          </p>
          <p className={styles.pointsNext}>{rank.next ? copy.toNext(rank.next.toGo, rank.next.rank) : copy.top}</p>
          <p className={styles.pointsLead}>
            {fresh
              ? firstTen ? copy.freshWindow : copy.fresh
              : copy.breakdown(rank.fromTrades, rank.fromFriends, whole(rank.fromLaunches) > 0 ? rank.fromLaunches : null).map((segment, index) => (
                  <span key={segment}>
                    {index > 0 ? " · " : null}
                    <span className={styles.segment}>{segment}</span>
                  </span>
                ))}
          </p>
        </div>
      </div>

      <div className={styles.ladderBlock}>
        <span className={styles.eyebrow}>{copy.ladder}</span>
        <ol className={styles.ladder}>
          {rank.ladder.map((step, index) => {
            const at = rank.ladder.findIndex((candidate) => candidate.rank === rank.rank);
            const state = index === at ? "current" : index < at ? "passed" : "ahead";
            return (
              <li key={step.rank} className={styles.ladderStep} data-state={state} aria-current={state === "current" ? "step" : undefined}>
                <span className={styles.srOnly}>{copy.step(step.rank, step.friendShare, step.from)}</span>
                <span className={styles.ladderName} aria-hidden="true">{copy.rank[step.rank]}</span>
                <span className={styles.ladderShare} aria-hidden="true" translate="no">{step.friendShare}%</span>
                <span className={styles.ladderFrom} aria-hidden="true" translate="no">{copy.number(step.from)}+</span>
              </li>
            );
          })}
        </ol>
        {/* Rules 2.1.0: a friend's first days pay the window's share whatever the rank — said once, under the shares. */}
        {inviterWindow ? <p className={styles.ladderNote}>{copy.ladderWindowShort(inviterWindow.share, inviterWindow.days)}</p> : null}
      </div>
    </section>
  );
}
