/**
 * Local-first workspace layout preferences.
 *
 * The rules this file is written against, in order of how expensive they are to
 * get wrong:
 *
 *   1. A corrupted or hand-edited value must never break the application. Every
 *      read is defensive; anything unrecognised falls back to the default and
 *      the bad value is left alone rather than thrown at the user.
 *   2. Nothing sensitive is stored. No address, no balance, no transaction, no
 *      receipt, no identifier. Layout preferences and nothing else — a browser
 *      key is not a place to duplicate product state.
 *   3. The key is versioned. A future shape change bumps the version and reads
 *      of the old one return defaults instead of half-migrated nonsense.
 *
 * There is no server sync here on purpose. Adding a database migration for a
 * sidebar toggle is the kind of thing that looks harmless and then owns you.
 *
 * v2 (RYN-UI-SYSTEM-001, spec §7): adds workspace Density, and per-panel
 * preferences — a density override, a collapsed flag, and section visibility.
 * v1 values are deliberately not migrated; the old key is left alone and reads
 * of it return defaults, exactly as rule 3 promises.
 *
 * A *workspace id* rename is the one thing that does get migrated, and rule 3
 * is why it has to be. The shape did not change, so the version cannot move;
 * without a rename map a renamed workspace reads as a workspace nobody has
 * preferences for, and every Pro mode, panel order and hidden widget on it
 * silently reverts — the failure `app/shell/workspaces.ts` refuses to risk in
 * as many words: *a display name is copy; an id is a migration.*
 */

export const LAYOUT_STORAGE_KEY = "ryntra.workspace-layout.v2";
export const LAYOUT_SCHEMA_VERSION = 2;

/**
 * Workspace ids that have been renamed, old → new.
 *
 * Append-only, and every entry is permanent: a browser that has not been
 * opened since the rename still holds the old key, and there is no date after
 * which that stops being true.
 *
 * `robinhood-chain` was `tokenized-markets` until 2026-08-19 (`RYN-RHC-002`),
 * when the workspace stopped being a desk that settles on a chain and became
 * the chain, matching the `lib/product/ecosystems.ts` manifest id it had always
 * described.
 */
export const RENAMED_WORKSPACES: Readonly<Record<string, string>> = {
  "tokenized-markets": "robinhood-chain",
};

/**
 * The product's own preference scope, and where it adopts one from.
 *
 * Since the owner decision of 2026-09-04, `solana` and `agent-control` are not
 * two workspaces — they are two domains of one product, and a product that
 * remembers two different Simple/Pro settings for itself is a product nobody
 * can configure. So the shell keys the product's preferences on one id.
 *
 * This is a **merge, not a rename**, and the difference is load-bearing: both
 * source ids are still registered workspaces with live routes, so
 * `RENAMED_WORKSPACES` is the wrong mechanism and a guard says so. Nothing is
 * deleted. The sources keep their records, and a person who somehow reaches one
 * of those surfaces outside the product finds the preference they left there.
 *
 * **The order is the rule, and it is stated rather than inferred.** The first
 * source that has a record gives the product scope its value; `solana` is first
 * because it carries the money surfaces, which is where a person actually chose
 * a depth. The design review rejected the alternative — scanning for
 * "whichever record looks most chosen" — because it silently changes the
 * effective setting of anyone who chose differently in two places.
 *
 * Idempotent by construction: once `ryntra` exists, nothing is copied again.
 *
 * The word this comment does not use is deliberate: a guard forbids it in this
 * module, because a storage key in a wallet product must never look like a
 * place a recovery phrase could live. The rule is right and is left alone.
 */
export const PRODUCT_SCOPE = "ryntra" as const;

export const PRODUCT_SCOPE_SOURCES: readonly string[] = ["solana", "agent-control"];

/** Guided is curated, Standard hides and reorders, Pro adds layout editing. */
export type WorkspaceMode = "guided" | "standard" | "pro";

export const WORKSPACE_MODES: readonly WorkspaceMode[] = ["guided", "standard", "pro"];

