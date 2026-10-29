"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { skyStars, type SkyStar } from "@/lib/mission-control/scene";
import { lastSnapshot, SCENE_SNAPSHOT_EVENT, type SceneSnapshot } from "@/lib/mission-control/types";

import styles from "./star-sky.module.css";

type Sky = Readonly<{ stars: readonly SkyStar[]; more: number }>;

/** The scene whose live snapshots the list reads: the home page's Orbit, or a Control Room. */
type SkyScene = "orbit" | "control-room";

const WORDS = {
  eyebrow: "DAY 90 SKY",
  title: "Every star is a mission that lived its 90 days.",
  lede: "A token that reached orbit and was still traded on day 90 by someone besides its creator and Ryntra stays in the sky for good, with its crew's names — the creator and the crew's wallets, as the chain pays them.",
  reading: "Reading the sky from the chain…",
  none: "No mission has lived its 90 days yet. The first one to do it lights the sky, with its crew's names.",
  more: (count: number) => `+ ${count} more star${count === 1 ? "" : "s"} in the sky`,
  test: "RYNTRA TEST",
  creator: "CREATOR",
  crew: (count: number) => `CREW OF ${count}`,
  toggle: (count: number | null) => (count === null ? "Day 90 sky" : `Day 90 sky · ${count}`),
} as const;

/** The live sky's stars from the scene's own snapshots (`SCENE_SNAPSHOT_EVENT`): no read of its own, never DEMO's. */
function useSky(scene: SkyScene): Sky | null {
  const [sky, setSky] = useState<Sky | null>(null);
  useEffect(() => {
    const root = document.querySelector(`[data-scene="${scene}"]`);
    if (!root) return;
    const take = (snapshot: SceneSnapshot | null) => {
      if (snapshot?.source === "live") setSky(skyStars(snapshot));
    };
    /* Mounted after the scene's first read: the snapshot it already carried, at once. */
    take(lastSnapshot(root));
    const onSnapshot = (event: Event) => take((event as CustomEvent<SceneSnapshot>).detail);
    root.addEventListener(SCENE_SNAPSHOT_EVENT, onSnapshot);
    return () => root.removeEventListener(SCENE_SNAPSHOT_EVENT, onSnapshot);
  }, [scene]);
  return sky;
}

function Stars({ sky }: { sky: Sky | null }) {
  if (!sky) return <p className={styles.state}>{WORDS.reading}</p>;
  if (!sky.stars.length && !sky.more) return <p className={styles.state}>{WORDS.none}</p>;
  return (
    <>
      <ul className={styles.stars}>
        {sky.stars.map((star) => (
          <li key={star.id} className={styles.star}>
            <span className={styles.glint} aria-hidden="true" />
            <span className={styles.body}>
              <span className={styles.top}>
                {star.href ? (
                  <Link className={styles.ticker} href={star.href}>
                    {star.ticker}
                  </Link>
                ) : (
                  <span className={styles.ticker}>{star.ticker}</span>
                )}
                <span className={styles.chip}>{star.ryntraTest ? WORDS.test : star.crew.length > 1 ? WORDS.crew(star.crew.length) : WORDS.creator}</span>
              </span>
              {star.name && star.name !== star.ticker.replace(/^\$/, "") ? <span className={styles.name}>{star.name}</span> : null}
              <span className={styles.crew}>{star.crew.join(" · ")}</span>
            </span>
          </li>
        ))}
      </ul>
      {sky.more ? <p className={styles.more}>{WORDS.more(sky.more)}</p> : null}
    </>
  );
}

/**
 * The Day 90 sky with its crews' names (MC-3), beside the scene that draws it: on the home page a section under the
 * acts, in a Control Room a button beside «Post to X». The names are the sky's own — the creator and the vault's rows
 * by short address; a handle nobody checked is never shown. Words only, no action of its own.
 */
export function StarSky({ scene, variant }: { scene: SkyScene; variant: "section" | "room" }) {
  const sky = useSky(scene);
  const [open, setOpen] = useState(false);
  if (variant === "room") {
    const count = sky ? sky.stars.length + sky.more : null;
    return (
      <div className={styles.room}>
        <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {WORDS.toggle(count)}
        </button>
        {open ? (
          <div className={styles.sheet} role="dialog" aria-label={WORDS.eyebrow}>
            <p className={styles.sheetHead}>{WORDS.title}</p>
            <Stars sky={sky} />
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className={styles.section} role="region" aria-labelledby="day90-sky-title">
      <p className={styles.eyebrow}>
        <i className={styles.dot} aria-hidden="true" />
        {WORDS.eyebrow}
      </p>
      <h3 id="day90-sky-title" className={styles.title}>
        {WORDS.title}
      </h3>
      <p className={styles.lede}>{WORDS.lede}</p>
      <Stars sky={sky} />
    </div>
  );
}
