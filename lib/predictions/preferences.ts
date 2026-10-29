/**
 * How a person has set Ryntra Predictions up for themselves: the units a
 * chance is printed in, the amount a ticket starts from, the side the ticket
 * stands on, the menu's width, the density, the layout in use and the hub's
 * columns and categories. One mode for everyone — every one of these is a
 * choice anyone can make, none hides a function.
 *
 * The profile is plain JSON: kept in a first-party cookie so the server draws
 * the first frame the person's way, and, for a person signed in with a
 * wallet, in their account too, so it follows them to another device. Of two
 * copies the later change wins.
 *
 * Pure: the browser and the server read it the same way.
 */

export type ChanceUnits = "payout" | "percent" | "cents" | "odds";
export type TicketSide = "right" | "left";
export type MenuStyle = "full" | "icons";
export type Density = "regular" | "compact";
export type HubColumns = 2 | 3 | 4;
export type LayoutSlot = 1 | 2 | 3;

export type HubPrefs = Readonly<{
  columns: HubColumns;
  /** Category slugs in the order the person put them; categories not named keep the provider's order after them. */
  order: readonly string[];
  /** Category slugs the person put away; they come back from the hub's settings. */
  hidden: readonly string[];
}>;

export type PredictPrefs = Readonly<{
  v: 1;
  units: ChanceUnits;
  /** What a ticket starts from, and what «Купуєш на $X…» is worked out for. */
  amountUsd: number;
  side: TicketSide;
  menu: MenuStyle;
  density: Density;
  slot: LayoutSlot;
  hub: HubPrefs;
  /** When the person last changed anything here (ms since 1970); 0 — never. */
  updatedAt: number;
  /**
   * When each choice was last made: two devices that changed different
   * choices both keep theirs, and of two changes of one choice the later wins.
   */
  at: Readonly<Partial<Record<PrefField, number>>>;
}>;

/** The choices dated one by one; the hub's three are separate choices. */
export type PrefField = "units" | "amountUsd" | "side" | "menu" | "density" | "slot" | "hub.columns" | "hub.order" | "hub.hidden";
export const PREF_FIELDS: readonly PrefField[] = Object.freeze(["units", "amountUsd", "side", "menu", "density", "slot", "hub.columns", "hub.order", "hub.hidden"]);

export const CHANCE_UNITS: readonly ChanceUnits[] = Object.freeze(["payout", "percent", "cents", "odds"]);
export const TICKET_SIDES: readonly TicketSide[] = Object.freeze(["right", "left"]);
export const MENU_STYLES: readonly MenuStyle[] = Object.freeze(["full", "icons"]);
export const DENSITIES: readonly Density[] = Object.freeze(["regular", "compact"]);
export const HUB_COLUMNS: readonly HubColumns[] = Object.freeze([2, 3, 4]);
export const LAYOUT_SLOTS: readonly LayoutSlot[] = Object.freeze([1, 2, 3]);

export const AMOUNT_MIN = 1;
export const AMOUNT_MAX = 100_000;
const CATEGORY_LIMIT = 64;
/* The provider's category slugs, as it writes them: letters, digits and a few joiners. */
const SLUG = /^[\p{L}\p{N}][\p{L}\p{N} _.:&'/-]{0,63}$/u;

export const DEFAULT_PREFS: PredictPrefs = Object.freeze({
  v: 1,
  units: "percent",
  amountUsd: 10,
  side: "right",
  menu: "full",
  density: "regular",
  slot: 1,
  hub: Object.freeze({ columns: 4, order: Object.freeze([]), hidden: Object.freeze([]) }),
  updatedAt: 0,
  at: Object.freeze({}),
}) as PredictPrefs;

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);

function slugs(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && SLUG.test(item) && !seen.has(item)) seen.add(item);
    if (seen.size >= CATEGORY_LIMIT) break;
  }
  return [...seen];
}

/** A whole number of dollars between the bounds, or null. */
export function cleanAmount(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const whole = Math.round(n);
  return whole >= AMOUNT_MIN && whole <= AMOUNT_MAX ? whole : null;
}

/**
 * A profile read from a cookie, the account or a request, rebuilt field by
 * field: what cannot be read falls back to its default, anything else on it
 * is left behind.
 */
const date = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);

