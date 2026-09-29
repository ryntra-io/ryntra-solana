/**
 * What a person was doing when the product asked them to sign in.
 *
 * An account-bound action — saving a plan, keeping a note, turning on an
 * alert — remembers itself here before the login sheet opens, survives the
 * round trip to a provider and back, and is handed to the page once, on
 * return, so the same action reopens with its draft. It lives in
 * `sessionStorage`: this tab, this visit, and nothing of it is sent anywhere.
 *
 * Nothing financial is ever an intent. A swap, a send or a bridge is signed
 * by the wallet at the moment the person confirms it, and no login callback
 * may resume one.
 */
export const INTENT_KINDS = ["save_plan", "journal", "alerts", "settings", "link_wallet", "generic"] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

export type PendingIntent = Readonly<{
  kind: IntentKind;
  /** The path the intent belongs to; it is only handed back on that path. */
  path: string;
  /** A JSON-serializable draft the page knows how to restore. */
  draft: unknown;
  createdAt: number;
}>;

const KEY = "ryntra.account.intent.v1";
const TTL_MS = 30 * 60 * 1000;

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function rememberIntent(input: Readonly<{ kind: IntentKind; path: string; draft?: unknown }>): void {
  const store = storage();
  if (!store) return;
  const intent: PendingIntent = { kind: input.kind, path: input.path, draft: input.draft ?? null, createdAt: Date.now() };
  try {
    store.setItem(KEY, JSON.stringify(intent));
  } catch {
    /* a browser that refuses site data simply has no memory of the intent */
  }
}

export function peekIntent(): PendingIntent | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingIntent>;
    if (
      !INTENT_KINDS.includes(parsed.kind as IntentKind) ||
      typeof parsed.path !== "string" ||
      typeof parsed.createdAt !== "number" ||
      Date.now() - parsed.createdAt > TTL_MS
    ) {
      store.removeItem(KEY);
      return null;
    }
    return { kind: parsed.kind as IntentKind, path: parsed.path, draft: parsed.draft ?? null, createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}

/** Hand the intent back once, for the path it belongs to. */
export function takeIntent(path: string): PendingIntent | null {
  const intent = peekIntent();
  if (!intent || intent.path !== path) return null;
  clearIntent();
  return intent;
}

export function clearIntent(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/** The event a page listens to when its intent is handed back after a login. */
export const INTENT_EVENT = "ryntra:account-intent";

export function dispatchIntent(intent: PendingIntent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PendingIntent>(INTENT_EVENT, { detail: intent }));
}
