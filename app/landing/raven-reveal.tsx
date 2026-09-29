"use client";

import { useEffect } from "react";

/**
 * Scroll reveal for the raven landing.
 *
 * Renders nothing. It watches every `.rv-reveal` on the page and adds `.in`
 * when the element first enters the viewport, then stops watching it — a
 * reveal that re-triggers on the way back up is a distraction, not an effect.
 *
 * The hidden start state is applied here, from script, rather than in the
 * stylesheet. If the script is blocked or fails, the markup stays visible; a
 * CSS-first hidden state would leave a reader staring at a blank page below the
 * fold with no way to recover.
 *
 * Honours prefers-reduced-motion by never arming at all, and the elements stay
 * visible in that case for the same reason.
 */
export function RavenReveal() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof IntersectionObserver === "undefined") return;

    const nodes = Array.from(document.querySelectorAll<HTMLElement>(".rv-reveal"));
    if (!nodes.length) return;

    const root = document.documentElement;
    root.classList.add("rv-armed");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      },
      // Any sliver counts. A tall list can fill the viewport without ever
      // reaching a fractional threshold, and then it simply never appears —
      // which is how this first shipped, hiding whole sections.
      { threshold: 0, rootMargin: "0px 0px -40px 0px" },
    );

    nodes.forEach((node) => observer.observe(node));

    // Safety net: whatever has not been revealed after a few seconds is shown
    // anyway. A missed observer callback must never leave a reader looking at
    // an empty page — the effect is worth less than the content.
    const failsafe = window.setTimeout(() => {
      nodes.forEach((node) => node.classList.add("in"));
    }, 3000);

    return () => {
      window.clearTimeout(failsafe);
      observer.disconnect();
      root.classList.remove("rv-armed");
    };
  }, []);

  return null;
}
