"use client";

import { useEffect, useState } from "react";

import { CARD_MOMENTS, postMoments, type PostMoment } from "@/lib/mission-control/scene";
import { SCENE_SNAPSHOT_EVENT, type SceneSnapshot } from "@/lib/mission-control/types";

import { StarSky } from "@/app/components/mission-control/star-sky";
import { WindowClock } from "@/app/components/mission-control/window-clock";

import styles from "./mission-post.module.css";

const LABEL: Record<string, string> = {
  launch: "Liftoff",
  crew: "Crew",
  booster25: "25%",
  booster50: "50%",
  booster75: "75%",
  orbit: "Orbit",
  day7: "Day 7",
  day30: "Day 30",
  day90: "Day 90",
};

/**
 * «Post to X» in the Control Room: the moments the mission truly reached, each with its card (1200 × 675) and X's web
 * intent. The person posts; Ryntra never posts for them and never rewards a post (X's rules since 15.01.2026).
 * `initial` is the server's read when it answered in time; every live snapshot of the room (`SCENE_SNAPSHOT_EVENT`)
 * brings the mission's moments as the chain has them now — so a cold page whose server read was late still gets them.
 */
export function MissionPost({ mint, initial }: { mint: string; initial: readonly PostMoment[] }) {
  const [moments, setMoments] = useState<readonly PostMoment[]>(initial);
  const [open, setOpen] = useState(false);
  /* The moment the person picked, by name — the list may grow around it; null: the newest. */
  const [chosen, setChosen] = useState<PostMoment["moment"] | null>(null);
  const [unread, setUnread] = useState<string | null>(null);

  useEffect(() => {
    const scene = document.querySelector('[data-scene="control-room"]');
    if (!scene) return;
    const onSnapshot = (event: Event) => {
      const mission = (event as CustomEvent<SceneSnapshot>).detail.missions.find((item) => item.id === mint);
      if (!mission) return;
      /* A moment once reached stays reached (a passed check cannot un-pass): a snapshot whose survival read was late
         never takes a tab away — the list only grows, in the moments' own order. */
      const fresh = postMoments(mission);
      setMoments((now) => {
        const known = new Set(now.map((post) => post.moment));
        if (fresh.every((post) => known.has(post.moment))) return now;
        const all = [...now, ...fresh.filter((post) => !known.has(post.moment))];
        return CARD_MOMENTS.flatMap((moment) => all.filter((post) => post.moment === moment).slice(0, 1));
      });
    };
    scene.addEventListener(SCENE_SNAPSHOT_EVENT, onSnapshot);
    return () => scene.removeEventListener(SCENE_SNAPSHOT_EVENT, onSnapshot);
  }, [mint]);

  const current = moments.find((post) => post.moment === chosen) ?? moments[moments.length - 1];
  /* MC-2: the launch windows' clock stands in the same corner, above the post — the room counts down with the schedule. */
  if (!current) {
    return (
      <div className={styles.post}>
        <WindowClock variant="room" />
        <div className={styles.liveOnly} data-when="live">
          <StarSky scene="control-room" variant="room" />
        </div>
      </div>
    );
  }
  return (
    <div className={styles.post}>
      <WindowClock variant="room" />
      <div className={styles.liveOnly} data-when="live">
      <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Post to X
      </button>
      {open ? (
        <div className={styles.sheet} role="dialog" aria-label="Post this mission's moment to X">
          <div className={styles.tabs}>
            {moments.map((item) => (
              <button key={item.moment} type="button" aria-pressed={item.moment === current.moment} className={styles.tab} onClick={() => setChosen(item.moment)}>
                {LABEL[item.moment] ?? item.moment}
              </button>
            ))}
          </div>
          {/* The card is drawn on the server from the chain; a plain <img> — it is a PNG from this origin. */}
          {unread === current.card ? (
            <p className={styles.unread}>The card could not be drawn from the chain just now — the post still links to the mission.</p>
          ) : (
            /* Under the card, until it arrives: a cold card waits for its read of the chain. */
            <div className={styles.cardWrap}>
              <span className={styles.cardWait}>Drawing the card from the chain…</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.card} src={current.card} alt={`${LABEL[current.moment] ?? current.moment} card`} width={1200} height={675} onError={() => setUnread(current.card)} />
            </div>
          )}
          <a className={styles.intent} href={current.intent} target="_blank" rel="noopener noreferrer">
            Open X to post
          </a>
        </div>
      ) : null}
      {/* MC-3: the Day 90 sky with its crews' names, from the room's own live snapshots. */}
      <StarSky scene="control-room" variant="room" />
      </div>
    </div>
  );
}
