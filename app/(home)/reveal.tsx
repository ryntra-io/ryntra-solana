"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A landing block that knows when it is seen — the same rule the Owner's
 * orbit, workflow and Rewards follow: once the script has the block it says
 * so (`data-js`), the block rises into place the first time a share of it is
 * on screen (`data-seen`), and its light moves only while some of it is
 * (`data-active`). Without the script, and under `prefers-reduced-motion`,
 * everything is simply there.
 */
export function Reveal({
  id,
  className,
  labelledBy,
  threshold = 0.18,
  children,
}: {
  id?: string;
  className: string;
  labelledBy: string;
  threshold?: number;
  children: ReactNode;
}) {
  const root = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const block = root.current;
    if (!block) return;
    block.dataset.js = "";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      block.dataset.seen = "";
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.intersectionRatio >= threshold) block.dataset.seen = "";
        if (entry.isIntersecting) block.dataset.active = "";
        else delete block.dataset.active;
      }
    }, { threshold: [0, threshold] });
    observer.observe(block);
    return () => observer.disconnect();
  }, [threshold]);

  return (
    <section ref={root} id={id} className={className} aria-labelledby={labelledBy}>
      {children}
    </section>
  );
}
