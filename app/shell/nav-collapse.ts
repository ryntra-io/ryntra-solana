/**
 * Which rail groups a person has closed.
 *
 * Set beside Jupiter's rail, ours had to become compact, with an arrow that
 * hides a group — so the groups get an arrow and close.
 *
 * Two rules, and the second is the one that makes this safe.
 *
 * **A closed group is remembered.** Otherwise the arrow is a toy: you tidy the
 * rail, you open the next page, and the rail is untidy again.
 *
 * **A group is never closed over the page you are on.** Close TRADE, press
 * Swap from somewhere else, and a purely manual rail shows you a column with no
 * current row in it — you are somewhere the navigation does not admit to. So
 * the group holding the open page is forced open, once, when you arrive. That
 * is not the same as refusing to close it: you can still close the group you
 * are standing in, and it stays closed until you leave and come back.
 *
 * It lives in its own leaf module rather than inside the shell component for
 * the reason the rest of this repository puts decisions in leaves: a `.tsx`
 * client component cannot be exercised by `node --test`.
 */

export const NAV_COLLAPSE_KEY = "ryntra.nav.collapsed.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** The stored set, or an empty one for anything that is not a list of strings. */
export function readCollapsedGroups(storage: StorageLike): ReadonlySet<string> {
  try {
    const raw = storage.getItem(NAV_COLLAPSE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    /* A browser with site data blocked still navigates; it just does not
       remember. Losing the preference is a better answer than losing the rail. */
    return new Set();
  }
}

export function writeCollapsedGroups(storage: StorageLike, groups: ReadonlySet<string>): void {
  try {
    storage.setItem(NAV_COLLAPSE_KEY, JSON.stringify([...groups].sort()));
  } catch {
    /* Same. */
  }
}

/**
 * The set after arriving on a page: whatever was stored, minus the group that
 * holds the row the rail has marked current.
 *
 * Returns the *same* set when nothing changes, so a caller can use identity to
 * decide whether to write and re-render.
 */
export function openGroupOfActive(
  collapsed: ReadonlySet<string>,
  groups: readonly Readonly<{ id: string; entries: readonly Readonly<{ href: string | null }>[] }>[],
  activeHref: string | null,
): ReadonlySet<string> {
  if (activeHref === null || collapsed.size === 0) return collapsed;
  const holder = groups.find((group) => group.entries.some((entry) => entry.href === activeHref));
  if (!holder || !collapsed.has(holder.id)) return collapsed;
  const next = new Set(collapsed);
  next.delete(holder.id);
  return next;
}
