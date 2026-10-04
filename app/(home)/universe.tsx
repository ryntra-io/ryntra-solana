"use client";

import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";
import { useEffect, useRef, type CSSProperties } from "react";
import type { PublicLocale } from "@/lib/site/locale";
import { HOMEPAGE_COPY } from "@/lib/site/homepage-copy";
import { localizedPath } from "@/lib/site/localized";
import manifest from "./universe-assets.json";
import styles from "./universe.module.css";

/**
 * The market universe — the second block of the landing.
 *
 * Solana at the centre, the assets that trade on Spot in orbit around it:
 * eight tokenized stocks on the two inner rings, SOL with them, and Jupiter,
 * USDC and the two memes on the outer one. The brief of 2026-09-13:
 * a cinematic 3D market universe, not a schematic — a large graphite core
 * with the real Solana mark, orange only as light and trajectories, large
 * recognisable logos, true depth, slow continuous motion, parallax to the
 * pointer, a tooltip on hover — and it must read as *stocks on Solana*
 * without a word.
 *
 * It is built in CSS 3D rather than WebGL: three rings are circles in one
 * tilted plane, so perspective draws them as ellipses whose far arcs pass
 * behind the core and near arcs in front; each asset rides its ring on a
 * slow rotation and counter-rotates to keep facing the reader, with a
 * depth pass that shrinks and softens it on the far side. The three
 * animations share one clock (the same duration and the same negative delay
 * per asset), so they never drift apart. A hovered asset comes toward the
 * reader, glows, slows its own orbit — through the Web Animations API, so
 * the change of speed has no jump — and shows a small tooltip. Nothing here
 * spins fast; nothing needs a library.
 *
 * Every asset is a real market: the token is a link into Spot on its mint,
 * and the picture is the token's own metadata image copied to this site by
 * scripts/site/fetch-universe-icons.mjs. The brand hue that lights each logo
 * comes with it from the manifest — the logo's own colour, not a palette of
 * ours.
 *
 * The scene pauses while it is off screen, reveals itself once as it scrolls
 * into view, and stands still under `prefers-reduced-motion`.
 */

type Asset = Readonly<{
  symbol: string;
  name: string;
  kind: "stock" | "crypto" | "meme";
  mint: string;
  icon: string;
  glow: string;
  ring: 1 | 2 | 3;
  phase: number;
}>;

const ASSETS = manifest.assets as readonly Asset[];

/* Orbit periods in seconds — slow, and different, so the rings never align
   for long. The second ring runs the other way. */
const RINGS = [
  { id: 1, period: 84, reverse: false },
  { id: 2, period: 126, reverse: true },
  { id: 3, period: 168, reverse: false },
] as const;

/* Distant light points, placed once from a seed so the sky is the same on
   every visit and every render. */
function particles(count: number): readonly Readonly<{ x: number; y: number; size: number; delay: number; dim: boolean }>[] {
  let seed = 19;
  const next = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ x: next() * 100, y: next() * 100, size: 1 + Math.round(next() * 2), delay: Math.round(next() * 9000), dim: next() < 0.5 });
  }
  return out;
}
const PARTICLES = particles(42);

