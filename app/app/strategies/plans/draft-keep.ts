/**
 * A plan written before its wallet is connected waits in this browser (SOL-C15, UX-702): the audit found a guest
 * filling the builder's fields to the end, then a save row with no button, and on a phone «Відкрити в Phantom»
 * reopening the page in the wallet's own browser with everything gone. Two places hold the draft until it is saved:
 *
 * - this tab's `sessionStorage` — a reload, the header's wallet panel or the proof's signature keep it;
 * - for a guest only, the address's fragment (`#plan-draft=…`) — «Відкрити в Phantom» opens this very address
 *   inside Phantom (`phantomBrowseUrl(window.location.href)`), so the draft travels with it. A fragment never reaches
 *   Ryntra's server, but the address does pass through Phantom's link (phantom.app) when the app does not catch it,
 *   and stays in the browser's history: only what the person writes about the trade travels, never the execution
 *   limits, and a draft that came with a link is said as such.
 *
 * What comes back is checked field by field against a fresh draft of the same form: a field of another type, a
 * value outside its choices or a condition the form cannot draw is dropped and the form's own value stands. Nothing
 * here saves a plan or signs anything; a saved plan clears its draft.
 */

export const DRAFT_FRAGMENT = "plan-draft";
const STORAGE_KEY = "ryntra.plan.draft.v1";
/** A fragment longer than this is not written: the address stays an address. */
const MAX_FRAGMENT = 6_000;

type Kept = Readonly<{ mint: string; draft: unknown }>;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function fromBase64Url(text: string): string | null {
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** The draft and its mint as the fragment carries them. */
export function encodeKept(mint: string, draft: unknown): string {
  return toBase64Url(JSON.stringify({ mint, draft }));
}

/** The fragment's draft, or null when it is not one this form wrote. */
export function decodeKept(raw: string): Kept | null {
  const text = fromBase64Url(raw);
  if (text === null) return null;
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object") return null;
    const { mint, draft } = value as { mint?: unknown; draft?: unknown };
    return typeof mint === "string" && draft && typeof draft === "object" ? { mint, draft } : null;
  } catch {
    return null;
  }
}

/**
 * The kept draft laid over a fresh one: every field the fresh draft has, taken from the kept one only where it is of
 * the same type and `accept` (where it names the field) lets it through; arrays item by item through `acceptItem`.
 * Null when nothing at all could be taken.
 */
export function restoreDraft<T extends Record<string, unknown>>(kept: unknown, fresh: T, rules: Readonly<{ accept?: Partial<Record<keyof T, (value: unknown) => boolean>>; acceptItem?: (value: unknown) => boolean }> = {}): T | null {
  if (!kept || typeof kept !== "object" || Array.isArray(kept)) return null;
  const source = kept as Record<string, unknown>;
  const out: Record<string, unknown> = { ...fresh };
  let taken = 0;
  for (const key of Object.keys(fresh) as (keyof T & string)[]) {
    if (!(key in source)) continue;
    const value = source[key];
    const base = fresh[key];
    if (Array.isArray(base)) {
      if (!Array.isArray(value) || value.length > 10) continue;
      const items = value.filter((item) => (rules.acceptItem ? rules.acceptItem(item) : false));
      if (items.length !== value.length) continue;
      out[key] = items;
    } else if (typeof value === typeof base && (typeof value === "string" || typeof value === "boolean")) {
      if (typeof value === "string" && value.length > 4_000) continue;
      const accept = rules.accept?.[key];
      if (accept && !accept(value)) continue;
      out[key] = value;
    } else {
      continue;
    }
    taken += 1;
  }
  return taken > 0 ? (out as T) : null;
}

/**
 * The fields the address may carry: what the person writes about the trade. The execution limits (slippage, a quote's
 * age, the deviation and liquidity checks, the cost buffer) never travel in a link — a link someone else sent cannot
 * loosen them; they come back only from this tab's own copy.
 */
