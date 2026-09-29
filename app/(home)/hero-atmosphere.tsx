"use client";

import { useEffect, useRef } from "react";
import styles from "./hero.module.css";

/**
 * The hero's light, painted by the page.
 *
 * What the render's landscape gave the top of the site — one great orange
 * arc across the upper left, a warm horizon behind the product, dust in the
 * dark — is drawn here in gradients so that it is the same fabric as the
 * blocks below: the arc is the first of the orange trajectories the universe
 * continues, the dust is the universe's and the rewards' dust, the horizon
 * is the ember that returns under the last button. No picture, so nothing to
 * scale, and nothing to fall out of step with the page's own colours.
 *
 * The light breathes on long clocks, and only while the hero is on screen;
 * under `prefers-reduced-motion` it stands still. The script marks the
 * section it lives in — `data-js` so the reveal applies, `data-active`
 * while any of it is visible — and does nothing else.
 */

/* Distant light points, placed once from a seed so the sky is the same on
   every visit and every render. */
function motes(count: number): readonly Readonly<{ x: number; y: number; size: number; delay: number; dim: boolean }>[] {
  let seed = 7;
  const next = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const out = [];
  for (let i = 0; i < count; i++) out.push({ x: next() * 100, y: 4 + next() * 80, size: 1 + Math.round(next() * 1.6), delay: Math.round(next() * 9000), dim: next() < 0.55 });
  return out;
}
const MOTES = motes(36);

export function HeroAtmosphere() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const backdrop = ref.current;
    const section = backdrop?.closest("section");
    if (!backdrop || !section) return;
    section.dataset.js = "";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) section.dataset.active = "";
        else delete section.dataset.active;
      }
    }, { threshold: 0 });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={styles.backdrop} aria-hidden="true">
      <span className={styles.arcField}>
        <span className={styles.arc} />
      </span>
      <span className={styles.horizon} />
      <span className={styles.dust}>
        {MOTES.map((m, i) => (
          <span
            key={i}
            className={styles.mote}
            data-dim={m.dim || undefined}
            style={{ left: `${m.x.toFixed(2)}%`, top: `${m.y.toFixed(2)}%`, width: m.size, height: m.size, animationDelay: `${m.delay}ms` }}
          />
        ))}
      </span>
    </div>
  );
}
