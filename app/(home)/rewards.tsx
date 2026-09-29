"use client";

import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { PublicLocale } from "@/lib/site/locale";
import { HOMEPAGE_COPY } from "@/lib/site/homepage-copy";
import { homepageModel } from "@/lib/site/homepage-model";
import { localizedPath } from "@/lib/site/localized";
import { POINTS, REWARDS } from "./rewards-facts";
import styles from "./rewards.module.css";

/**
 * Ryntra Rewards and the close — the fourth and last block of the landing.
 *
 * The Owner's brief of 2026-09-14: the site is four screens and no more —
 * what Ryntra is, where it works, how it leads a trade, and why to stay and
 * open it. This block is the last of those: one rewards panel in the
 * centre, not ten cards — three segments for the three things the
 * programme pays for (a share of eligible service fees, points for
 * qualified activity, a share of what invited traders generate) — then the
 * closing line, one orange button, and the footer folded into the same
 * ground. Serious fintech, not a casino: no coins, no confetti, no promise
 * of income or of a token.
 *
 * What is real. The three rates are the programme's own
 * (rewards-facts.ts, held equal to `lib/rewards/model.ts` by test); the
 * points figure is an example, marked as one, whose level comes from the
 * live policy; the panel's chip is the Rewards page's readiness from the
 * route registry; the trust line says only what the product is — Solana
 * mainnet, non-custodial, markets that do not close. Every word is in
 * `HOMEPAGE_COPY`.
 *
 * How it moves. Once, as it scrolls into view: the words rise, the panel
 * lifts 24px, the ring draws to 50%, the points count up, the referral
 * levels light one after the other; the light behind the panel drifts
 * slowly and the button breathes — faintly, on a long clock. A hovered
 * segment brightens and lifts 3px. Off screen the light stands still, and
 * under `prefers-reduced-motion` everything is simply there.
 */

/* Distant light points, placed once from a seed so the ground is the same on
   every visit and every render. */
function particles(count: number): readonly Readonly<{ x: number; y: number; size: number; delay: number }>[] {
  let seed = 41;
  const next = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const out = [];
  for (let i = 0; i < count; i++) out.push({ x: 4 + next() * 92, y: 12 + next() * 60, size: 1 + Math.round(next() * 1.5), delay: Math.round(next() * 9000) });
  return out;
}
const PARTICLES = particles(28);

/* The ring: a circle of this radius, drawn from nothing to the fee share. */
const RING_RADIUS = 56;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

const format = (value: number) => value.toLocaleString("en-US");

