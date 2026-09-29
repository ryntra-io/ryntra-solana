/**
 * The module vocabulary.
 *
 * Seven words for the whole product: **overview, radar, portfolio, treasury,
 * strategy, journal, settings.** A workspace may enable a module, disable it,
 * or mark it Pro-only. Workspaces that do not declare `treasury` simply do
 * not render it. Overview and Radar were one word until one hub's Guided rail had
 * to name Mission Control without calling it Radar.
 *
 * That restriction is the entire content of this file, and it is worth saying
 * why it is a restriction rather than a suggestion. Before it, every workspace
 * wrote its own rail. One hub's read `Workspace / Execute / System`, Home's read
 * `Home / Review / System`, Agent Control's was one flat list, Stellar and
 * Solana generated zones from their own registries. Five products, five
 * grammars, and a person who learned one of them had learned nothing about the
 * next. `Receipts` lived under `Prove` in that hub and under `Review` in Home; the
 * same idea, filed in two different drawers, in one application.
 *
 * The names are not descriptions of pages — they are questions:
 *
 *   radar      what is out there and what needs me
 *   portfolio  what I hold and where the value went
 *   treasury   payouts, recipients and batches that move value for a desk
 *   strategy   the rules that act on my behalf
 *   journal    what happened, and the proof of it
 *   settings   how all of that is configured
 *
 * `settings` is separated from the other four everywhere it is rendered,
 * because the frozen UX System fixes it bottom-left. It is in this list so a
 * manifest can point it at a route; it is never in the same visual group.
 *
 * What does **not** belong here: actions. `Send`, `Swap`, `Trade` and
 * `Authorize` are Action Console drawers opened from a surface, not permanent
 * destinations, and giving them rail entries is what turned a rail into a menu
 * of verbs. Their routes survive as deep links during migration — see the
 * `deepLinks` field — but they do not get a place in the skeleton.
 */

import type { NavEntry, NavGroup } from "./workspaces";

/* ---------------------------------------------------------------- vocabulary */

/**
 * The six, in their fixed rail order. Settings is pinned, not in this list's
 * visible group — `RAIL_MODULE_IDS` drops it.
 *
 * The order is data rather than prose for the same reason the connection
 * states are: it is asserted by tests, and a workspace cannot reorder it by
 * declaring its manifest in a different sequence — `navigationFromManifest`
 * sorts by this array, not by declaration order.
 */
