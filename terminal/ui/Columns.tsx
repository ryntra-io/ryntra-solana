'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { OLD_PRO_KEY, columnsKey, startSet, type ColumnSet } from './column-set';
import s from './ui.module.css';

/* What each table shows, read once from the browser's memory and the window, and the screens that listen. */
const chosen = new Map<string, ColumnSet>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function read(table: string): ColumnSet {
  const known = chosen.get(table);
  if (known) return known;
  let kept: string | null = null;
  let oldPro: string | null = null;
  try {
    kept = window.localStorage.getItem(columnsKey(table));
    oldPro = window.localStorage.getItem(OLD_PRO_KEY);
  } catch {
    /* Storage blocked: the window's width decides. */
  }
  const set = startSet(kept, window.innerWidth, oldPro);
  chosen.set(table, set);
  return set;
}

/**
 * The set of columns a table shows, remembered per table (`./column-set.ts`). The server's page draws the main set and
 * hydration follows it; from then on a screen opens straight in the person's own set — no first frame in another.
 */
export function useColumnSet(table: string): readonly [ColumnSet, (next: ColumnSet) => void] {
  const set = useSyncExternalStore<ColumnSet>(
    subscribe,
    () => read(table),
    () => 'main',
  );
  const choose = useCallback(
    (next: ColumnSet) => {
      chosen.set(table, next);
      try {
        window.localStorage.setItem(columnsKey(table), next);
      } catch {
        /* Storage blocked: the choice holds for this visit. */
      }
      for (const listener of listeners) listener();
    },
    [table],
  );
  return [set, choose] as const;
}

/**
 * «Columns» on a table's own bar: the main ones or all of them. A quiet two-way choice with its name in front — in
 * sight, so nobody has to know a switch exists somewhere else.
 */
export function Columns({ value, onChange, label, main, all }: { value: ColumnSet; onChange: (next: ColumnSet) => void; label: string; main: string; all: string }) {
  const items: readonly (readonly [ColumnSet, string])[] = [
    ['main', main],
    ['all', all],
  ];
  return (
    <div className={s.cols} role="radiogroup" aria-label={label} data-terminal="columns">
      <span className={s.colsName} aria-hidden="true">
        {label}
      </span>
      {items.map(([id, word]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} className={s.colsItem} onClick={() => onChange(id)}>
          {word}
        </button>
      ))}
    </div>
  );
}
