"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Chrome copy for the controls the shell renders out of its own body.
 *
 * `ShellStrings` already covers the copy `RyntraAppShell` renders directly —
 * the skip link, the navigation toggles — and a workspace with a catalog passes
 * it. Three controls were left out of that arrangement and it showed: the
 * Context toggle in the top bar, the theme button at the foot of the rail and
 * the whole Layout menu behind it are rendered *inside* the shell, several
 * components below the prop, so they each carried a hard-coded English literal.
 *
 * On a Ukrainian workspace that is not a cosmetic gap. `Context`, `Layout` and
 * `Dark` sit on each of one hub's twenty-eight surfaces, in the two places a
 * person looks first — the top right and the bottom left — and opening the
 * layout menu produced a popover that was English end to end: *Depth*,
 * *Simple*, *Density*, *Comfortable*, *Panels*, *Reset layout*.
 *
 * Prop-threading four levels to reach them would put chrome copy through
 * `PrimaryNavigation`, which has no other reason to know about it. A context is
 * the smaller change and it lives in its own file so `theme-toggle` and
 * `customize` can read it without importing `app-shell`, which imports them.
 *
 * **Every field has an English default.** A workspace that has no catalog —
 * which is every workspace except one today — renders exactly what it rendered
 * before, and adding a locale is one object at the shell boundary.
 */
export type ShellChromeCopy = Readonly<{
  /** The top-bar toggle that opens the context rail. */
  contextToggle: string;
  /**
   * The word beside the hamburger on a phone.
   *
   * Below 900px the rail becomes a drawer and this button is the only way to
   * reach any of the twenty-eight surfaces. It was an unlabelled arrow.
   */
  menu: string;
  theme: Readonly<{
    dark: string;
    light: string;
    darkShort: string;
    lightShort: string;
    /**
     * The accessible name, as one sentence with two named parts.
     * `{current}` is the theme in force, `{next}` the one a press selects.
     */
    announce: string;
  }>;
  layout: Readonly<{
    /** The trigger beside the theme button. */
    trigger: string;
    triggerTitle: string;
    depth: string;
    depthGroup: string;
    simple: string;
    simpleBody: string;
    pro: string;
    proBody: string;
    density: string;
    densityGroup: string;
    comfortable: string;
    comfortableBody: string;
    compact: string;
    compactBody: string;
    /** `Panels` plus one of the two qualifiers below, already joined. */
    panelsFixed: string;
    panelsEditable: string;
    empty: string;
    alwaysOn: string;
    advanced: string;
    /** `{panel}` is the panel's own title. */
    moveUp: string;
    moveDown: string;
    savedLocally: string;
    resetLayout: string;
    resetAsk: string;
    resetGo: string;
    resetCancel: string;
  }>;
  /**
   * The workspace switcher's own words: the panel title and the footer door.
   *
   * Optional so a workspace with an older catalog (one hub threads its own) keeps
   * rendering the English defaults rather than failing the type.
   */
  switcher?: Readonly<{ title: string; all: string }>;
}>;

export const DEFAULT_SHELL_CHROME: ShellChromeCopy = {
  contextToggle: "Context",
  menu: "Menu",
  theme: {
    dark: "Dark",
    light: "Light",
    darkShort: "Dark",
    lightShort: "Light",
    announce: "Theme: {current}. Switch to {next}",
  },
  layout: {
    trigger: "Layout",
    triggerTitle: "Customize layout",
    depth: "Depth",
    depthGroup: "Workspace depth",
    simple: "Simple",
    simpleBody: "The four modules only. The surfaces inside them stay folded away.",
    pro: "Pro",
    proBody: "Every surface in the rail, and the panels can be hidden and reordered.",
    density: "Density",
    densityGroup: "Workspace density",
    comfortable: "Comfortable",
    comfortableBody: "Roomier panels and 44px table rows.",
    compact: "Compact",
    compactBody: "Tighter padding and 32px table rows.",
    panelsFixed: "Panels · fixed in Simple",
    panelsEditable: "Panels · show, hide and reorder",
    empty: "This workspace has no configurable panels. Nothing here is hidden from you.",
    alwaysOn: "Always on",
    advanced: "Advanced",
    moveUp: "Move {panel} up",
    moveDown: "Move {panel} down",
    savedLocally: "Saved in this browser only.",
    resetLayout: "Reset layout",
    resetAsk: "Reset this workspace to its default layout?",
    resetGo: "Reset",
    resetCancel: "Cancel",
  },
  /* The footer door opens the capability register — `/workspaces` is a
     permanent redirect there since the public-surface consolidation — so the
     label names the destination rather than the page that used to exist. */
  switcher: { title: "Workspaces", all: "Current capabilities" },
};

const ShellCopyContext = createContext<ShellChromeCopy>(DEFAULT_SHELL_CHROME);

export function ShellCopyProvider({
  copy,
  children,
}: {
  copy?: ShellChromeCopy;
  children: ReactNode;
}) {
  return (
    <ShellCopyContext.Provider value={copy ?? DEFAULT_SHELL_CHROME}>
      {children}
    </ShellCopyContext.Provider>
  );
}

export function useShellCopy(): ShellChromeCopy {
  return useContext(ShellCopyContext);
}

/** One named part, substituted. Keeps the sentence in the catalog, not in code. */
export function fill(template: string, parts: Readonly<Record<string, string>>): string {
  return Object.entries(parts).reduce(
    (text, [name, value]) => text.split(`{${name}}`).join(value),
    template,
  );
}
