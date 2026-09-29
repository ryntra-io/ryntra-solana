"use client";

import { ArrowRight } from "@phosphor-icons/react";
import Link from "next/link";

import { formatPoints } from "@/lib/points/model";
import { useSolanaI18n } from "../i18n/provider.tsx";
import styles from "./rewards.module.css";

/**
 * Ryntra Points, inside Rewards — the Owner's placement, not a page.
 *
 * The level is drawn as a ring: how far through the current level this wallet
 * is, from the level's own start to the next threshold, with the level number
 * inside it. Beside the ring the points and the distance to the next level;
 * under them four facts — rank, eligible volume, trades, active days. The
 * rules sit in the page's own disclosure stack, beside the rewards rules —
 * opening them moves no panel. Nothing here mentions a token, an
 * airdrop or a conversion, because there is no such promise to mention. The
 * rank names no other wallet; there is no leaderboard by decision.
 */

export type PointsSummary = Readonly<{
  points: string;
  level: number;
  levelFrom: string;
  nextLevelAt: string | null;
  rank: number | null;
  ranked: number;
  volume: string;
  trades: number;
  activeDays: number;
  policyVersion: string;
  excluded?: boolean;
}>;

/** A grouped figure back to its whole number; display only, never money. */
function whole(grouped: string): number {
  const value = Number(grouped.replace(/\D/g, ""));
  return Number.isFinite(value) ? value : 0;
}

/**
 * How far through the current level, from the level's start to the next
 * threshold — so a wallet that has just reached a level starts its ring at
 * zero rather than at the fraction of the whole ladder it happens to hold.
 */
export function levelProgress(points: Readonly<{ points: string; levelFrom: string; nextLevelAt: string | null }>): { percent: number; toNext: number | null } {
  if (points.nextLevelAt === null) return { percent: 100, toNext: null };
  const have = whole(points.points);
  const from = whole(points.levelFrom);
  const need = whole(points.nextLevelAt);
  const span = need - from;
  if (span <= 0) return { percent: 100, toNext: 0 };
  const done = Math.max(0, Math.min(span, have - from));
  return { percent: Math.round((done / span) * 100), toNext: Math.max(0, need - have) };
}

const RING_RADIUS = 40;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

export function PointsCard({ points }: { points: PointsSummary | null }) {
  const { text } = useSolanaI18n();
  if (!points) {
    return (
      <section className={`${styles.panel} ${styles.points}`} aria-label={text("Ryntra Points")}>
        <div className={styles.panelHead}>
          <h2 className={styles.title}>{text("Ryntra Points")}</h2>
        </div>
        <p className={styles.pointsLead}>{text("Points are unavailable right now.")}</p>
      </section>
    );
  }
  const { percent, toNext } = levelProgress(points);
  const fresh = points.trades === 0 && !points.excluded;
  return (
    <section className={`${styles.panel} ${styles.points}`} aria-label={text("Ryntra Points")}>
      <div className={styles.panelHead}>
        <h2 className={styles.title}>{text("Ryntra Points")}</h2>
        <span className={styles.chip} translate="no">
          {text("Level")} {points.level}
        </span>
      </div>

      <div className={styles.pointsBody}>
        <div className={styles.ring} role="img" aria-label={`${text("Level")} ${points.level} · ${percent}%`}>
          <svg viewBox="0 0 96 96" aria-hidden="true">
            <defs>
              <linearGradient id="rw-ring-fill" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" style={{ stopColor: "var(--ry-iris)" }} />
                <stop offset="1" style={{ stopColor: "var(--ry-iris-deep)" }} />
              </linearGradient>
            </defs>
            <circle className={styles.ringTrack} cx="48" cy="48" r={RING_RADIUS} />
            <circle
              className={styles.ringFill}
              cx="48"
              cy="48"
              r={RING_RADIUS}
              strokeDasharray={RING_LENGTH}
              strokeDashoffset={RING_LENGTH * (1 - percent / 100)}
            />
          </svg>
          <div className={styles.ringLabel} aria-hidden="true">
            <span className={styles.ringLevel} translate="no">{points.level}</span>
            <span className={styles.ringWord}>{text("Level")}</span>
          </div>
        </div>
        <div>
          <p className={styles.pointsFigure} translate="no">
            {points.points}
            <span className={styles.unit}>{text("points")}</span>
          </p>
          <p className={styles.pointsNext}>
            {toNext === null ? (
              text("Top level")
            ) : (
              <>
                <b translate="no">{formatPoints(BigInt(toNext))}</b> {text("to Level")} <b translate="no">{points.level + 1}</b>
              </>
            )}
          </p>
          <p className={styles.pointsLead}>
            {text("Points reflect your genuine activity on Ryntra. They have no cash value and cannot be transferred.")}
          </p>
        </div>
      </div>
      {points.excluded ? <p className={styles.pointsLead}>{text("This wallet is marked as a test wallet and does not earn Points.")}</p> : null}

      <dl className={styles.tiles}>
        <div className={styles.tile}>
          <dt>{text("Your rank")}</dt>
          <dd translate="no">
            {points.rank === null ? "—" : `#${points.rank}`}
            {points.rank === null ? <span> {text("Not ranked yet")}</span> : <span> {text("of")} {points.ranked}</span>}
          </dd>
        </div>
        <div className={styles.tile}>
          <dt>{text("Eligible volume")}</dt>
          <dd translate="no">{points.volume}</dd>
        </div>
        <div className={styles.tile}>
          <dt>{text("Completed trades")}</dt>
          <dd translate="no">{points.trades}</dd>
        </div>
        <div className={styles.tile}>
          <dt>{text("Active days")}</dt>
          <dd translate="no">{points.activeDays}</dd>
        </div>
      </dl>

      {fresh ? (
        <p className={styles.next}>
          <span>{text(whole(points.points) > 0 ? "An eligible trade can earn you more Points." : "Your first settled trade starts your points.")}</span>
          <Link className={styles.go} href="/app/swap">
            {text("Make a trade")}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </p>
      ) : null}
    </section>
  );
}
