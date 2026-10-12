"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "@phosphor-icons/react";

import { applyThemePref, getThemePref, type ThemePref } from "@/app/app/theme";
import { fill, useShellCopy } from "./shell-copy";

/**
 * The theme control, back in the rail.
 *
 * It was here for one day in August and was removed on 2026-08-19, and the
 * reason was sound: the preference had four writers — this slot, an Appearance
 * block in the layout menu, a switch in the cabinet's rail footer and a
 * settings page — and a person could not tell which one was telling the truth.
 * The fix was to give appearance exactly one home.
 *
 * **A control came back on 2026-08-24**, next to the language
 * button at the foot of the rail, because "one home" turned out to mean "two
 * clicks away on a page you have to leave the workspace to reach". That is a
 * different complaint from the one that emptied this slot, and both can be
 * answered at once: there is still exactly one *writer*,
 * `app/app/theme.ts`, and every control is a view of it.
 *
 * What makes two views safe here — and what was missing from the four that
 * were removed — is that this one **does not hold the preference**. It reads
 * it on mount and it watches `<html data-theme>`, so a change made in
 * `Settings → Appearance` is reflected here without a reload, and there is no
 * second copy of the value that can drift from the first.
 *
 * Two values. Dark and Light. `system` was closed on 2026-08-25:
 * following the machine was a third answer that nobody asked for, and it
 * made the control read as something other than a theme switch. A stored
 * `system` leftover is resolved once in `getThemePref` and never offered
 * here again.
 */

const ORDER: readonly ThemePref[] = ["dark", "light"];

const ICON: Readonly<Record<ThemePref, typeof Moon>> = {
  dark: Moon,
  light: Sun,
};

export function ThemeToggle() {
  /* The two words are the workspace's, not this file's. `Dark` at the foot of
     a Ukrainian rail was an English literal a reader met on every surface;
     the copy comes from `ShellCopyProvider` now and falls back to exactly
     these words when a workspace has no catalog. */
  const { theme: copy } = useShellCopy();
  const FACE: Readonly<Record<ThemePref, { label: string; short: string }>> = {
    dark: { label: copy.dark, short: copy.darkShort },
    light: { label: copy.light, short: copy.lightShort },
  };
  /* `null` until the browser has been read. The stored preference is unknowable
     on the server, and a guessed one paints the wrong icon for a frame. */
  const [pref, setPref] = useState<ThemePref | null>(null);

  useEffect(() => {
    setPref(getThemePref());
    /* The other control writes `<html data-theme>` through the same helper, so
       watching the attribute is enough to stay in step with it — no shared
       store, no event bus, and nothing here that can hold a stale copy. */
    const observer = new MutationObserver(() => setPref(getThemePref()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const current = pref ?? "dark";
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  const Icon = ICON[current];
  const announce = fill(copy.announce, {
    current: FACE[current].label,
    next: FACE[next].label,
  });

  return (
    <button
      type="button"
      className="rs-view-theme"
      data-pref={current}
      onClick={() => {
        applyThemePref(next);
        setPref(next);
      }}
      aria-label={announce}
      title={announce}
    >
      <Icon size={17} weight="bold" aria-hidden />
      <span className="rs-view-theme-label">{FACE[current].short}</span>
    </button>
  );
}
