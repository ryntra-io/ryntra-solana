"use client";

import { ArrowRight, Check } from "@phosphor-icons/react";
import Link from "next/link";

import { useSolanaI18n } from "../i18n/provider.tsx";
import { SeasonBadge } from "./badge.tsx";
import { leagueCopy } from "./league-copy.ts";
import { useSeason } from "./season-view.tsx";
import styles from "./leagues.module.css";

/**
 * The season, inside Rewards: its name and week, the three tasks with a
 * mark each, and the way to the boards and the season. At rest it is names
 * and marks — what each task asks is on the season page. Nothing here is an
 * action of its own: the page's one action stays Claim.
 */
export function SeasonCard() {
  const { locale } = useSolanaI18n();
  const words = leagueCopy(locale);
  const { data } = useSeason(null);
  const intl = locale === "uk" ? "uk-UA" : "en-US";
  if (!data?.season) return null;
  const season = data.season;
  const you = data.you;
  const done = you ? you.tasks.filter((task) => task.done).length : 0;
  const lastDay = new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.parse(season.end) - 86_400_000));

  return (
    <section className={`${styles.panel} ${styles.card}`} id="rewards-season" aria-labelledby="rewards-season-title">
      <div className={styles.cardHead}>
        <SeasonBadge badge="SEASON" earned={!!you?.complete} size={40} className={you?.complete ? styles.badgeGlow : undefined} />
        <span className={styles.cardTitle}>
          <h2 className={styles.title} id="rewards-season-title">
            {words.seasonTitle(season.number)} · {words.theme[season.theme]}
          </h2>
          <span className={styles.stripMeta}>
            {season.week ? `${words.weekOf(season.week, season.weeks)} · ` : ""}
            {words.ends(lastDay)}
          </span>
        </span>
        {you ? <span className={styles.chip} translate="no">{words.tasksDone(done, you.tasks.length)}</span> : null}
      </div>
      {you ? (
        <ul className={styles.tasks}>
          {you.tasks.map((task) => (
            <li key={task.id} className={styles.task} data-done={task.done ? "true" : "false"}>
              <span className={styles.taskMark} aria-hidden="true">
                <Check size={13} weight="bold" />
              </span>
              <span className={styles.taskName}>{words.task[task.id]}</span>
              <span className={styles.taskFigure} translate="no">{words.progress(task.have, task.need)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.cardLinks}>
        <Link className={styles.link} href="/app/rewards/leaderboard">
          {words.openBoards}
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
        <Link className={styles.link} href="/app/rewards/season">
          {words.openSeason}
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
