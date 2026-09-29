"use client";

import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { PublicLocale } from "@/lib/site/locale";
import { HOMEPAGE_COPY } from "@/lib/site/homepage-copy";
import { homepageModel } from "@/lib/site/homepage-model";
import { localizedPath } from "@/lib/site/localized";
import { WorkflowCard } from "./workflow-cards";
import styles from "./workflow.module.css";

/**
 * How it works — the third block of the landing.
 *
 * One purchase's road across the width of the page, and one product frame
 * under it whose content changes with the step: the company, the sum from
 * $1, the Review in four lines, the signature in the person's own wallet,
 * the receipt from the chain, and the rule that repeats it («Автоінвест»).
 * The block is the Owner's of 2026-09-13 («From opportunity to outcome»,
 * one trade from the market row to plan-versus-actual); since the new site
 * of canon v5.5 (2026-09-26) it walks the road a beginner walks, and the
 * frame gives the Review the most room.
 *
 * How it moves. From 1024px up, without a motion preference against it, the
 * rail and the frame pin under the header while the section's runway scrolls
 * past: the reader's own scroll fills the orange line from the first node to
 * the sixth and crossfades the frame's content, eight pixels and a fade, no
 * slide; a click on a node scrolls the page to that step's place on the
 * runway, so the scroll and the click never disagree about where the reader
 * is. Below 1024px, and under `prefers-reduced-motion`, the six steps stand
 * in a column, each with its own card, and the one nearest the middle of
 * the screen is the lit one — the same words, the same figures, nothing
 * pinned.
 *
 * What is real. The words come from `HOMEPAGE_COPY`; the frame's crumbs name
 * the page of the product each step lives on, and the chip beside them is
 * that page's readiness from the route registry through `homepageModel`,
 * so a step whose page is still being built says so in the frame and
 * nothing planned reads as open. The figures are one illustrative NVDAx
 * trade (workflow-trade.ts), consistent across the six cards, and the frame
 * that shows them is `aria-hidden` with a note saying they are examples.
 */