export function parsePrefs(value: unknown): PredictPrefs {
  if (!isObject(value) || value.v !== 1) return DEFAULT_PREFS;
  const hub = isObject(value.hub) ? value.hub : {};
  const given = isObject(value.at) ? value.at : {};
  const at: Partial<Record<PrefField, number>> = {};
  for (const field of PREF_FIELDS) if (date(given[field]) > 0) at[field] = date(given[field]);
  // The copy's date is never earlier than any of its choices.
  const updatedAt = Math.max(date(value.updatedAt), ...Object.values(at));
  return {
    v: 1,
    /* Payouts were the default once: a copy that only carried that default, never chose it, opens with the market's estimate. */
    units: value.units === "payout" && !at.units ? DEFAULT_PREFS.units : pick(value.units, CHANCE_UNITS, DEFAULT_PREFS.units),
    amountUsd: cleanAmount(value.amountUsd) ?? DEFAULT_PREFS.amountUsd,
    side: pick(value.side, TICKET_SIDES, DEFAULT_PREFS.side),
    menu: pick(value.menu, MENU_STYLES, DEFAULT_PREFS.menu),
    density: pick(value.density, DENSITIES, DEFAULT_PREFS.density),
    slot: pick(value.slot, LAYOUT_SLOTS, DEFAULT_PREFS.slot),
    hub: { columns: pick(hub.columns, HUB_COLUMNS, DEFAULT_PREFS.hub.columns), order: slugs(hub.order), hidden: slugs(hub.hidden) },
    updatedAt,
    at,
  };
}

/** The later of two copies; the first on a tie. */
export function newerPrefs(a: PredictPrefs | null, b: PredictPrefs | null): PredictPrefs | null {
  if (!a) return b;
  if (!b) return a;
  return b.updatedAt > a.updatedAt ? b : a;
}

type FieldValue = PredictPrefs[keyof PredictPrefs] | HubPrefs[keyof HubPrefs];

function valueOf(prefs: PredictPrefs, field: PrefField): FieldValue {
  return field.startsWith("hub.") ? prefs.hub[field.slice(4) as keyof HubPrefs] : prefs[field as keyof PredictPrefs];
}

/** When a choice was made: its own date, or — for a copy written before choices were dated — the copy's. */
function madeAt(prefs: PredictPrefs, field: PrefField): number {
  return prefs.at[field] ?? (Object.keys(prefs.at).length === 0 ? prefs.updatedAt : 0);
}

/**
 * Two copies made one, choice by choice: each choice from the copy that made
 * it later (the first on a tie). A device that changed the units and another
 * that changed the density both keep their change.
 */
export function mergePrefs(a: PredictPrefs | null, b: PredictPrefs | null): PredictPrefs | null {
  if (!a) return b;
  if (!b) return a;
  if (!hasNewer(a, b)) return a;
  const merged: Record<string, unknown> = { ...a, hub: { ...a.hub } };
  const at: Partial<Record<PrefField, number>> = {};
  for (const field of PREF_FIELDS) {
    const mine = madeAt(a, field);
    const theirs = madeAt(b, field);
    if (theirs > mine) {
      if (field.startsWith("hub.")) (merged.hub as Record<string, unknown>)[field.slice(4)] = valueOf(b, field);
      else merged[field] = valueOf(b, field);
    }
    const when = Math.max(mine, theirs);
    if (when > 0) at[field] = when;
  }
  return parsePrefs({ ...merged, at, updatedAt: Math.max(a.updatedAt, b.updatedAt) });
}

/** Whether `b` holds a choice made later than `a`'s. */
export function hasNewer(a: PredictPrefs, b: PredictPrefs | null): boolean {
  return !!b && PREF_FIELDS.some((field) => madeAt(b, field) > madeAt(a, field));
}

/** When the side was last chosen: a layout kept before it is turned to it. */
export function sideChosenAt(prefs: PredictPrefs): number {
  return madeAt(prefs, "side");
}

/** A change of the person's, the choices it touches dated now. */
export function changePrefs(prefs: PredictPrefs, patch: Partial<Omit<PredictPrefs, "v" | "updatedAt" | "at">>, now: number): PredictPrefs {
  const at: Partial<Record<PrefField, number>> = { ...prefs.at };
  for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
    if (key === "hub") {
      const hub = (patch.hub ?? {}) as Record<string, unknown>;
      for (const part of Object.keys(hub)) {
        const field = `hub.${part}` as PrefField;
        if (PREF_FIELDS.includes(field) && JSON.stringify(hub[part]) !== JSON.stringify(prefs.hub[part as keyof HubPrefs])) at[field] = now;
      }
    } else if (PREF_FIELDS.includes(key as PrefField)) {
      at[key as PrefField] = now;
    }
  }
  return parsePrefs({ ...prefs, ...patch, hub: { ...prefs.hub, ...(patch.hub ?? {}) }, v: 1, updatedAt: now, at });
}

/**
 * This browser's copy with the account's dates taken for the choices both
 * hold alike: a device whose clock runs ahead stops sending the same choice
 * again and again, dated ahead of everyone else's.
 */
