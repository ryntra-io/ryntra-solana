"use client";

import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import type { CardFace } from "@/lib/growth/card-face";
import { CARD, INTRO_MS, STILL, drawCardScene, type SceneAssets, type SceneFonts } from "@/lib/growth/card-scene";

import { loadSceneAssets, sceneFonts } from "./card-motion";
import styles from "./live-card.module.css";

/**
 * The trade card, alive: it enters once — the figure counted to the
 * receipts' result, the bars of entry and exit, the QR, a band of light — and
 * after that only its emotion moves, for a while, then the card holds still.
 * On a desk it leans toward the pointer with a soft sheen. With reduced
 * motion it is the still: the same frame the picture for X shows.
 *
 * It is a canvas; the card's words reach a screen reader as the poster's alt
 * or as a line beside it. A `poster` (the still picture) stands in its place
 * until the canvas can draw — on the invitation page, where people arrive
 * from X on a slow phone, the card is never an empty box.
 */

/** Frames of the emotion after the entrance: enough to live, cheap enough to leave running. */
const REST_FPS = 30;
/** How long the emotion lives after the entrance before the card holds still — a phone's battery is the person's. */
const REST_MS = 15_000;

export type LiveCardHandle = Readonly<{ assets: SceneAssets; fonts: SceneFonts }>;

export function LiveCard({
  face,
  replayLabel,
  onReady,
  className,
  poster,
}: Readonly<{ face: CardFace; replayLabel: string; onReady?: (handle: LiveCardHandle) => void; className?: string; poster?: string }>) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const replayRef = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false);
  const [still, setStill] = useState(false);
  const [played, setPlayed] = useState(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    let live = true;
    let frame = 0;
    let visible = true;
    let running = false;
    let start = 0;
    let last = 0;
    let lastDrawn = 0;
    let handle: LiveCardHandle | null = null;
    const element = canvas.current;
    const box = wrap.current;
    if (!element || !box) return undefined;
    const ctx = element.getContext("2d");
    if (!ctx) return undefined;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motion.matches;
    setStill(reduced);

    const fit = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(box.clientWidth * ratio));
      const height = Math.round((width * CARD.height) / CARD.width);
      if (element.width !== width || element.height !== height) {
        element.width = width;
        element.height = height;
      }
      ctx.setTransform(width / CARD.width, 0, 0, width / CARD.width, 0, 0);
    };

    const draw = (t: number) => {
      if (!handle) return;
      fit();
      drawCardScene(ctx, face, handle.assets, handle.fonts, t);
    };

    const tick = (now: number) => {
      if (!live) return;
      /* Off screen the loop lets go; the clock resumes where it stopped when the card comes back into view. */
      if (!visible) {
        running = false;
        return;
      }
      last = now;
      const t = now - start;
      if (t > INTRO_MS + REST_MS) {
        running = false;
        setPlayed(true);
        return;
      }
      frame = requestAnimationFrame(tick);
      /* After the entrance only the emotion moves: fewer frames are plenty. */
      if (t > INTRO_MS && now - lastDrawn < 1_000 / REST_FPS) return;
      lastDrawn = now;
      draw(t);
      if (t > INTRO_MS) setPlayed(true);
    };

    const play = () => {
      if (!handle || reduced) return;
      start = performance.now();
      last = start;
      setPlayed(false);
      if (!running) {
        running = true;
        frame = requestAnimationFrame(tick);
      }
    };
    replayRef.current = play;

    const observer = new IntersectionObserver(([entry]) => {
      const was = visible;
      visible = entry?.isIntersecting ?? true;
      /* Back in view mid-show: the time away is not counted, and the loop picks up. */
      if (visible && !was && handle && !reduced && !running && last - start <= INTRO_MS + REST_MS) {
        const now = performance.now();
        start += now - last;
        last = now;
        running = true;
        frame = requestAnimationFrame(tick);
      }
    });
    observer.observe(box);
    const resize = new ResizeObserver(() => {
      if (reduced || !running) draw(reduced ? STILL : Math.max(0, last - start));
    });
    resize.observe(box);
    /* A person who turns motion off while the card is open gets the still at once. */
    const onMotion = () => {
      reduced = motion.matches;
      setStill(reduced);
      if (reduced) {
        cancelAnimationFrame(frame);
        running = false;
        draw(STILL);
      } else {
        play();
      }
    };
    motion.addEventListener("change", onMotion);

    void (async () => {
      const [assets, fonts] = await Promise.all([loadSceneAssets(face), sceneFonts(face)]);
      if (!live || !assets) return;
      handle = { assets, fonts };
      onReadyRef.current?.(handle);
      draw(reduced ? STILL : 0);
      setReady(true);
      play();
    })();

    return () => {
      live = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      motion.removeEventListener("change", onMotion);
    };
  }, [face]);

  /* The lean and the sheen follow a mouse, never a finger, and never with reduced motion. */
  const lean = (event: React.PointerEvent<HTMLDivElement>) => {
    if (still || event.pointerType !== "mouse" || !wrap.current) return;
    const rect = wrap.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    wrap.current.style.setProperty("--lean-x", `${((0.5 - y) * 7).toFixed(2)}deg`);
    wrap.current.style.setProperty("--lean-y", `${((x - 0.5) * 9).toFixed(2)}deg`);
    wrap.current.style.setProperty("--glare-x", `${(x * 100).toFixed(1)}%`);
    wrap.current.style.setProperty("--glare-y", `${(y * 100).toFixed(1)}%`);
    wrap.current.dataset.leaning = "";
  };
  const rest = () => {
    if (!wrap.current) return;
    delete wrap.current.dataset.leaning;
    wrap.current.style.removeProperty("--lean-x");
    wrap.current.style.removeProperty("--lean-y");
  };

  /* Once it has played, a tap or a click on the card plays it again — no button beside it, nothing that moves the sheet. */
  const again = ready && !still && played;
  return (
    <div className={`${styles.stage}${className ? ` ${className}` : ""}`}>
      <div
        ref={wrap}
        className={styles.card}
        data-ready={ready || undefined}
        data-again={again || undefined}
        onPointerMove={lean}
        onPointerLeave={rest}
        onClick={again ? () => replayRef.current() : undefined}
        onKeyDown={
          again
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  replayRef.current();
                }
              }
            : undefined
        }
        role={again ? "button" : undefined}
        tabIndex={again ? 0 : undefined}
        aria-label={again ? replayLabel : undefined}
        title={again ? replayLabel : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {poster ? <img className={styles.poster} src={poster} width={CARD.width} height={CARD.height} alt={again ? "" : face.alt} /> : null}
        <canvas ref={canvas} className={styles.canvas} aria-hidden="true" width={CARD.width} height={CARD.height} />
        <span className={styles.glare} aria-hidden="true" />
        {again ? (
          <span className={styles.again} aria-hidden="true">
            <ArrowCounterClockwise size={14} weight="bold" />
          </span>
        ) : null}
      </div>
      {/* The card's words for a screen reader, beside the canvas rather than inside the button. */}
      {!poster || again ? <p className={styles.alt}>{face.alt}</p> : null}
    </div>
  );
}