export function Workflow({ locale }: { locale: PublicLocale }) {
  const c = HOMEPAGE_COPY[locale];
  const w = c.workflow;
  const model = homepageModel(locale).workflow;
  const section = useRef<HTMLElement | null>(null);
  const track = useRef<HTMLDivElement | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const head = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const current = useRef(0);
  const pinned = useRef(false);
  const count = w.steps.length;

  useEffect(() => {
    const root = section.current;
    const runway = track.current;
    const pin = stage.current;
    if (!root || !runway || !pin) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const desktop = window.matchMedia("(min-width: 1024px) and (prefers-reduced-motion: no-preference)");
    /* The script has the section: from here the reveal applies. Under reduced
       motion there is nothing to reveal — it is simply there. */
    root.dataset.js = "";
    if (reduced.matches) root.dataset.seen = "";

    const set = (next: number) => {
      if (next === current.current) return;
      current.current = next;
      setActive(next);
    };

    /* Reveal once, when half the head is on screen — the section itself is
       several screens tall, so a share of it would come far too late. */
    const seen = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.intersectionRatio >= 0.5) {
          root.dataset.seen = "";
          seen.disconnect();
        }
      }
    }, { threshold: [0, 0.5] });
    seen.observe(head.current ?? root);

    /* The stage's light moves only while some of the block is on screen. */
    const onScreen = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) root.dataset.active = "";
        else delete root.dataset.active;
      }
    }, { threshold: 0 });
    onScreen.observe(root);

    /* Pinned: the stage's place on the runway is the reader's progress. The
       runway is the sticky range — the track's height less the stage's — so
       the sixth step holds for its own share before the stage lets go. */
    let frame = 0;
    let top = 0;
    const measure = () => {
      frame = 0;
      const range = runway.offsetHeight - pin.offsetHeight;
      const box = runway.getBoundingClientRect();
      const progress = range > 0 ? Math.min(1, Math.max(0, (top - box.top) / range)) : 0;
      /* The line runs from the first dot to the last: it reaches dot `i`
         exactly when the reader is in the middle of step `i`'s share. */
      root.style.setProperty("--fill", Math.min(1, Math.max(0, (progress * count - 0.5) / (count - 1))).toFixed(4));
      set(Math.min(count - 1, Math.floor(progress * count)));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    /* Stacked: the step nearest the middle of the screen is the lit one. */
    const steps = Array.from(root.querySelectorAll<HTMLElement>(`.${styles.step}`));
    const middle = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = steps.indexOf(entry.target as HTMLElement);
        if (index < 0) continue;
        root.style.setProperty("--fill", (index / (count - 1)).toFixed(4));
        set(index);
      }
    }, { rootMargin: "-45% 0px -45% 0px", threshold: 0 });

    const arm = () => {
      pinned.current = desktop.matches;
      if (desktop.matches) {
        middle.disconnect();
        top = parseFloat(getComputedStyle(pin).top) || 0;
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);
        measure();
      } else {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
        for (const step of steps) middle.observe(step);
      }
    };
    arm();
    desktop.addEventListener("change", arm);

    return () => {
      seen.disconnect();
      onScreen.disconnect();
      middle.disconnect();
      desktop.removeEventListener("change", arm);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [count]);

  /* A node takes the reader to that step's own place on the runway — the
     middle of its share — so the scroll driver lands on the same step. */
  const jump = (index: number) => {
    const root = section.current;
    const runway = track.current;
    const pin = stage.current;
    if (!root || !runway || !pin) return;
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    if (pinned.current) {
      const top = parseFloat(getComputedStyle(pin).top) || 0;
      const range = runway.offsetHeight - pin.offsetHeight;
      const start = window.scrollY + runway.getBoundingClientRect().top - top;
      window.scrollTo({ top: start + ((index + 0.5) / count) * range, behavior });
    } else {
      root.querySelectorAll<HTMLElement>(`.${styles.step}`)[index]?.scrollIntoView({ behavior, block: "center" });
    }
  };

  return (
    <section ref={section} className={styles.workflow} data-step={active} aria-labelledby="workflow-title">
      <div className={styles.backdrop} aria-hidden="true">
        <span className={styles.grid} />
      </div>

      <div ref={head} className={styles.head}>
        <p className={styles.eyebrow}>{w.eyebrow}</p>
        <h2 id="workflow-title" className={styles.title}>
          {w.titleLines.map((line, index) => <span key={line}>{index > 0 ? " " : null}{line}</span>)}
        </h2>
        <p className={styles.lead}>{w.lead}</p>
      </div>

      <div ref={track} className={styles.track}>
        <div ref={stage} className={styles.stage}>
          {/* The light of the top of the page, back under the stage: one of
              the orange trajectories the universe orbits, rising behind the
              frame's upper right, and the warm horizon the hero's device
              stands on — pinned with the stage, so the frame is lit for the
              whole road, not only at the section's head. */}
          <span className={styles.stageLight} aria-hidden="true">
            <span className={styles.arcField}><span className={styles.trajectory} /></span>
            <span className={styles.floor} />
          </span>
          <ol className={styles.rail} aria-label={w.railLabel}>
            <li className={styles.line} aria-hidden="true">
              <span className={styles.fill} />
              <span className={styles.spark} />
            </li>
            {w.steps.map((step, index) => (
              <li key={step.id} className={styles.stop}>
                <button
                  type="button"
                  className={styles.node}
                  aria-current={index === active ? "step" : undefined}
                  data-done={index < active || undefined}
                  onClick={() => jump(index)}
                >
                  <span className={styles.dot} />
                  <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
                  <span className={styles.name}>{step.label}</span>
                </button>
              </li>
            ))}
          </ol>

          <div className={styles.frame}>
            <span className={styles.rim} aria-hidden="true" />
            <span className={styles.glass} aria-hidden="true" />
            <p className={styles.frameNote}>{w.frameNote}</p>
            <div className={styles.steps}>
              {w.steps.map((step, index) => {
                const place = model.find((entry) => entry.id === step.id);
                const status = place?.status ?? "UNAVAILABLE";
                const surface = place ? w.surfaces[place.surface] : "";
                return (
                  <div
                    key={step.id}
                    className={styles.step}
                    data-state={index === active ? "active" : index < active ? "before" : "after"}
                  >
                    {/* The step's mark and the window's crumbs each carry the
                        readiness chip: the mark shows in the column, the
                        crumbs in the frame, never both at once. */}
                    <div className={styles.stepMark}>
                      <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
                      <span className={styles.name}>{step.label}</span>
                      <span className={styles.chip} data-live={status === "AVAILABLE" || undefined}>
                        <span className={styles.chipDot} />
                        {c.statuses[status]}
                      </span>
                    </div>
                    <div className={styles.chrome}>
                      <span className={styles.crumbs}>
                        <span className={styles.crumbDot} />
                        {[surface, ...step.crumbs].map((crumb) => <span key={crumb}>{crumb}</span>)}
                      </span>
                      <span className={styles.chip} data-live={status === "AVAILABLE" || undefined}>
                        <span className={styles.chipDot} />
                        {c.statuses[status]}
                      </span>
                    </div>
                    <div className={styles.body}>
                      <div className={styles.words}>
                        <span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>
                        <h3 className={styles.stepTitle}>{step.title}</h3>
                        <p className={styles.stepBody}>{step.body}</p>
                      </div>
                      <div className={styles.visual} aria-hidden="true">
                        <WorkflowCard id={step.id} locale={locale} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className={styles.runway} aria-hidden="true" />
      </div>

      <div className={styles.close}>
        <p className={styles.closing}>
          {w.closingLines.map((line) => <span key={line}>{line}</span>)}
        </p>
        <Link className={styles.open} href={localizedPath("/app/home", locale)} prefetch={false}>
          {w.open}
          <ArrowRight size={18} weight="bold" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
