"use client";

import { ArrowRight, Check } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SeasonResponse } from "@/lib/growth/league-view";
import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { WalletChoices } from "../wallet-gate.tsx";
import { useWalletProof } from "../wallet-proof.tsx";
import { FaceAvatar, SeasonBadge } from "./badge.tsx";
import { leagueCopy, type BoardWordId } from "./league-copy.ts";
import styles from "./leagues.module.css";

/**
 * A season, and its summary once it ends: the theme and the eight weeks,
 * what this wallet did of the three tasks and the two season badges, each
 * week's top three on every board, and how many took part.
 *
 * The same page answers a running season (the week now marked on the
 * track) and an ended one (every week's podium final) — the summary is not a
 * second page. Tasks and badges need the wallet's proof; the rest is public.
 */

const BOARDS: readonly BoardWordId[] = ["TRADERS", "FRIENDS", "CREATORS"];

/** One wallet's season, or the public page — shared by the page and the card on Rewards. */
export function useSeason(season: number | null) {
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const address = connection?.address ?? null;
  const proven = proof.state.status === "proven" && proof.state.address === address;
  const key = `${season ?? "now"}:${proven ? address : ""}`;
  const currentKey = useRef(key);
  currentKey.current = key;
  const [snapshot, setSnapshot] = useState<{ key: string; data: SeasonResponse } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    const asked = key;
    try {
      const params = new URLSearchParams();
      if (season !== null) params.set("season", String(season));
      if (proven && address) params.set("address", address);
      const response = await fetch(`/api/growth/season${params.size ? `?${params}` : ""}`);
      if (currentKey.current !== asked) return;
      if (!response.ok) throw new Error("unavailable");
      const body = (await response.json()) as SeasonResponse;
      if (currentKey.current !== asked) return;
      setSnapshot({ key: asked, data: body });
      setFailed(null);
    } catch {
      if (currentKey.current === asked) setFailed(asked);
    }
  }, [key, season, proven, address]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data: snapshot?.key === key ? snapshot.data : null, failed: failed === key, load, address, proven, proof };
}

