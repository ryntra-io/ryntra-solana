"use client";

import { useState } from "react";

import { useSolanaI18n } from "../i18n/provider.tsx";
import { AchievementBadge, RankAvatar, RankBadge, tilt } from "./badge.tsx";
import { rankCopy, type AchievementWordId, type RankId } from "./rank-copy.ts";
import styles from "./rewards.module.css";

/**
 * Badges, inside Rewards: the frame this wallet's avatar wears, the badge of
 * every rank it has reached and the achievements it holds.
 *
 * At rest the panel is pictures, their names and one line saying a badge can
 * be chosen; what a badge asks for, or the day it was earned, is one touch
 * deeper — that same line, said for the badge chosen. A badge not reached is
 * drawn in slate with an empty gem, never hidden, so the way up stays
 * visible; the server leaves out an achievement not everyone can earn yet
 * until it is held. A held badge glows in its own metal, leans toward the
 * pointer with a light following it, and a sheen crosses it once when it is
 * chosen — light that moves only when the person does, under 600 ms, and
 * still for reduced motion. Every threshold comes from the server; with the rank
 * unavailable there is no frame to show, so none is drawn. Nothing here is
 * money, and nothing names another wallet.
 */

export type AchievementsSummary = Readonly<{
  ranks: readonly Readonly<{ rank: RankId; reached: boolean; at: string | null; from: string }>[];
  badges: readonly Readonly<{ id: AchievementWordId; earned: boolean; at: string | null }>[];
}>;

type Choice = "FRAME" | `RANK:${RankId}` | `BADGE:${AchievementWordId}`;

export function BadgesCard({
  wallet,
  rank,
  achievements,
}: {
  wallet: string;
  /** The rank held now; null when it could not be read. */
  rank: RankId | null;
  achievements: AchievementsSummary | null | undefined;
}) {
  const { locale } = useSolanaI18n();
  const copy = rankCopy(locale);
  const [chosen, setChosen] = useState<Choice | null>(null);
  if (!achievements) return null;

  const day = (at: string) =>
    new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { day: "numeric", month: "short", year: "numeric" }).format(new Date(at));
  const { ranks, badges } = achievements;
  const held = ranks.filter((step) => step.reached).length + badges.filter((badge) => badge.earned).length;
  const total = ranks.length + badges.length;
  const toggle = (choice: Choice) => setChosen((current) => (current === choice ? null : choice));

  let detail: { name: string; line: string } | null = null;
  if (chosen === "FRAME" && rank !== null) detail = { name: copy.frameOf(rank), line: copy.frameHow };
  else if (chosen?.startsWith("RANK:")) {
    const step = ranks.find((candidate) => `RANK:${candidate.rank}` === chosen);
    if (step) {
      const line = !step.reached || step.rank === "BRONZE" ? copy.rankHow(step.rank, step.from) : step.at ? copy.earnedOn(day(step.at)) : copy.reached;
      detail = { name: copy.rank[step.rank], line };
    }
  } else if (chosen?.startsWith("BADGE:")) {
    const badge = badges.find((candidate) => `BADGE:${candidate.id}` === chosen);
    if (badge) detail = { name: copy.achievement[badge.id], line: badge.earned && badge.at ? copy.earnedOn(day(badge.at)) : copy.achievementHow[badge.id] };
  }

  return (
    <section className={`${styles.panel} ${styles.badges}`} id="rewards-badges" aria-label={copy.badgesTitle}>
      <div className={styles.panelHead}>
        <h2 className={styles.title}>{copy.badgesTitle}</h2>
        <span className={styles.chip} data-tone="quiet" translate="no">
          <span aria-hidden="true">{copy.badgesHeld(held, total)}</span>
          <span className={styles.srOnly}>{copy.badgesHeldAloud(held, total)}</span>
        </span>
      </div>

      <div className={styles.badgesBody}>
        {rank !== null ? (
          <button
            type="button"
            className={styles.frameTile}
            aria-pressed={chosen === "FRAME"}
            aria-controls="rewards-badge-detail"
            aria-label={copy.avatar(rank)}
            data-framed={rank !== "BRONZE" ? "true" : "false"}
            onClick={() => toggle("FRAME")}
            {...tilt}
          >
            <RankAvatar wallet={wallet} rank={rank} size={56} className={styles.badgeArt} />
            <span className={styles.badgeName} aria-hidden="true">{copy.frameOf(rank)}</span>
          </button>
        ) : null}

        <ul className={styles.badgeGrid}>
          {ranks.map((step) => {
            const name = copy.rank[step.rank];
            return (
              <li key={step.rank}>
                <button
                  type="button"
                  className={styles.badgeTile}
                  data-held={step.reached ? "true" : "false"}
                  aria-pressed={chosen === `RANK:${step.rank}`}
                  aria-controls="rewards-badge-detail"
                  aria-label={step.reached ? name : copy.notYet(name)}
                  onClick={() => toggle(`RANK:${step.rank}`)}
                  {...tilt}
                >
                  <RankBadge rank={step.rank} locked={!step.reached} size={52} className={styles.badgeArt} />
                  <span className={styles.badgeName} aria-hidden="true">{name}</span>
                </button>
              </li>
            );
          })}
          {badges.map((badge) => {
            const name = copy.achievement[badge.id];
            return (
              <li key={badge.id}>
                <button
                  type="button"
                  className={styles.badgeTile}
                  data-held={badge.earned ? "true" : "false"}
                  aria-pressed={chosen === `BADGE:${badge.id}`}
                  aria-controls="rewards-badge-detail"
                  aria-label={badge.earned ? name : copy.notYet(name)}
                  onClick={() => toggle(`BADGE:${badge.id}`)}
                  {...tilt}
                >
                  <AchievementBadge achievement={badge.id} earned={badge.earned} size={52} className={styles.badgeArt} />
                  <span className={styles.badgeName} aria-hidden="true">{name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <p className={styles.badgeDetail} id="rewards-badge-detail" aria-live="polite" data-open={detail ? "true" : "false"}>
        {detail ? (
          <>
            <strong>{detail.name}</strong> · {detail.line}
          </>
        ) : held === total ? (
          copy.badgesAllHint
        ) : (
          copy.badgesHint
        )}
      </p>
    </section>
  );
}
