"use client";

import { useEffect, useRef, type ReactNode } from "react";

import "./stage.css";
import { startLiveFeed, type LiveState } from "@/lib/mission-control/live";
import { ENGINE_DEFAULTS, rememberSnapshot, SCENE_SNAPSHOT_EVENT, type MountScene, type SceneEngine } from "@/lib/mission-control/types";

export type SceneName = "orbit" | "control-room" | "launch-night";

/* The whole viewport (a scene page), or the first screen of a page that goes on below it (the home page). */
const VIEWPORT = { position: "fixed", inset: 0, overflow: "hidden", background: "#04070B", color: "#F5F7FA" } as const;
const SCREEN = { position: "relative", height: "100svh", minHeight: 560, overflow: "clip", background: "#04070B", color: "#F5F7FA" } as const;

/** How long a scene waits for the chain's first answer before it plays its own show. */
const AUTOPLAY_AFTER_MS = 8_000;

/* Each renderer is loaded after the page's words are on screen: three.js never sits in the first paint. */
const RENDERERS: Record<SceneName, () => Promise<{ mount: MountScene }>> = {
  orbit: () => import("@/lib/mission-control/engines/orbit.js"),
  "control-room": () => import("@/lib/mission-control/engines/control-room.js"),
  "launch-night": () => import("@/lib/mission-control/engines/launch-night.js"),
};

/**
 * One Mission Control scene filling the viewport: the renderer draws, the live feed reads Ryntra's Launch API, and
 * the root's `data-*` say what is on screen — the source (live or DEMO), the renderer (WebGL or the 2D board), the
 * quality tier, the live read's state — for the page's own marks and for the eyes' checks.
 */
export function MissionStage({ scene, focus, className, children, screen = false }: { scene: SceneName; focus?: string; className?: string; children?: ReactNode; screen?: boolean }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let engine: SceneEngine | null = null;
    let feed: ReturnType<typeof startLiveFeed> | null = null;
    let disposed = false;
    let autoplay: ReturnType<typeof setTimeout> | null = null;
    /* The show starts on its own once: the person's own «Back to live» is never overridden. */
    let showStarted = false;
    /* The show the scene started itself (not a person's tap) gives way to a live sky that turns out to be flying. */
    let showIsAuto = false;
    let haveSnapshot = false;
    let drawing: "live" | "demo" = "live";
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mark = (key: string, value: string) => element.setAttribute(`data-${key}`, value);
    /* «Live» is said only once the chain has answered; until then the page's words stay neutral. */
    const markSource = () => mark("source", drawing === "demo" ? "demo" : haveSnapshot ? "live" : "pending");
    const startShow = () => {
      if (showStarted || disposed || !engine || reducedMotion) return;
      showStarted = true;
      showIsAuto = true;
      engine.playDemo();
    };

    void RENDERERS[scene]().then(({ mount }) => {
      if (disposed) return;
      const live = mount(element, {
        reducedMotion,
        minFps: ENGINE_DEFAULTS.minFps,
        maxPixelRatio: ENGINE_DEFAULTS.maxPixelRatio,
        focusId: focus,
        onSource: (source) => {
          drawing = source;
          if (source === "demo") showStarted = true;
          /* Back to live ends the scene's own show: whatever plays next is the person's. */
          if (source === "live") showIsAuto = false;
          markSource();
        },
        onRenderer: (kind) => mark("renderer", kind),
        onQuality: (quality, fps) => {
          mark("quality", quality);
          mark("fps", String(Math.round(fps)));
        },
      });
      engine = live;
      /* Nobody hunts for the show: when the live sky has no mission in flight — or the chain
         has not answered in AUTOPLAY_AFTER_MS — the scene plays its own show, marked DEMO, with «Back to live» beside it.
         A sky with missions in flight is the show itself. Reduced motion: nothing starts on its own. */
      autoplay = setTimeout(() => {
        if (!haveSnapshot) startShow();
      }, AUTOPLAY_AFTER_MS);
      /* The feed starts once the renderer is there, so the opening history reaches the log. */
      feed = startLiveFeed({
        focus,
        onSnapshot: (snapshot) => {
          const first = !haveSnapshot;
          haveSnapshot = true;
          markSource();
          live.setSnapshot(snapshot);
          /* The page's own parts (the Control Room's «Post to X») read the same snapshot instead of reading the chain again. */
          rememberSnapshot(element, snapshot);
          element.dispatchEvent(new CustomEvent(SCENE_SNAPSHOT_EVENT, { detail: snapshot }));
          /* A Control Room whose mission is on the sky shows that mission — never someone else's simulated one. */
          const flying = snapshot.missions.some((mission) => mission.phase === "ascent");
          const ownMissionHere = focus !== undefined && snapshot.missions.some((mission) => mission.id === focus);
          if (first && showIsAuto && drawing === "demo" && (flying || ownMissionHere)) live.stopDemo();
          else if (first && !flying && !ownMissionHere) startShow();
        },
        onEvents: (events) => events.forEach((event) => live.emit(event)),
        onState: (state: LiveState) => {
          mark("live", state);
          if (state === "unavailable") startShow();
        },
      });
    });

    return () => {
      disposed = true;
      if (autoplay) clearTimeout(autoplay);
      feed?.stop();
      engine?.dispose();
    };
  }, [scene, focus]);

  return (
    <div ref={root} className={className} data-scene={scene} data-source="pending" data-live="reading" style={screen ? SCREEN : VIEWPORT}>
      {children}
      {/* A read that failed or came back incomplete is said, never drawn over as live. */}
      <p className="mc-read-state" role="status" data-read="stale">
        <span className="mc-read-long">The chain answered only in part — some numbers may be old.</span>
        <span className="mc-read-short">Partial read — some numbers may be old.</span>
      </p>
      <p className="mc-read-state" role="status" data-read="unavailable">
        <span className="mc-read-long">The chain could not be read just now — trying again.</span>
        <span className="mc-read-short">No read just now — trying again.</span>
      </p>
    </div>
  );
}