export function SeasonView({ season: asked }: { season: number | null }) {
  const { locale } = useSolanaI18n();
  const words = leagueCopy(locale);
  const { data, failed, load, address, proven, proof } = useSeason(asked);
  const intl = locale === "uk" ? "uk-UA" : "en-US";
  const day = (iso: string) => new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
  const lastDay = (iso: string) => day(new Date(Date.parse(iso) - 86_400_000).toISOString());

  if (!data) {
    return (
      <section className={styles.panel} aria-live="polite">
        <div className={styles.state}>
          <p className={styles.lead}>{failed ? words.seasonUnavailable : words.loading}</p>
          {failed ? (
            <button type="button" className={styles.quietButton} onClick={() => void load()}>
              {words.retry}
            </button>
          ) : null}
        </div>
      </section>
    );
  }
  if (!data.season) {
    return (
      <section className={styles.panel}>
        <div className={styles.state}>
          <SeasonBadge badge="SEASON" earned={false} size={56} />
          <p className={styles.lead}>{words.notStarted}</p>
        </div>
      </section>
    );
  }

  const season = data.season;
  const ended = season.state === "ENDED";
  const you = data.you;
  const done = you ? you.tasks.filter((task) => task.done).length : 0;
  /* The creators' podium only once any launch has reached a DEX. */
  const boards = data.creators ? BOARDS : BOARDS.filter((board) => board !== "CREATORS");
  const weekState = (week: SeasonResponse["weeks"][number]) =>
    week.state === "LIVE" ? words.running : week.state === "AHEAD" ? words.ahead : week.final ? words.final : words.settling;

  return (
    <div className={styles.page}>
      <div className={styles.seasonGrid}>
        <div className={styles.page}>
          <section className={`${styles.panel} ${styles.seasonHero}`} aria-labelledby="season-name">
            <SeasonBadge badge="SEASON" earned={!!you?.complete} size={64} className={you?.complete ? styles.badgeGlow : undefined} />
            <div className={styles.seasonHeroText}>
              <span className={styles.eyebrow}>{ended && asked !== null ? words.seasonSummary : words.seasonTitle(season.number)}</span>
              <h2 className={styles.seasonName} id="season-name">{words.theme[season.theme]}</h2>
              <span className={styles.stripMeta} translate="no">
                {ended ? `${words.ended} · ` : season.week ? `${words.weekOf(season.week, season.weeks)} · ` : ""}
                {words.weekRange(day(season.start), lastDay(season.end))}
              </span>
              <div className={styles.weekTrack} aria-hidden="true">
                {data.weeks.map((week) => <span key={week.start} className={styles.weekTick} data-state={week.state} />)}
              </div>
            </div>
          </section>

          <section className={`${styles.panel} ${styles.pad}`} aria-labelledby="season-you" data-you-state={you ? "proven" : address ? "unproven" : "none"}>
            <div className={styles.head}>
              <h2 className={styles.title} id="season-you">{words.yourSeason}</h2>
              {you ? <span className={styles.chip} translate="no">{words.tasksDone(done, you.tasks.length)}</span> : null}
            </div>
            {!address ? (
              <>
                <p className={styles.lead}>{words.seasonConnect}</p>
                <WalletChoices single="button" errorClassName={styles.error} />
              </>
            ) : !proven || !you ? (
              <div className={styles.head}>
                <p className={styles.lead}>{words.seasonConfirm}</p>
                <button type="button" className={styles.button} onClick={() => void proof.prove()} disabled={proof.state.status === "signing"}>
                  {proof.state.status === "signing" ? words.confirming : words.confirm}
                </button>
              </div>
            ) : (
              <>
                {/* At rest a task is its name and how far; what it asks, or
                    when it was done, is one touch deeper. */}
                <ul className={styles.tasks} data-ended={ended ? "true" : "false"}>
                  {you.tasks.map((task) => (
                    <li key={task.id} data-done={task.done ? "true" : "false"} className={styles.taskItem}>
                      <details className={styles.taskDetails}>
                        <summary className={styles.task}>
                          <span className={styles.taskMark} aria-hidden="true">
                            <Check size={13} weight="bold" />
                          </span>
                          <span className={styles.taskName}>
                            {words.task[task.id]}
                            <span className={styles.srOnly}>{task.done ? `, ${words.taskDoneAloud}` : ""}</span>
                          </span>
                          <span className={styles.taskFigure} translate="no">{words.progress(task.have, task.need)}</span>
                        </summary>
                        <p className={styles.taskHow}>
                          {task.done && task.at ? words.doneOn(day(task.at)) : ended ? words.notDone : words.taskHow[task.id]}
                        </p>
                      </details>
                    </li>
                  ))}
                </ul>
                <div className={styles.seasonBadges}>
                  <div className={styles.seasonBadge} data-held={you.complete ? "true" : "false"}>
                    <SeasonBadge badge="SEASON" earned={you.complete} size={44} className={you.complete ? styles.badgeGlow : undefined} label={you.complete ? words.seasonBadge(season.number) : words.notYet(words.seasonBadge(season.number))} />
                    <span className={styles.seasonBadgeText}>
                      <span className={styles.seasonBadgeName}>{words.seasonBadge(season.number)}</span>
                      <span className={styles.seasonBadgeLine}>{you.complete && you.completedAt ? words.doneOn(day(you.completedAt)) : ended ? words.notDone : words.seasonBadgeHow}</span>
                    </span>
                  </div>
                  <div className={styles.seasonBadge} data-held={you.podium ? "true" : "false"}>
                    <SeasonBadge badge="PODIUM" earned={!!you.podium} size={44} className={you.podium ? styles.badgeGlow : undefined} label={you.podium ? words.podiumBadge : words.notYet(words.podiumBadge)} />
                    <span className={styles.seasonBadgeText}>
                      <span className={styles.seasonBadgeName}>{words.podiumBadge}</span>
                      <span className={styles.seasonBadgeLine}>
                        {you.podium ? words.podiumHeld(you.podium.board, you.podium.place, you.podium.week) : you.hidden ? words.podiumHidden : ended ? words.notDone : words.podiumBadgeHow}
                      </span>
                    </span>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>

        <section className={`${styles.panel} ${styles.pad}`} aria-labelledby="season-weeks">
          <div className={styles.head}>
            <h2 className={styles.title} id="season-weeks">{words.weeksTitle}</h2>
            <Link className={styles.link} href="/app/rewards/leaderboard">
              {words.openBoards}
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
          {data.community ? <p className={styles.community} translate="no">{words.community(data.community.participants, data.community.complete, ended)}</p> : null}
          {/* The running week open; every finished week one line until opened;
              a week ahead one quiet line. */}
          <ol className={styles.weeks}>
            {data.weeks.map((week) => {
              const head = (
                <span className={styles.weekHead}>
                  <span className={styles.weekName}>{words.weekLabel(week.number)}</span>
                  <span className={styles.weekDates} translate="no">{words.weekRange(day(week.start), lastDay(week.end))}</span>
                  <span className={styles.weekDates}>{weekState(week)}</span>
                  {week.state === "ENDED" && week.podiums ? (
                    <span className={styles.weekTop} translate="no">
                      {week.podiums.TRADERS[0]
                        ? words.topTrader(week.podiums.TRADERS[0].you ? words.you : week.podiums.TRADERS[0].name, words.value("TRADERS", week.podiums.TRADERS[0].value))
                        : words.noTopTrader}
                    </span>
                  ) : null}
                </span>
              );
              if (week.state === "AHEAD" || !week.podiums) {
                return <li key={week.start} className={styles.week} data-state={week.state}>{head}</li>;
              }
              return (
                <li key={week.start} className={styles.week} data-state={week.state}>
                  <details className={styles.weekDetails} open={week.state === "LIVE"}>
                    <summary className={styles.weekSummary}>{head}</summary>
                    <div className={styles.podiums} data-count={boards.length}>
                      {boards.map((board) => (
                        <div key={board} className={styles.podium}>
                          <h3 className={styles.eyebrow}>{words.board[board]}</h3>
                          {week.podiums![board].length === 0 ? (
                            <span className={styles.weekDates}>{week.state === "ENDED" ? words.nobodyEnded : words.nobody}</span>
                          ) : (
                            <ol className={styles.podiumList}>
                              {week.podiums![board].map((row) => (
                                <li key={row.place} className={styles.podiumRow} data-you={row.you ? "true" : "false"}>
                                  <span className={styles.place} translate="no">
                                    <span className={styles.srOnly}>{words.placeAloud}</span>
                                    {row.place}
                                  </span>
                                  <FaceAvatar face={row.face} rank={row.rank} size={24} />
                                  <span className={styles.name} translate="no">{row.you ? words.you : row.name}</span>
                                  <span className={styles.value} data-sign={board === "TRADERS" ? (row.value > 0 ? "pos" : row.value < 0 ? "neg" : undefined) : undefined} translate="no">
                                    {words.value(board, row.value)}
                                  </span>
                                </li>
                              ))}
                            </ol>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
          {data.current && data.current > 1 ? (
            <nav className={styles.seasonLinks} aria-label={words.otherSeasons}>
              {Array.from({ length: data.current }, (_, index) => index + 1).map((number) => (
                <Link key={number} className={styles.link} href={`/app/rewards/season/${number}`} aria-current={number === season.number ? "page" : undefined}>
                  {words.seasonTitle(number)}
                </Link>
              ))}
            </nav>
          ) : null}
        </section>
      </div>

      <details className={`${styles.panel} ${styles.rules}`}>
        <summary>{words.seasonRulesTitle}</summary>
        <ul className={styles.rulesBody}>
          {words.seasonRules.map((rule) => <li key={rule}>{rule}</li>)}
        </ul>
      </details>
    </div>
  );
}
