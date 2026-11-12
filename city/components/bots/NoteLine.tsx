'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import s from './bots.module.css';

/** Air kept between the line and the edge of what scrolls it. */
const AIR = 14;

/**
 * Bring the line into the window's own scroller, and nothing else: `scrollIntoView` would also move every clipped
 * ancestor — a window dragged half off the screen would drag the city's page with it, with no way to scroll it back.
 */
function reveal(node: HTMLElement): void {
  for (let box = node.parentElement; box; box = box.parentElement) {
    const flow = getComputedStyle(box).overflowY;
    if ((flow !== 'auto' && flow !== 'scroll') || box.scrollHeight <= box.clientHeight) continue;
    const line = node.getBoundingClientRect();
    const room = box.getBoundingClientRect();
    const by = line.bottom + AIR > room.bottom ? line.bottom + AIR - room.bottom : line.top - AIR < room.top ? line.top - AIR - room.top : 0;
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (by) box.scrollBy({ top: by, behavior: calm ? 'auto' : 'smooth' });
    return;
  }
}

/**
 * The line an action answers with — «Ladder placed», «Nothing was signed», «Stopped before your wallet — nothing was
 * sent» (CITY-237). It stands right under its action and, said, comes into view by itself: on a phone's half-screen
 * window the answer used to land below the window's edge, read only after a scroll. `at` is when it was said — the same
 * answer said again comes into view again.
 */
export function NoteLine({ kind, at, children }: Readonly<{ kind: string; at: number; children: ReactNode }>) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (ref.current) reveal(ref.current);
  }, [kind, at]);
  return (
    <p ref={ref} className={s.liveNote} data-kind={kind} role="status">
      {children}
    </p>
  );
}