export const FRAGMENT_FIELDS: ReadonlySet<string> = new Set([
  "thesis", "whyNow", "horizonUnit", "horizonValue", "sources", "assumptions", "entryPrice", "maxPrice", "maxPriceOn",
  "validUntil", "budget", "reserve", "invalidation", "plannedRisk", "target", "timeExit", "conditions",
]);

/** Only the fields the address may carry. */
export function fragmentPart(draft: unknown): Record<string, unknown> {
  if (!draft || typeof draft !== "object") return {};
  return Object.fromEntries(Object.entries(draft as Record<string, unknown>).filter(([key]) => FRAGMENT_FIELDS.has(key)));
}

const storageKey = (mint: string) => `${STORAGE_KEY}:${mint}`;

/**
 * The draft kept for this mint: this tab's own copy first (the latest the person wrote here), then the address's —
 * the draft that came with a link, from another browser, said as such so the person checks it.
 */
export function readKept(mint: string): Readonly<{ draft: unknown; from: "tab" | "link" }> | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(storageKey(mint));
    const kept = stored ? (JSON.parse(stored) as Kept) : null;
    if (kept && kept.mint === mint) return { draft: kept.draft, from: "tab" };
  } catch {
    /* No copy in this tab. */
  }
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/u, "")).get(DRAFT_FRAGMENT);
  const fromFragment = fragment ? decodeKept(fragment) : null;
  return fromFragment && fromFragment.mint === mint ? { draft: fragmentPart(fromFragment.draft), from: "link" } : null;
}

/** How long the address waits after the last change before it is rewritten: a browser bounds how often a page may. */
const FRAGMENT_PAUSE_MS = 600;
let pendingFragment: ReturnType<typeof setTimeout> | null = null;
let pendingWrite: (() => void) | null = null;

function flushFragment(): void {
  if (pendingFragment !== null) clearTimeout(pendingFragment);
  pendingFragment = null;
  const write = pendingWrite;
  pendingWrite = null;
  write?.();
}

if (typeof window !== "undefined") {
  /* Leaving the page — «Відкрити в Phantom» among the ways — writes the address first. */
  window.addEventListener("pagehide", flushFragment);
}

/** Keep the draft in this tab at once, and — for a guest — in the address Phantom would open, a moment after the last change. */
export function keepDraft(mint: string, draft: unknown, guest: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(mint), JSON.stringify({ mint, draft }));
  } catch {
    /* A browser that refuses storage keeps the fragment alone. */
  }
  const encoded = guest ? encodeKept(mint, fragmentPart(draft)) : null;
  /* Written only while the builder's page is still the address: a link inside the app may already have moved on. */
  const page = `${window.location.pathname}${window.location.search}`;
  pendingWrite = () => {
    if (`${window.location.pathname}${window.location.search}` === page) writeFragment(encoded && encoded.length <= MAX_FRAGMENT ? encoded : null);
  };
  if (pendingFragment !== null) clearTimeout(pendingFragment);
  pendingFragment = setTimeout(flushFragment, FRAGMENT_PAUSE_MS);
}

/** The builder leaves (a link inside the app fires no `pagehide`): the address waiting to be written is written now if this is still its page, else dropped. */
export function flushKept(): void {
  if (pendingWrite === null) return;
  flushFragment();
}

/** A saved plan: nothing is kept any more. */
export function clearKept(mint: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey(mint));
  } catch {
    /* Nothing kept there. */
  }
  if (pendingFragment !== null) clearTimeout(pendingFragment);
  pendingFragment = null;
  pendingWrite = null;
  writeFragment(null);
}

function writeFragment(encoded: string | null): void {
  const params = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
  if (encoded === null && !params.has(DRAFT_FRAGMENT)) return;
  if (encoded === null) params.delete(DRAFT_FRAGMENT);
  else params.set(DRAFT_FRAGMENT, encoded);
  const rest = params.toString();
  try {
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${rest ? `#${rest}` : ""}`);
  } catch {
    /* A browser that bounds how often the address changes keeps the tab's copy; the next pause writes again. */
  }
}
