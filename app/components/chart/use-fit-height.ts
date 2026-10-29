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
/** A chart shorter than this says nothing at all: the floor below which a short screen is not worth squeezing. */
export const FIT_FLOOR_PX = 120;

/**
 * The height from the room a screen actually has: what is left under the chart's top, less what must stay seen below
 * it, the phone's bar and a margin — within `min` and `max`.
 *
 * The floor gives way to the room. A phone turned on its side has 390 px of screen, and a `min` written for a window
 * 900 tall would then make a panel taller than everything it stands in: the chart would push the page's own action off
 * the screen, which is the one thing turning the phone was meant to show (the landscape reading of the UX audit of
 * 21.10). So where the room is smaller than `min`, the height is the room — down to a floor no screen is below.
 */
export function fitHeight({ innerHeight, top, below = 0, bar = 0, margin = 16, min = 300, max = 760 }: { innerHeight: number; top: number; below?: number; bar?: number; margin?: number; min?: number; max?: number }): number {
  const room = innerHeight - top - below - bar - margin;
  const floor = Math.min(min, Math.max(FIT_FLOOR_PX, room));
  return Math.round(Math.min(max, Math.max(floor, room)));
}

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
        /* The phone's bottom bar the core pins below 1024 px (SOL-C11): the screen ends above it. Measured, not read off
           `--shell-bottom`, which may still be a `calc()` before the core has measured it; a desk draws none. */
        const bar = document.querySelector<HTMLElement>(".ryntra-shell__bar")?.getBoundingClientRect().height ?? 0;
        const next = fitHeight({ innerHeight: window.innerHeight, top: box.top + window.scrollY, below, bar, margin, min, max });
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
