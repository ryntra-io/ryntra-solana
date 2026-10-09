"use client";

import { useEffect, type RefObject } from "react";

/**
 * A chart as tall as the first screen allows: from where its canvas starts to
 * the bottom of the window — less what must still be seen under it (`tail`,
 * the ranges under a line) and a margin — within bounds. Written as a CSS
 * variable on `host`, so the stylesheet decides where it applies (a desk) and
 * what a phone keeps. Measured again when the window or the host changes size
 * — the header above the chart filling in, a column appearing, the page
 * growing — never on scroll. The target must not be sticky: its place on the
 * page is read as its top plus the scroll. The value depends on nothing the
 * chart's own height moves, so it settles on the first pass.
 */
export function useFitHeight(
  host: RefObject<HTMLElement | null>,
  { target, tail, variable, min = 300, max = 760, margin = 16 }: { target: string; tail?: string; variable: string; min?: number; max?: number; margin?: number },
) {
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    let frame = 0;
    let live = true;
    const fit = () => {
      if (!live) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const element = root.querySelector<HTMLElement>(target);
        if (!element) return;
        const box = element.getBoundingClientRect();
        const after = tail ? root.querySelector<HTMLElement>(tail)?.getBoundingClientRect() : null;
        const below = after ? Math.max(0, after.bottom - box.bottom) : 0;
        const next = Math.round(Math.min(max, Math.max(min, window.innerHeight - (box.top + window.scrollY) - below - margin)));
        if (root.style.getPropertyValue(variable) !== `${next}px`) root.style.setProperty(variable, `${next}px`);
      });
    };
    fit();
    /* The face's own metrics move what stands above the chart once it loads. */
    void document.fonts?.ready.then(fit);
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    /* What loads above the host — a notice, a banner — moves the chart without resizing the host. */
    observer.observe(document.body);
    window.addEventListener("resize", fit);
    return () => {
      live = false;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [host, target, tail, variable, min, max, margin]);
}
