'use client';

import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { cx } from './cx';
import s from './ui.module.css';

/** Before paint in the browser, so the row never shows the wrong part first; on the server, nothing to measure. */
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Scroll a row of choices sideways — only the row, never the page — until the chosen one is in full view. */
function keepInView(box: HTMLElement | null, selector: string, at: number) {
  const item = box?.querySelectorAll<HTMLElement>(selector)[at];
  if (!box || !item || box.scrollWidth <= box.clientWidth) return;
  const row = box.getBoundingClientRect();
  const it = item.getBoundingClientRect();
  if (it.left < row.left) box.scrollLeft += it.left - row.left - 16;
  else if (it.right > row.right) box.scrollLeft += it.right - row.right + 16;
}

/**
 * Which edge of a row of choices hides more of it: that edge fades softly, so a word cut by the screen's edge
 * never stands there broken. Only read — the row scrolls as it always did.
 */
function useFadeEdges(row: RefObject<HTMLElement | null>, count: number) {
  useEffect(() => {
    const box = row.current;
    if (!box) return;
    const look = () => {
      const left = box.scrollLeft > 1;
      const right = box.scrollLeft + box.clientWidth < box.scrollWidth - 1;
      const fade = left && right ? 'both' : left ? 'start' : right ? 'end' : null;
      if (fade) box.dataset.fade = fade;
      else delete box.dataset.fade;
    };
    look();
    box.addEventListener('scroll', look, { passive: true });
    const sized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(look);
    sized?.observe(box);
    return () => {
      box.removeEventListener('scroll', look);
      sized?.disconnect();
    };
  }, [row, count]);
}

export type TabItem<T extends string> = Readonly<{ id: T; label: string; count?: string; icon?: ReactNode }>;

/** Arrow keys, Home and End move along a row of choices, as a tab list and a radio group do. */
function step(event: KeyboardEvent<HTMLElement>, count: number, at: number): number | null {
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') return (at + 1) % count;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') return (at - 1 + count) % count;
  if (event.key === 'Home') return 0;
  if (event.key === 'End') return count - 1;
  return null;
}

/**
 * Tabs: one row of views of the same screen. `fill` shares the width equally; `bare` drops the well around them.
 * The arrows move between tabs; the chosen one is the only stop for Tab.
 */
export function Tabs<T extends string>({ items, value, onChange, label, fill = false, bare = false, className }: { items: readonly TabItem<T>[]; value: T; onChange: (id: T) => void; label: string; fill?: boolean; bare?: boolean; className?: string }) {
  const row = useRef<HTMLDivElement>(null);
  const at = Math.max(0, items.findIndex((item) => item.id === value));
  /* On a phone the row is wider than the screen: the chosen tab — opened by a link or a choice — is never left out of sight. */
  useBeforePaint(() => keepInView(row.current, '[role="tab"]', at), [at, items.length]);
  useFadeEdges(row, items.length);
  return (
    <div
      ref={row}
      role="tablist"
      aria-label={label}
      className={cx(s.tabs, fill && s.tabsFill, bare && s.tabsBare, className)}
      onKeyDown={(event) => {
        const next = step(event, items.length, at);
        if (next === null) return;
        event.preventDefault();
        onChange(items[next]!.id);
        row.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}
    >
      {items.map((item) => (
        <button key={item.id} type="button" role="tab" className={s.tab} aria-selected={item.id === value} tabIndex={item.id === value ? 0 : -1} onClick={() => onChange(item.id)}>
          {item.icon}
          {item.label}
          {item.count ? <span className={s.tabCount}>{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export type SegmentItem<T extends string> = Readonly<{ id: T; label: string; tone?: 'buy' | 'sell' }>;

/**
 * The two-way choice of a ticket — buy or sell, long or short: buy lights mint, sell lights flare. `value` null — none
 * of the items stands (the person set the thing by hand elsewhere); the first is then the one Tab reaches.
 */
export function Segment<T extends string>({ items, value, onChange, label, className }: { items: readonly SegmentItem<T>[]; value: T | null; onChange: (id: T) => void; label: string; className?: string }) {
  const row = useRef<HTMLDivElement>(null);
  const at = Math.max(0, items.findIndex((item) => item.id === value));
  return (
    <div
      ref={row}
      role="radiogroup"
      aria-label={label}
      className={cx(s.seg, className)}
      onKeyDown={(event) => {
        const next = step(event, items.length, at);
        if (next === null) return;
        event.preventDefault();
        onChange(items[next]!.id);
        row.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
      }}
    >
      {items.map((item, index) => (
        <button key={item.id} type="button" role="radio" className={s.segItem} data-tone={item.tone} aria-checked={item.id === value} tabIndex={item.id === value || (value === null && index === 0) ? 0 : -1} onClick={() => onChange(item.id)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}
