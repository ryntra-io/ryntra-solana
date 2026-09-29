"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * A list whose rows take turns being lit.
 *
 * Decoration in the strict sense: every row is always fully visible and the
 * highlight carries no information of its own — it walks the list so the
 * section reads as an instrument scanning its own questions rather than a
 * static table. The walk pauses under the pointer and under focus, stops
 * entirely for reduced motion, and holds while the tab is hidden.
 */
export function CycleList({
  className,
  reveal,
  label,
  children,
}: {
  className: string;
  reveal?: string;
  label?: string;
  children: ReactNode;
}) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const items = Array.from(list.children) as HTMLElement[];
    if (items.length < 2) return;

    let index = 0;
    let paused = false;

    const apply = () => {
      items.forEach((item, i) => {
        item.dataset.cycle = i === index ? "on" : "off";
      });
    };

    const timer = window.setInterval(() => {
      if (paused || document.visibilityState !== "visible") return;
      index = (index + 1) % items.length;
      apply();
    }, 3600);

    const pause = () => {
      paused = true;
    };
    const resume = () => {
      paused = false;
    };

    list.addEventListener("pointerenter", pause);
    list.addEventListener("pointerleave", resume);
    list.addEventListener("focusin", pause);
    list.addEventListener("focusout", resume);
    apply();

    return () => {
      window.clearInterval(timer);
      list.removeEventListener("pointerenter", pause);
      list.removeEventListener("pointerleave", resume);
      list.removeEventListener("focusin", pause);
      list.removeEventListener("focusout", resume);
      for (const item of items) delete item.dataset.cycle;
    };
  }, []);

  return (
    <ul className={className} data-rx-reveal={reveal} aria-label={label} ref={listRef}>
      {children}
    </ul>
  );
}
