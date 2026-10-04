/**
 * The browser's own copy of the last shelf it drew — «копія з кешу»: when
 * the catalogue is still being read on a cold server, a person who has been
 * here before sees the companies they saw last time, marked as updating,
 * instead of a skeleton for seconds.
 *
 * A convenience, never a source: the copy is replaced the moment the live
 * list arrives, it is at most a week old, and a browser that refuses storage
 * simply has no copy.
 */

const KEYS = {
  popular: "ryntra.shelf.popular.v1",
  /* v2: the private cards carry their one number, and a copy kept before could still hold a disconnected issuer's tokens — it is never drawn again. */
  companies: "ryntra.shelf.companies.v2",
  coins: "ryntra.shelf.coins.v1",
  /* Markets' «Меми» tab. */
  memes: "ryntra.shelf.memes.v1",
} as const;

export type ShelfCopyKind = keyof typeof KEYS;

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/* The page's own last copy too, so a browser that refuses storage still has what this visit drew (Home's «Додати правило» reads it). */
const memory = new Map<ShelfCopyKind, unknown>();

export function saveShelfCopy(kind: ShelfCopyKind, value: unknown): void {
  memory.set(kind, value);
  try {
    window.localStorage.setItem(KEYS[kind], JSON.stringify({ savedAt: Date.now(), value }));
  } catch {
    /* A full or refused store costs the next visit its copy, nothing else. */
  }
}

export function readShelfCopy<T>(kind: ShelfCopyKind, accept: (value: unknown) => value is T): T | null {
  const drawn = memory.get(kind);
  if (drawn !== undefined && accept(drawn)) return drawn;
  try {
    const raw = window.localStorage.getItem(KEYS[kind]);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: unknown; value?: unknown };
    if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    return accept(parsed.value) ? parsed.value : null;
  } catch {
    return null;
  }
}
