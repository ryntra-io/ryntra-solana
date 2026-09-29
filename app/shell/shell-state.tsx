"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  defaultPanelPrefs,
  defaultPrefs,
  readPrefs,
  resetPrefs,
  writePrefs,
  type Density,
  type PanelPrefs,
  type WorkspaceMode,
  type WorkspacePrefs,
} from "./layout-store";

/**
 * The layout word the product reads for its one version (canon v5.3 В28).
 *
 * The product has no depth to choose: there is no switch, and nothing a
 * person once chose makes a page longer or shorter. Its panels read the one
 * layout the store calls `guided` — every panel the page declares, and no
 * per-person hiding, which the product offers no control to undo. A page
 * that is a tool of the experienced (Spot) draws its full face by itself,
 * where it lives, rather than through a mode.
 */
const ONE_VERSION: WorkspaceMode = "guided";

/**
 * Shell state: what the user has chosen about their own workspace.
 *
 * Preferences are read once on mount rather than during render, because
 * `localStorage` does not exist on the server and a value read during render
 * would hydrate differently than it painted. The first paint is therefore the
 * default layout, and the saved one arrives a frame later — visible, honest,
 * and impossible to turn into a hydration mismatch.
 */

type ShellState = {
  ready: boolean;
  prefs: WorkspacePrefs;
  setMode: (mode: WorkspaceMode) => void;
  setDensity: (density: Density) => void;
  toggleNav: () => void;
  toggleInspector: () => void;
  setInspector: (open: boolean) => void;
  toggleWidget: (id: string) => void;
  isHidden: (id: string) => boolean;
  /** Moves a widget one place within a known ordering. Keyboard-operable by design. */
  moveWidget: (id: string, direction: -1 | 1, ids: readonly string[]) => void;
  /**
   * Per-panel preferences (spec §7), read-only for now.
   *
   * The writers lived on the per-panel `⋮` menu, which the founder turned off
   * until the surface itself is approved. Keeping dead setters exported is how
   * a reader concludes a control exists somewhere; keeping the *reader* is what
   * lets a stored preference survive the pause instead of being thrown away.
   * When the menu returns, the setters come back with it — see
   * `docs/archive/design-pre-reset-2026-08-18/workspace-system.md` §12.
   */
  panelPrefs: (id: string) => PanelPrefs;
  reset: () => void;
};

const ShellContext = createContext<ShellState | null>(null);

export function ShellStateProvider({
  workspaceId,
  oneVersion = false,
  children,
}: {
  workspaceId: string;
  /**
   * The product: one version for everyone (canon v5.3 В28). Its depth is not
   * a preference — `prefs.mode` always reads {@link ONE_VERSION} and choosing
   * a mode does nothing, whatever an older visit stored.
   */
  oneVersion?: boolean;
  children: React.ReactNode;
}) {
  const [prefs, setPrefs] = useState<WorkspacePrefs>(() => defaultPrefs());
  const [ready, setReady] = useState(false);

  /* Focus mode lived here and is gone. It hid the navigation and the
     inspector, which is what the collapse arrow beside the logo already does
     one step closer to hand — two controls, one outcome. Its rail slot now
     carries appearance. The state goes with the control rather than staying
     behind: a preference layer with no way to reach it is dead code with a
     storage key, which is the sentence `customize.tsx` opens with. */

  useEffect(() => {
    const stored = readPrefs(workspaceId);
    /*
     * «Простий» first, for everyone (canon v5.0 §0.0 rule 9, adopted
     * 2026-09-23, and the Owner's word the same evening): every person and
     * every guest opens Simple, in every workspace that still has two depths;
     * «Профі» is one switch and a person who pressed it keeps it. A stored
     * depth nobody chose — `pro` or `standard` written by an older default —
     * is residue, not a decision, so it is cleared once and written back;
     * `depthChosen` is the one thing an explicit choice leaves behind, and it
     * is never touched here. The product has no depth at all (below).
     */
    let resolved = stored;
    if (!oneVersion && !stored.depthChosen && stored.mode !== "guided") {
      resolved = { ...stored, mode: "guided" as WorkspaceMode };
      writePrefs(workspaceId, resolved);
    }
    setPrefs(resolved);
    setReady(true);
  }, [oneVersion, workspaceId]);

  const commit = useCallback(
    (next: WorkspacePrefs) => {
      setPrefs(next);
      writePrefs(workspaceId, next);
    },
    [workspaceId],
  );

  const value = useMemo<ShellState>(
    () => ({
      ready,
      /* The product reads its one version, whatever is stored. */
      prefs: oneVersion ? { ...prefs, mode: ONE_VERSION } : prefs,
      /* Choosing marks the choice, which is what makes the migration above
         safe to run exactly once and never against a decision. The product
         has nothing to choose. */
      setMode: (mode) => {
        if (oneVersion) return;
        commit({ ...prefs, mode, depthChosen: true });
      },
      setDensity: (density) => commit({ ...prefs, density }),
      toggleNav: () => commit({ ...prefs, navCollapsed: !prefs.navCollapsed }),
      toggleInspector: () => commit({ ...prefs, inspectorOpen: !prefs.inspectorOpen }),
      setInspector: (open) => commit({ ...prefs, inspectorOpen: open }),
      toggleWidget: (id) =>
        commit({
          ...prefs,
          hidden: prefs.hidden.includes(id)
            ? prefs.hidden.filter((item) => item !== id)
            : [...prefs.hidden, id],
        }),
      isHidden: (id) => prefs.hidden.includes(id),
      moveWidget: (id, direction, ids) => {
        /* The stored order starts empty and means "as registered". The first
           move materialises the current arrangement so the result is the one
           the user is looking at, not a reshuffle of an implicit list. */
        const current = prefs.order.length ? [...prefs.order] : [...ids];
        const from = current.indexOf(id);
        if (from < 0) return;
        const to = from + direction;
        if (to < 0 || to >= current.length) return;
        [current[from], current[to]] = [current[to], current[from]];
        commit({ ...prefs, order: current });
      },
      panelPrefs: (id) => prefs.panels[id] ?? defaultPanelPrefs(),
      reset: () => {
        resetPrefs(workspaceId);
        setPrefs(defaultPrefs());
      },
    }),
    [commit, oneVersion, prefs, ready, workspaceId],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellState {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside ShellStateProvider");
  return value;
}
