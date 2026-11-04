'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import s from './trade.module.css';

/**
 * What you get, beside the one action (CITY-189). On a phone the tower's window is half the screen: the pinned dock
 * stands over the ticket's own «You get» figure until the card is scrolled to its end. While that figure is out of
 * sight — under the dock or scrolled away — the dock carries it in one quiet line above the terms; once the figure is
 * in view, the line folds away and the dock is as it was. A card that fits, as on a desk, never shows it.
 *
 * `target` is the ticket's figure. The line is the same figure again, so it is hidden from screen readers: they read
 * the figure itself.
 */
export function DockGet({ target, label, children }: { target: RefObject<HTMLElement | null>; label: string; children: ReactNode }) {
  const line = useRef<HTMLDivElement>(null);
  const hidden = useHidden(target, line);
  return (
    <div ref={line} className={`${s.dockGet} ${hidden ? s.dockGetOn : ''}`} aria-hidden="true">
      <div className={s.dockGetInner}>
        <span className={s.label}>{label}</span>
        <span className={s.getInline}>{children}</span>
      </div>
    </div>
  );
}

/** Whether `target` is out of sight in the card: above its scrolled top, or below the top of the dock that holds `line`. */
function useHidden(target: RefObject<HTMLElement | null>, line: RefObject<HTMLElement | null>): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const dock = line.current?.parentElement;
    const figure = target.current;
    const card = dock ? scrollerOf(dock) : null;
    if (!dock || !figure || !card) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const seen = card.getBoundingClientRect();
      const at = figure.getBoundingClientRect();
      const floor = Math.min(seen.bottom, dock.getBoundingClientRect().top);
      // Two pixels of slack either way: on a desk the figure ends where the dock begins, and rounding never flips the line.
      setHidden(at.top < seen.top - 2 || at.bottom > floor + 2);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    // The card's own box, and whatever inside it grows or shrinks and so moves the figure or the dock.
    const resized = new ResizeObserver(schedule);
    for (const el of [card, ...card.children, dock.parentElement ?? dock, dock, figure]) resized.observe(el);
    // A new figure, a note that comes and goes, the window's own opening slide: measured again once it has settled.
    const changed = new MutationObserver(schedule);
    changed.observe(card, { childList: true, subtree: true, characterData: true });
    card.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    document.addEventListener('transitionend', schedule);
    document.addEventListener('animationend', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      changed.disconnect();
      card.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('transitionend', schedule);
      document.removeEventListener('animationend', schedule);
    };
  }, [target, line]);
  return hidden;
}

/** The card that scrolls: the nearest box above `el` that scrolls its own content. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let at = el.parentElement; at; at = at.parentElement) if (/(auto|scroll)/.test(getComputedStyle(at).overflowY)) return at;
  return null;
}