export const MODULE_IDS = [
  "overview",
  "radar",
  "portfolio",
  "treasury",
  "strategy",
  "journal",
  "settings",
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

/** The four that render in the main rail. `settings` is pinned separately. */
export const RAIL_MODULE_IDS = MODULE_IDS.filter((id) => id !== "settings");

/**
 * What each module is called when a workspace does not override it.
 *
 * A workspace *may* override a label. What it may not do is move the concept
 * somewhere else in the rail. The label is copy; the position is the contract.
 */
export const MODULE_LABELS: Readonly<Record<ModuleId, string>> = {
  overview: "Overview",
  radar: "Radar",
  portfolio: "Portfolio",
  treasury: "Treasury",
  strategy: "Strategy",
  journal: "Journal",
  settings: "Settings",
};

/* ------------------------------------------------------------------ manifest */

/**
 * One module, as a workspace declares it.
 *
 * `href` is where the module itself lands. `entries` are the surfaces inside
 * it, shown when the workspace is in Pro depth; Simple shows the module alone.
 * That is the whole depth mechanism in the rail — same skeleton, more of it —
 * rather than two separately authored navigations that can disagree.
 */
export type ModuleDefinition = Readonly<{
  id: ModuleId;
  /** Overrides `MODULE_LABELS`. Use only where the default genuinely misleads. */
  label?: string;
  /** Overrides the icon the module id would otherwise resolve to. */
  icon?: string;
  href: string;
  /**
   * What the module's own page calls itself, where that differs from the
   * concept: Overview opens "Mission control"; Portfolio used to open
   * Asset passports and now opens money.
   *
   * **Declared and deliberately unused.** Rendering it as a row under a group
   * heading named by the concept was tried on 2026-08-24 and looked worse than
   * the mismatch it fixed — two headings per group, the louder one naming the
   * page. The mismatch is real and its answer belongs on the page rather than
   * in the rail: the destination should say which module it is in. The field
   * stays so the next attempt starts from the manifest instead of rediscovering
   * that four of five modules disagree with their own landing page.
   */
  landingLabel?: string;
  /** Surfaces inside this module, revealed in Pro. */
  entries?: readonly NavEntry[];
  /**
   * When true, Simple omits the module and Pro shows it. Treasury is the
   * first use: a first-time rail that grew a seventh word hid money behind
   * a desk the visitor had not asked for.
   */
  proOnly?: boolean;
}>;

/**
 * A workspace's projection of the skeleton.
 *
 * `deepLinks` is the migration seam the standard asks for: an action route that
 * used to be a rail destination stays reachable and stays working, it simply
 * stops being a place in the navigation. Deleting those routes in the same
 * change that moves the action into a drawer would put a shell refactor and a
 * routing change on the same commit, and only one of them is safe to get wrong.
 */
export type WorkspaceManifest = Readonly<{
  workspaceId: string;
  modules: readonly ModuleDefinition[];
  /** Where the workspace opens. Must be one of the modules' routes. */
  defaultLanding: string;
  /** Action routes kept alive as deep links while their drawers are built. */
  deepLinks?: readonly string[];
}>;

/* ------------------------------------------------------------------ renderer */

export type ModuleDepth = "simple" | "pro";

/**
 * Project a manifest into the shell's navigation groups.
 *
 * Two guarantees the tests hold this to.
 *
 * **Order comes from `MODULE_IDS`, not from the manifest.** A workspace that
 * lists portfolio before radar still renders radar first. There is no way for a
 * workspace to reorder the skeleton, which means there is no way for one to
 * drift out of it by accident.
 *
 * **`settings` is never in the returned groups.** It is pinned bottom-left by
 * the shell and comes back from `settingsEntry` instead. Returning it here
 * would let a caller render it inline and quietly break the one position the
 * frozen UX System fixes by name.
 */
export function navigationFromManifest(
  manifest: WorkspaceManifest,
  depth: ModuleDepth = "simple",
): readonly NavGroup[] {
  const byId = new Map(manifest.modules.map((entry) => [entry.id, entry]));

  const modules: Array<{ id: ModuleId; title: string; entries: NavEntry[] }> = [];
  for (const id of RAIL_MODULE_IDS) {
    const declared = byId.get(id);
    if (!declared) continue;
    if (declared.proOnly && depth !== "pro") continue;
    const title = declared.label ?? MODULE_LABELS[id];
    const entries: NavEntry[] = [
      {
        id,
        label: title,
        href: declared.href,
        icon: declared.icon ?? id,
      },
    ];
    if (depth === "pro" && declared.entries) {
      /* `sub` is marked here rather than by each workspace, so a manifest
         cannot ship a sub-entry that renders as a module. */
      entries.push(...declared.entries.map((entry) => ({ ...entry, sub: true })));
    }
    modules.push({ id, title, entries });
  }

  if (modules.length === 0) return [];

  /* Simple is one block of four; Pro is one block per module.
   *
   * Both used to be a single group, and in Pro that is what the founder was
   * looking at when they said the rail was *«вся в кучу змішане»* — fourteen
   * rows in one column, every module and every surface inside it sharing one
   * uninterrupted list, with no boundary between `Providers` and `Portfolio`.
   * Indenting the children was not enough: indentation says "under", and what
   * was missing was "and here the next one starts". A group is the shell's own
   * separator, so this returns the structure and `shell.css` draws it — one
   * place decides the skeleton, one place decides how it looks.
   *
   * Order still comes from `MODULE_IDS` either way, and a Pro module with no
   * surfaces inside it is still its own group rather than being collected
   * somewhere else, because moving it would reorder the skeleton to save a
   * separator. */
  if (depth === "pro") {
    return modules.map((module) => ({ id: module.id, entries: module.entries }));
  }

  return [{ id: "modules", entries: modules.flatMap((module) => module.entries) }];
}

/**
 * The pinned Settings entry, or `null` for a workspace that has none.
 *
 * Separate from the groups above so that "Settings is bottom-left" is something
 * the shell does structurally rather than something each workspace remembers.
 */
export function settingsEntry(manifest: WorkspaceManifest): NavEntry | null {
  const declared = manifest.modules.find((entry) => entry.id === "settings");
  if (!declared) return null;
  return {
    id: "settings",
    label: declared.label ?? MODULE_LABELS.settings,
    href: declared.href,
    icon: declared.icon ?? "settings",
  };
}