export function Rewards({ locale }: { locale: PublicLocale }) {
  const c = HOMEPAGE_COPY[locale];
  const r = c.rewards;
  const status = homepageModel(locale).rewards;
  const section = useRef<HTMLElement | null>(null);
  const head = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  /* The figures render complete — for the reader without the script and
     for the search engine — and the script takes them back to nothing only
     once it knows it will count them up. */
  const [share, setShare] = useState<number>(REWARDS.feeSharePercent);
  const [points, setPoints] = useState<number>(POINTS.total);
  const [counted, setCounted] = useState(true);

  useEffect(() => {
    const root = section.current;
    const words = head.current;
    const board = panel.current;
    const foot = end.current;
    if (!root || !words || !board || !foot) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    root.dataset.js = "";

    /* The counters: from nothing to the figure, once, eased, on the same
       clock as the ring; under reduced motion the figures are simply there. */
    let frame = 0;
    const settle = () => {
      setShare(REWARDS.feeSharePercent);
      setPoints(POINTS.total);
      setCounted(true);
    };
    const count = () => {
      const start = performance.now();
      const length = 1500;
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / length);
        const eased = 1 - Math.pow(1 - t, 3);
        setShare(Math.round(REWARDS.feeSharePercent * eased));
        setPoints(Math.round(POINTS.total * eased));
        if (t < 1) frame = requestAnimationFrame(tick);
        else { frame = 0; settle(); }
      };
      frame = requestAnimationFrame(tick);
    };

    if (reduced.matches) {
      root.dataset.seen = "";
      root.dataset.counted = "";
      root.dataset.end = "";
      return;
    }
    /* The block is below the fold when this runs; nothing is seen to reset. */
    setShare(0);
    setPoints(0);
    setCounted(false);

    /* Reveal once, when half the head is on screen. */
    const seen = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.intersectionRatio >= 0.5) {
          root.dataset.seen = "";
          seen.disconnect();
        }
      }
    }, { threshold: [0, 0.5] });
    seen.observe(words);

    /* Count once, when a third of the panel is on screen — so the figures
       are seen arriving rather than already there. */
    const arrive = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.intersectionRatio >= 0.35) {
          root.dataset.counted = "";
          count();
          arrive.disconnect();
        }
      }
    }, { threshold: [0, 0.35] });
    arrive.observe(board);

    /* The close reveals on its own, when a third of it is on screen. */
    const closing = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.intersectionRatio >= 0.3) {
          root.dataset.end = "";
          closing.disconnect();
        }
      }
    }, { threshold: [0, 0.3] });
    closing.observe(foot);

    /* The light moves only while some of the block is on screen. */
    const active = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) root.dataset.active = "";
        else delete root.dataset.active;
      }
    }, { threshold: 0 });
    active.observe(root);

    return () => {
      seen.disconnect();
      arrive.disconnect();
      closing.disconnect();
      active.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const drawn = counted ? REWARDS.feeSharePercent / 100 : 0;

  return (
    <section ref={section} className={styles.rewards} aria-labelledby="rewards-title">
      <div className={styles.backdrop} aria-hidden="true">
        {/* The hero's arc, returned: one of the page's orange trajectories
            across the upper left, masked to that corner, so the last block
            stands in the same light as the first. */}
        <span className={styles.arcField}><span className={styles.trajectory} /></span>
        <span className={styles.bloom} />
        <span className={styles.rays} />
        <span className={styles.dust}>
          {PARTICLES.map((p, i) => (
            <span key={i} className={styles.mote} style={{ left: `${p.x.toFixed(2)}%`, top: `${p.y.toFixed(2)}%`, width: p.size, height: p.size, animationDelay: `${p.delay}ms` }} />
          ))}
        </span>
      </div>

      <div ref={head} className={styles.head}>
        <p className={styles.eyebrow}>{r.eyebrow}</p>
        <h2 id="rewards-title" className={styles.title}>
          <span>{r.titleLines[0]}</span>{" "}
          <span className={styles.accent}>{r.titleLines[1]}</span>
        </h2>
        <p className={styles.lead}>{r.lead}</p>
      </div>

      <div ref={panel} className={styles.panel}>
        <span className={styles.rim} aria-hidden="true" />
        <div className={styles.panelHead}>
          <span className={styles.panelTitle}>
            <span className={styles.panelDot} />
            {r.panelTitle}
          </span>
          <span className={styles.chip} data-live={status === "AVAILABLE" || undefined}>
            <span className={styles.chipDot} />
            {c.statuses[status]}
          </span>
        </div>

        <div className={styles.segments}>
          {/* 01 — the share of eligible service fees, drawn as a ring. */}
          <article className={styles.segment} data-kind="fees">
            <span className={styles.index}>01</span>
            <div className={styles.ring} aria-hidden="true">
              <svg viewBox="0 0 140 140" className={styles.ringSvg}>
                <circle className={styles.ringTrack} cx="70" cy="70" r={RING_RADIUS} />
                <circle
                  className={styles.ringArc}
                  cx="70"
                  cy="70"
                  r={RING_RADIUS}
                  strokeDasharray={RING_LENGTH}
                  strokeDashoffset={RING_LENGTH * (1 - drawn)}
                />
              </svg>
              <span className={styles.ringValue}>
                <b>{share}%</b>
              </span>
            </div>
            <h3 className={styles.segmentName}>{r.segments.fees.name}</h3>
            <p className={styles.segmentBody}>{r.segments.fees.body.replace("{rate}", `${REWARDS.feeSharePercent}%`)}</p>
          </article>

          {/* 02 — points for qualified activity; the figure is an example. */}
          <article className={styles.segment} data-kind="points">
            <span className={styles.index}>02</span>
            <div className={styles.points}>
              <span className={styles.pointsValue}>
                <b>{format(points)}</b>
                <small>{r.segments.points.unit}</small>
              </span>
              <span className={styles.pointsLevel}>
                <span>{r.segments.points.level} {String(POINTS.level).padStart(2, "0")}</span>
                <span className={styles.example}>{r.example}</span>
              </span>
              <span className={styles.pointsBar} aria-hidden="true">
                <span className={styles.pointsFill} style={{ transform: `scaleX(${counted ? POINTS.progress.toFixed(3) : 0})` }} />
              </span>
              {POINTS.nextAt !== null ? (
                <span className={styles.pointsNext}>{r.segments.points.next} {format(POINTS.nextAt)}</span>
              ) : null}
            </div>
            <h3 className={styles.segmentName}>{r.segments.points.name}</h3>
            <p className={styles.segmentBody}>{r.segments.points.body}</p>
            <p className={styles.segmentNote}>{r.segments.points.note}</p>
          </article>

          {/* 03 — the two referral levels, lit one after the other. */}
          <article className={styles.segment} data-kind="referral">
            <span className={styles.index}>03</span>
            <div className={styles.levels} aria-hidden="true">
              <span className={styles.level} data-level="1">
                <small>{r.segments.referral.level1}</small>
                <b>{REWARDS.referralLevel1Percent}%</b>
              </span>
              <span className={styles.levelLine} />
              <span className={styles.level} data-level="2">
                <small>{r.segments.referral.level2}</small>
                <b>{REWARDS.referralLevel2Percent}%</b>
              </span>
            </div>
            <h3 className={styles.segmentName}>{r.segments.referral.name}</h3>
            <p className={styles.segmentBody}>{r.segments.referral.body}</p>
            <p className={styles.srOnly}>
              {r.segments.referral.level1} {REWARDS.referralLevel1Percent}% · {r.segments.referral.level2} {REWARDS.referralLevel2Percent}%
            </p>
          </article>
        </div>

        <ol className={styles.loop} aria-label={r.loopLabel}>
          {r.loop.map((word) => (
            <li key={word} className={styles.loopStep}>{word}</li>
          ))}
        </ol>
      </div>

      <div ref={end} className={styles.close}>
        <p className={styles.statement}>
          {r.statementLines.map((line) => <span key={line}>{line}</span>)}
        </p>
        <div className={styles.actions}>
          <Link className={styles.open} href={localizedPath("/app/home", locale)} prefetch={false}>
            {r.open}
            <ArrowRight size={20} weight="bold" aria-hidden />
          </Link>
          <Link className={styles.explore} href={localizedPath("/app/markets", locale)} prefetch={false}>
            {r.explore}
          </Link>
        </div>
        <ul className={styles.trust}>
          {r.trust.map((line, index) => (
            <li key={line}>
              {index === 0 ? (
                // eslint-disable-next-line @next/next/no-img-element -- the network's mark, an SVG served as it is
                <img src="/site/solana-mark.svg" alt="" width={16} height={13} />
              ) : null}
              {line}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
