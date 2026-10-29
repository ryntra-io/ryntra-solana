"use client";

import { useEffect, useState } from "react";

import { launchedIn, nextWindow, tMinus, windowClock, windowOpenAt, type LaunchWindow } from "@/lib/core/launch/windows";
import { SCENE_SNAPSHOT_EVENT, type SceneSnapshot } from "@/lib/mission-control/types";

import styles from "./window-clock.module.css";

/**
 * The launch windows' clock (MC-2): the next window and the time to it, or the one open now, the time it has left and
 * the missions whose creation landed in it — counted from the scene's own live snapshot, never assumed. The schedule
 * is published (`lib/core/launch/windows.ts`): a countdown to an event of the scene, never a timer to a purchase.
 * Drawn after mount only — the server's clock is not the person's.
 */
export function WindowClock({ variant = "hero" }: { variant?: "hero" | "room" | "night" }) {
  /* The Control Room's and Launch Night's own DEMO shows count down to their simulated windows: there the real clock
     stands only beside the live sky, never beside a simulated countdown. The home page's says it in both. */
  const when = variant === "hero" ? undefined : "live";
  const [now, setNow] = useState<number | null>(null);
  const [missions, setMissions] = useState<SceneSnapshot["missions"] | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const scene = document.querySelector("[data-scene]");
    const onSnapshot = (event: Event) => setMissions((event as CustomEvent<SceneSnapshot>).detail.missions);
    scene?.addEventListener(SCENE_SNAPSHOT_EVENT, onSnapshot);
    return () => {
      window.clearInterval(tick);
      scene?.removeEventListener(SCENE_SNAPSHOT_EVENT, onSnapshot);
    };
  }, []);

  if (now === null) return <p className={`${styles.clock} ${styles[variant]}`} aria-hidden="true" data-window="pending" data-when={when} />;
  const open = windowOpenAt(now);
  const next: LaunchWindow = nextWindow(now);
  /* «EVENING» is the desk's word; a phone keeps the line short: «NEXT WINDOW · 20:00 UTC». */
  const kind = (window: LaunchWindow) => (
    <>
      {window.kind === "evening" ? <span className={styles.kind}>EVENING </span> : null}WINDOW
    </>
  );
  if (open) {
    const count = missions ? launchedIn(open, missions).length : null;
    return (
      <p className={`${styles.clock} ${styles[variant]} ${styles.open}`} data-window="open" data-when={when} aria-live="off">
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.label}>
          {kind(open)} {windowClock(open)} · OPEN
        </span>
        <span className={styles.value}>{tMinus(open.closesAt - now).replace("T-", "")} left</span>
        {count !== null ? <span className={styles.count}>{count === 1 ? "1 mission lifted off" : `${count} missions lifted off`}</span> : null}
      </p>
    );
  }
  return (
    <p className={`${styles.clock} ${styles[variant]}`} data-window="next" data-when={when} aria-live="off">
      <span className={styles.label}>
        NEXT {kind(next)} · {windowClock(next)}
      </span>
      <span className={styles.value}>{tMinus(next.opensAt - now)}</span>
    </p>
  );
}
