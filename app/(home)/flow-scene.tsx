"use client";

import { useEffect, useState } from "react";

import type { PublicCopy } from "@/lib/site/public-copy";

import styles from "./landing.module.css";

/*
 * Scene 4 — the decision loop as a scene rather than a caption.
 *
 * Seven stages on one rail. A slow clock walks the highlight; hovering,
 * focusing or clicking a stage takes the clock's place and shows that stage's
 * one sentence — never a paragraph. The last stage seals with a check.
 * Reduced motion stops the clock; the stages stay clickable.
 */

const STEP_MS = 2800;

export function FlowScene({ copy }: { readonly copy: PublicCopy }) {
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (reduced || held) return;
    const timer = window.setInterval(() => {
      setActive((index) => (index + 1) % copy.flowSteps.length);
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, [reduced, held, copy.flowSteps.length]);

  const last = copy.flowSteps.length - 1;

  return (
    <div
      onMouseLeave={() => setHeld(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false);
      }}
    >
      <ol className={styles.flowScene} role="group" aria-label={copy.flowLabel}>
        {copy.flowSteps.map((step, index) => (
          <li key={step} className={styles.flowSceneItem}>
            <button
              type="button"
              className={`${styles.flowCard} ${index === active ? styles.flowCardOn : ""}`}
              aria-pressed={index === active}
              onClick={() => {
                setActive(index);
                setHeld(true);
              }}
              onMouseEnter={() => {
                setActive(index);
                setHeld(true);
              }}
              onFocus={() => {
                setActive(index);
                setHeld(true);
              }}
            >
              <span className={styles.flowNum}>{String(index + 1).padStart(2, "0")}</span>
              <span className={styles.flowName}>
                {index === last && index === active ? (
                  <span className={styles.toneOk} aria-hidden="true">
                    ✓{" "}
                  </span>
                ) : null}
                {step}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <p className={styles.flowNote} aria-live="polite">
        {copy.flowNotes[active]}
      </p>
    </div>
  );
}