export function alignDates(mine: PredictPrefs, account: PredictPrefs): PredictPrefs {
  let changed = false;
  const at: Partial<Record<PrefField, number>> = { ...mine.at };
  for (const field of PREF_FIELDS) {
    const theirs = account.at[field];
    const own = mine.at[field];
    if (theirs === undefined || own === undefined || theirs >= own) continue;
    if (JSON.stringify(valueOf(mine, field)) !== JSON.stringify(valueOf(account, field))) continue;
    at[field] = theirs;
    changed = true;
  }
  return changed ? { ...mine, at, updatedAt: Math.min(mine.updatedAt, Math.max(account.updatedAt, ...Object.values(at))) } : mine;
}

/** A copy dated no later than `limit`: a device whose clock runs ahead does not win for as long as it is ahead. */
export function clampPrefs(prefs: PredictPrefs, limit: number): PredictPrefs {
  const at: Partial<Record<PrefField, number>> = {};
  for (const [field, when] of Object.entries(prefs.at) as [PrefField, number][]) at[field] = Math.min(when, limit);
  return { ...prefs, at, updatedAt: Math.min(prefs.updatedAt, limit) };
}

/* ── The first-party cookie: the profile's local copy, readable by the server's first frame ── */

export const PREFS_COOKIE = "ryntra-predict-prefs";

export function encodePrefsCookie(prefs: PredictPrefs): string {
  return encodeURIComponent(JSON.stringify(prefs));
}

/** The profile from a `Cookie` header or `document.cookie`; null when there is none or it cannot be read. */
export function prefsFromCookie(cookies: string | null | undefined): PredictPrefs | null {
  for (const part of (cookies ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== PREFS_COOKIE) continue;
    try {
      const parsed = JSON.parse(decodeURIComponent(rest.join("=")));
      return isObject(parsed) && parsed.v === 1 ? parsePrefs(parsed) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/* ── The hub's categories, in the person's order ── */

/**
 * The categories as the hub draws them: the ones the person ordered first, in
 * their order, then the rest in the provider's; the ones put away are left out.
 */
export function arrangeCategories<T extends Readonly<{ slug: string }>>(categories: readonly T[], hub: HubPrefs): readonly T[] {
  const hidden = new Set(hub.hidden);
  const rank = new Map(hub.order.map((slug, index) => [slug, index]));
  return categories
    .map((category, index) => ({ category, index }))
    .filter(({ category }) => !hidden.has(category.slug))
    .sort((a, b) => (rank.get(a.category.slug) ?? hub.order.length + a.index) - (rank.get(b.category.slug) ?? hub.order.length + b.index))
    .map(({ category }) => category);
}

/** One category moved up or down among the given ones; the full order is written so it stays put. */
export function moveCategory(slugsInView: readonly string[], slug: string, step: 1 | -1): readonly string[] {
  const from = slugsInView.indexOf(slug);
  const to = from + step;
  if (from < 0 || to < 0 || to >= slugsInView.length) return slugsInView;
  const next = [...slugsInView];
  [next[from], next[to]] = [next[to] as string, next[from] as string];
  return next;
}

/* ── The market page's layouts: three of them, each kept on its own ── */

/** The page a slot's layout is kept under, in the browser and in the account. */
export function layoutPage(slot: LayoutSlot): string {
  return `predict-market-${slot}`;
}

/** The slot a layout page is kept for; null for a page that is none of the three. */
export function slotOfPage(page: string): LayoutSlot | null {
  const match = /^predict-market-([123])$/.exec(page);
  return match ? (Number(match[1]) as LayoutSlot) : null;
}

const PAGE = /^predict-[a-z0-9-]{1,40}$/;
export const LAYOUT_PAGES_LIMIT = 8;
/** A layout as the account keeps it: the arrangement only, bounded. */
export const LAYOUT_BYTES_LIMIT = 24_000;

export function isLayoutPage(value: unknown): value is string {
  return typeof value === "string" && PAGE.test(value);
}

/**
 * A layout the account may keep: the shape the workspace writes (version 1, a
 * date of change) and no larger than an arrangement can be. The browser reads
 * it back through the workspace's own parser, which keeps known fields only.
 */
export function storableLayout(value: unknown): Record<string, unknown> | null {
  if (!isObject(value) || value.v !== 1 || !Array.isArray(value.blocks) || value.blocks.length > 32) return null;
  if (typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt) || value.updatedAt < 0) return null;
  // The workspace's own fields only; the browser rebuilds even these through the workspace's parser.
  const known: Record<string, unknown> = { v: 1, preset: value.preset, blocks: value.blocks, updatedAt: value.updatedAt };
  if (isObject(value.dock)) known.dock = value.dock;
  if (isObject(value.before)) known.before = value.before;
  let text: string;
  try {
    text = JSON.stringify(known);
  } catch {
    return null;
  }
  return text.length <= LAYOUT_BYTES_LIMIT ? (JSON.parse(text) as Record<string, unknown>) : null;
}

export function layoutDate(value: unknown): number {
  return isObject(value) && typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : -1;
}