/**
 * The three stored values, resolved to the two depths the product has.
 *
 * A pure function rather than an effect, because the effect could only run
 * where the control renders. Once the depth switch moved out of the top bar
 * and into the layout menu, a stored `standard` would have kept resolving to
 * whatever each caller happened to guess until somebody opened that menu — and
 * one of those callers is the rail. Everything asks this instead.
 *
 * `guided` is the only value that means Simple. It is the value an explicit
 * choice writes, and an explicit choice is the only thing that should take a
 * workspace out of its full depth.
 */
export function resolveDepth(mode: WorkspaceMode | string): "guided" | "pro" {
  return mode === "guided" ? "guided" : "pro";
}

export type Density = "comfortable" | "compact";

export const DENSITIES: readonly Density[] = ["comfortable", "compact"];

/**
 * Per-panel preferences.
 *
 * These are parsed and read but currently never written: the controls that
 * wrote them lived on the per-panel `⋮` menu, which is off by founder direction
 * until the surface is approved. The shape stays so a preference saved before
 * the pause survives it, and so turning the menu back on is re-rendering a
 * control rather than re-designing a store.
 */
export type PanelPrefs = {
  /** Overrides the workspace density for one panel; null means inherit. */
  density: Density | null;
  collapsed: boolean;
  /** Section id → visible. Ids absent keep the section's declared default. */
  sections: Record<string, boolean>;
};

export type WorkspacePrefs = {
  mode: WorkspaceMode;
  /**
   * Whether a person has ever chosen a depth, as opposed to inheriting one.
   *
   * It exists because the old default wrote itself into the store. Until
   * 2026-08-24 the repository default was `standard` and `DepthSwitch`
   * normalised it to `guided` **with a write**, so every browser that had ever
   * rendered the control held a stored `guided` that nobody had chosen. Moving
   * the default to `pro` therefore changed nothing for the people who had
   * already used the product — including the founder, who reported the
   * workspace still opening in Simple after the release that was supposed to
   * fix exactly that.
   *
   * A default cannot distinguish itself from a choice after the fact unless
   * something records which it was. This does. `false` plus `guided` is the
   * residue of the old default and is migrated once; `true` is a decision and
   * is never touched again.
   */
  depthChosen: boolean;
  density: Density;
  navCollapsed: boolean;
  inspectorOpen: boolean;
  /** Widget ids the user has switched off in this workspace. */
  hidden: string[];
  /** Explicit widget order. Ids absent from it keep their registered order. */
  order: string[];
  /** Per-panel preferences, keyed by widget id. */
  panels: Record<string, PanelPrefs>;
};

export type LayoutState = {
  version: number;
  byWorkspace: Record<string, WorkspacePrefs>;
};

export function defaultPanelPrefs(): PanelPrefs {
  return { density: null, collapsed: false, sections: {} };
}

export function defaultPrefs(): WorkspacePrefs {
  return {
    /*
     * Simple, matching one hub's 2026-08-25 lock and the Home + Agent Control
     * cleanup: a first visit opens the skeleton. Stored `pro` and `standard`
     * still resolve to Pro. This is a default, not a migration.
     */
    mode: "guided",
    depthChosen: false,
    density: "comfortable",
    navCollapsed: false,
    /* Closed by default. An inspector that is open before it has anything to
       say is just a narrower canvas — it earns its width by being asked for. */
    inspectorOpen: false,
    hidden: [],
    order: [],
    panels: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, 64);
}

const ID_SHAPE = /^[a-z0-9][a-z0-9_-]{0,47}$/;

function parsePanelPrefs(value: unknown): PanelPrefs {
  const base = defaultPanelPrefs();
  if (!isRecord(value)) return base;
  const sections: Record<string, boolean> = {};
  if (isRecord(value.sections)) {
    for (const [id, on] of Object.entries(value.sections)) {
      if (!ID_SHAPE.test(id)) continue;
      if (typeof on !== "boolean") continue;
      sections[id] = on;
      if (Object.keys(sections).length >= 32) break;
    }
  }
  return {
    density: DENSITIES.includes(value.density as Density) ? (value.density as Density) : null,
    collapsed: typeof value.collapsed === "boolean" ? value.collapsed : false,
    sections,
  };
}