export function Universe({ locale }: { locale: PublicLocale }) {
  const c = HOMEPAGE_COPY[locale];
  const u = c.universe;
  const section = useRef<HTMLElement | null>(null);
  const scene = useRef<HTMLDivElement | null>(null);
  const tip = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const root = section.current;
    const stage = scene.current;
    if (!root || !stage) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    /* The script has the section: from here the reveal and the pause apply.
       Under reduced motion there is nothing to reveal — it is simply there. */
    root.dataset.js = "";
    if (reduced.matches) root.dataset.seen = "";

    /* Reveal once, and run only while some of it is on screen. */
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.intersectionRatio >= 0.22 && !("seen" in root.dataset)) root.dataset.seen = "";
        if (entry.isIntersecting) root.dataset.active = "";
        else delete root.dataset.active;
      }
    }, { threshold: [0, 0.22] });
    observer.observe(root);

    /* The camera follows the pointer a little. */
    let frame = 0;
    let target = { x: 0, y: 0 };
    const apply = () => {
      frame = 0;
      root.style.setProperty("--px", target.x.toFixed(3));
      root.style.setProperty("--py", target.y.toFixed(3));
    };
    const onMove = (event: PointerEvent) => {
      if (reduced.matches || event.pointerType !== "mouse") return;
      const box = stage.getBoundingClientRect();
      target = { x: ((event.clientX - box.left) / box.width - 0.5) * 2, y: ((event.clientY - box.top) / box.height - 0.5) * 2 };
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      target = { x: 0, y: 0 };
      if (!frame) frame = requestAnimationFrame(apply);
    };
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerleave", onLeave);

    /* A hovered asset slows its own orbit — a change of playback rate, which
       the browser eases, never a restart — and the tooltip follows it. The
       tooltip lives outside the 3D scene so no nearer token can cover it. */
    const label = tip.current;
    let follow = 0;
    let followed: HTMLElement | null = null;
    const place = () => {
      follow = 0;
      if (!followed || !label) return;
      const box = followed.getBoundingClientRect();
      const home = root.getBoundingClientRect();
      label.style.left = `${(box.left + box.width / 2 - home.left).toFixed(1)}px`;
      label.style.top = `${(box.bottom - home.top + 10).toFixed(1)}px`;
      follow = requestAnimationFrame(place);
    };
    const slow = (event: Event) => {
      const token = event.currentTarget as HTMLElement;
      const orbiter = token.closest<HTMLElement>(`.${styles.orbiter}`);
      if (!orbiter) return;
      for (const animation of orbiter.getAnimations({ subtree: true })) animation.updatePlaybackRate(0.3);
      if (label) {
        label.textContent = token.dataset.label ?? "";
        label.dataset.show = "";
        followed = token;
        if (!follow) follow = requestAnimationFrame(place);
      }
    };
    const restore = (event: Event) => {
      const orbiter = (event.currentTarget as HTMLElement).closest<HTMLElement>(`.${styles.orbiter}`);
      if (!orbiter) return;
      for (const animation of orbiter.getAnimations({ subtree: true })) animation.updatePlaybackRate(1);
      if (label) delete label.dataset.show;
      followed = null;
      if (follow) { cancelAnimationFrame(follow); follow = 0; }
    };
    const tokens = Array.from(stage.querySelectorAll<HTMLElement>(`.${styles.token}`));
    for (const token of tokens) {
      token.addEventListener("pointerenter", slow);
      token.addEventListener("pointerleave", restore);
      token.addEventListener("focus", slow);
      token.addEventListener("blur", restore);
    }

    return () => {
      observer.disconnect();
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerleave", onLeave);
      for (const token of tokens) {
        token.removeEventListener("pointerenter", slow);
        token.removeEventListener("pointerleave", restore);
        token.removeEventListener("focus", slow);
        token.removeEventListener("blur", restore);
      }
      if (frame) cancelAnimationFrame(frame);
      if (follow) cancelAnimationFrame(follow);
    };
  }, []);

  return (
    <section ref={section} className={styles.universe} aria-labelledby="universe-title">
      <div className={styles.backdrop} aria-hidden="true">
        <span className={styles.warm} />
        <span className={styles.cool} />
        <span className={styles.sky}>
          {PARTICLES.map((p, i) => (
            <span
              key={i}
              className={styles.particle}
              data-dim={p.dim || undefined}
              style={{ left: `${p.x.toFixed(2)}%`, top: `${p.y.toFixed(2)}%`, width: p.size, height: p.size, animationDelay: `${p.delay}ms` }}
            />
          ))}
        </span>
      </div>

      <div className={styles.head}>
        <p className={styles.eyebrow}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the network's mark, an SVG served as it is */}
          <img src="/site/solana-mark.svg" alt="" width={20} height={16} />
          {u.eyebrow}
        </p>
        <h2 id="universe-title" className={styles.title}>
          {u.titleLines.map((line, index) => <span key={line}>{index > 0 ? " " : null}{line}</span>)}
        </h2>
        <p className={styles.lead}>{u.lead}</p>
        <Link className={styles.explore} href={localizedPath("/app/markets", locale)} prefetch={false}>
          {u.explore}
          <ArrowRight size={18} weight="bold" aria-hidden />
        </Link>
      </div>

      <div ref={scene} className={styles.scene}>
        <div className={styles.world}>
          <span className={styles.floor} aria-hidden="true" />

          {RINGS.map((ring) => (
            <span key={ring.id} className={styles.ringLine} data-ring={ring.id} aria-hidden="true">
              <span className={styles.ringStreak} data-reverse={ring.reverse || undefined} />
            </span>
          ))}

          <div className={styles.core} aria-hidden="true">
            <span className={styles.coreBand} />
            <span className={styles.coreSheen} />
            {/* eslint-disable-next-line @next/next/no-img-element -- the network's mark, an SVG served as it is */}
            <img className={styles.coreMark} src="/site/solana-mark.svg" alt="" width={397} height={311} />
            <span className={styles.coreRim} />
          </div>

          {RINGS.map((ring) => (
            <ul key={ring.id} className={styles.ring} data-ring={ring.id} data-reverse={ring.reverse || undefined} aria-label={ring.id === 1 ? u.sceneLabel : undefined}>
              {ASSETS.filter((asset) => asset.ring === ring.id).map((asset) => {
                const label = `${asset.name} · ${asset.symbol} · ${u.kinds[asset.kind]}`;
                /* A company opens on its own page — the purchase from $1 lives
                   there; a coin opens where coins trade, in Spot. */
                const company = asset.kind === "stock";
                return (
                  <li
                    key={asset.symbol}
                    className={styles.orbiter}
                    style={{ "--phase": asset.phase, "--period": `${ring.period}s` } as CSSProperties}
                  >
                    <Link
                      className={styles.token}
                      href={company ? localizedPath(`/app/stocks/${asset.symbol}`, locale) : `/app/spot?mint=${asset.mint}`}
                      prefetch={false}
                      aria-label={`${label} — ${company ? u.openCompany : u.open}`}
                      data-label={label}
                      style={{ "--glow": asset.glow } as CSSProperties}
                    >
                      <span className={styles.tokenEnter}>
                        <span className={styles.tokenBody}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- the token's own metadata image, served from this site */}
                          <img src={`/site/universe/${asset.icon}`} alt="" width={320} height={320} loading="lazy" decoding="async" />
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ))}
        </div>
      </div>
      <span ref={tip} className={styles.tip} aria-hidden="true" />
    </section>
  );
}
