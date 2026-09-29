"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

/**
 * Saved screens — a name and a set of conditions, and nothing else.
 *
 * A saved screen holds **no result and no market data**, which is what makes
 * it re-runnable rather than a snapshot: it is a question, and running it
 * tomorrow answers for tomorrow. That is also why this can live in the
 * browser at all — the same rule `app/shell/layout-store.ts` states, that
 * nothing sensitive and nothing duplicated goes in a browser key.
 *
 * Every read is defensive. A corrupted or hand-edited value falls back to an
 * empty list and the bad value is left alone rather than thrown at the person.
 */

const KEY = "ryntra.screens.v1";
const MAX_SCREENS = 24;
const NAME_MAX = 48;

type SavedScreen = { name: string; conditions: string[] };

function parse(raw: unknown): SavedScreen[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedScreen[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const name = (entry as Record<string, unknown>).name;
    const conditions = (entry as Record<string, unknown>).conditions;
    if (typeof name !== "string" || !name.trim()) continue;
    if (!Array.isArray(conditions)) continue;
    const clean = conditions.filter((c): c is string => typeof c === "string").slice(0, 12);
    out.push({ name: name.slice(0, NAME_MAX), conditions: clean });
    if (out.length >= MAX_SCREENS) break;
  }
  return out;
}

function read(): SavedScreen[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? parse(JSON.parse(raw)) : [];
  } catch {
    /* Private mode, a disabled store, a value someone pasted by hand — all of
       them mean "no saved screens", none of them means "fail". */
    return [];
  }
}

function write(screens: SavedScreen[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(screens.slice(0, MAX_SCREENS)));
  } catch {
    /* A full or disabled store must not take the page down with it. */
  }
}

function hrefOf(conditions: readonly string[]): string {
  if (conditions.length === 0) return "/robinhood/workspace/screener";
  return `/robinhood/workspace/screener?${conditions.map((c) => `c=${encodeURIComponent(c)}`).join("&")}`;
}

export function SavedScreens({ conditions }: { conditions: string[] }) {
  const [screens, setScreens] = useState<SavedScreen[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    setScreens(read());
  }, []);

  const save = useCallback(() => {
    const trimmed = name.trim().slice(0, NAME_MAX);
    if (!trimmed) return;
    const next = [{ name: trimmed, conditions }, ...screens.filter((s) => s.name !== trimmed)].slice(0, MAX_SCREENS);
    setScreens(next);
    write(next);
    setName("");
    setNaming(false);
  }, [conditions, name, screens]);

  const drop = useCallback(
    (target: string) => {
      const next = screens.filter((s) => s.name !== target);
      setScreens(next);
      write(next);
    },
    [screens],
  );

  return (
    <div className="rs-saved">
      {conditions.length > 0 ? (
        naming ? (
          <span className="rs-saveform">
            <input
              aria-label="Name this screen"
              className="rs-name"
              maxLength={NAME_MAX}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") save();
                if (event.key === "Escape") setNaming(false);
              }}
              placeholder="Name this screen"
              value={name}
              autoFocus
            />
            <button className="rs-add" onClick={save} type="button">
              Save
            </button>
          </span>
        ) : (
          <button className="rs-add" onClick={() => setNaming(true)} type="button">
            Save this screen
          </button>
        )
      ) : null}

      {screens.length > 0 ? (
        <ul className="rs-savedlist">
          {screens.map((screen) => (
            <li key={screen.name}>
              <Link className="rs-preset" href={hrefOf(screen.conditions)}>
                {screen.name}
              </Link>
              <button
                aria-label={`Forget the screen ${screen.name}`}
                className="rs-drop"
                onClick={() => drop(screen.name)}
                type="button"
              >
                Forget
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