/** Coerces anything into a valid preference object. Never throws. */
export function parsePrefs(value: unknown): WorkspacePrefs {
  const base = defaultPrefs();
  if (!isRecord(value)) return base;
  const mode = value.mode;

  const panels: Record<string, PanelPrefs> = {};
  if (isRecord(value.panels)) {
    for (const [id, panel] of Object.entries(value.panels)) {
      if (!ID_SHAPE.test(id)) continue;
      panels[id] = parsePanelPrefs(panel);
      if (Object.keys(panels).length >= 64) break;
    }
  }

  return {
    mode: WORKSPACE_MODES.includes(mode as WorkspaceMode) ? (mode as WorkspaceMode) : base.mode,
    depthChosen: value.depthChosen === true,
    density: DENSITIES.includes(value.density as Density) ? (value.density as Density) : base.density,
    navCollapsed: typeof value.navCollapsed === "boolean" ? value.navCollapsed : base.navCollapsed,
    inspectorOpen: typeof value.inspectorOpen === "boolean" ? value.inspectorOpen : base.inspectorOpen,
    hidden: stringArray(value.hidden),
    order: stringArray(value.order),
    panels,
  };
}

/** Coerces anything into a valid store. Never throws. */
export function parseLayout(raw: unknown): LayoutState {
  const empty: LayoutState = { version: LAYOUT_SCHEMA_VERSION, byWorkspace: {} };
  if (!isRecord(raw)) return empty;
  if (raw.version !== LAYOUT_SCHEMA_VERSION) return empty;
  if (!isRecord(raw.byWorkspace)) return empty;

  const byWorkspace: Record<string, WorkspacePrefs> = {};
  for (const [id, value] of Object.entries(raw.byWorkspace)) {
    /* A workspace id is short and slug-shaped. Anything else is not something
       this application wrote, so it is not something this application reads. */
    if (!/^[a-z0-9-]{1,48}$/.test(id)) continue;
    byWorkspace[id] = parsePrefs(value);
  }

  /* The rename is applied on read, so the next write persists it and the old
     key stops existing. A record already stored under the new id wins and the
     old one is dropped: it is the older of the two by construction, and
     merging two preference sets would invent a third nobody chose. */
  for (const [from, to] of Object.entries(RENAMED_WORKSPACES)) {
    if (!(from in byWorkspace)) continue;
    if (!(to in byWorkspace)) byWorkspace[to] = byWorkspace[from];
    delete byWorkspace[from];
  }

  /* The product scope adopts a value, never takes one. See
     PRODUCT_SCOPE_SOURCES: those workspaces are live and keep their own
     records, so this can only add. */
  if (!(PRODUCT_SCOPE in byWorkspace)) {
    for (const source of PRODUCT_SCOPE_SOURCES) {
      const found = byWorkspace[source];
      if (found && found.depthChosen) {
        byWorkspace[PRODUCT_SCOPE] = found;
        break;
      }
    }
  }

  return { version: LAYOUT_SCHEMA_VERSION, byWorkspace };
}

export function readLayout(): LayoutState {
  if (typeof window === "undefined") return { version: LAYOUT_SCHEMA_VERSION, byWorkspace: {} };
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return { version: LAYOUT_SCHEMA_VERSION, byWorkspace: {} };
    return parseLayout(JSON.parse(raw));
  } catch {
    /* Private mode, a disabled store, a value someone pasted in by hand — all
       of them mean "no preferences", none of them means "fail". */
    return { version: LAYOUT_SCHEMA_VERSION, byWorkspace: {} };
  }
}

export function writeLayout(state: LayoutState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* A full or disabled store must not take the workspace down with it. The
       session simply stops remembering, which the user can see and live with. */
  }
}

export function readPrefs(workspaceId: string): WorkspacePrefs {
  return readLayout().byWorkspace[workspaceId] ?? defaultPrefs();
}

export function writePrefs(workspaceId: string, prefs: WorkspacePrefs): void {
  const state = readLayout();
  state.byWorkspace[workspaceId] = prefs;
  writeLayout(state);
}

/** Removes one workspace's preferences and leaves every other workspace alone. */
export function resetPrefs(workspaceId: string): void {
  const state = readLayout();
  delete state.byWorkspace[workspaceId];
  writeLayout(state);
}
