import {
  MAX_ALERTS,
  MAX_ENTRIES,
  MAX_EVENTS,
  MAX_NOTE,
  isAddress,
  watchKey,
  type WatchAlert,
  type WatchAlertKind,
  type WatchEntry,
  type WatchEvent,
  type WatchEventKind,
  type WatchSeen,
} from "@/lib/markets/watch";

/**
 * Where the watchlist lives, and why it lives there.
 *
 * A saved screen is a *question* — a name and a set of conditions — which is
 * why `RYN-RHC-003` put screens in the URL. A watchlist is not a question. It
 * is a personal ledger with a history, and a URL cannot hold one. There is no
 * account store in this product, so it lives in the browser that made it, and
 * the surface says exactly that rather than implying a synced account it does
 * not have.
 *
 * Every read is defensive to the same standard as `screener/saved.tsx` and
 * `app/shell/layout-store.ts`: this is a value a person can hand-edit, another
 * tab can rewrite, and a private-mode browser can refuse outright. A corrupt
 * value means *no watchlist*, never a crash and never a half-parsed entry — a
 * partially trusted entry is worse than none, because it would reconcile
 * against a history that is not its own.
 */

const KEY = "ryntra.watchlist.v1";

const str = (raw: unknown, max: number): string => (typeof raw === "string" ? raw.slice(0, max) : "");
const num = (raw: unknown): number | null => (typeof raw === "number" && Number.isFinite(raw) ? raw : null);
const bool = (raw: unknown): boolean => raw === true;

const EVENT_KINDS: readonly WatchEventKind[] = [
  "watched",
  "symbol-changed",
  "name-changed",
  "delisted",
  "relisted",
  "verification-granted",
  "verification-withdrawn",
  "class-changed",
  "class-disagreement-appeared",
  "class-disagreement-resolved",
  "route-appeared",
  "route-withdrawn",
  "market-type-appeared",
  "market-type-withdrawn",
  "price-unavailable",
  "price-restored",
  "corporate-action-applied",
  "corporate-action-scheduled",
  "oracle-paused",
  "oracle-resumed",
  "alert-fired",
];

const ALERT_KINDS: readonly WatchAlertKind[] = [
  "price-moves",
  "underlying-closes",
  "route-appears",
  "corporate-action",
  "spread-exceeds",
  "depth-passes",
  "strategy-condition",
];

function parseEvent(raw: unknown): WatchEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const kind = value.kind;
  const at = num(value.at);
  if (typeof kind !== "string" || !EVENT_KINDS.includes(kind as WatchEventKind) || at === null) return null;
  const source = value.source as Record<string, unknown> | undefined;
  if (!source || typeof source.feed !== "string" || typeof source.field !== "string") return null;
  return {
    kind: kind as WatchEventKind,
    at,
    recordedAt: num(value.recordedAt) ?? at,
    headline: str(value.headline, 240),
    observed: typeof value.observed === "string" ? value.observed.slice(0, 160) : null,
    source: { feed: source.feed.slice(0, 80), field: source.field.slice(0, 80), observedAt: num(source.observedAt) ?? at },
  };
}

function parseSeen(raw: unknown): WatchSeen | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const reference = value.reference as Record<string, unknown> | null | undefined;
  const referencePrice = reference ? num(reference.price) : null;
  const instrumentClass = value.instrumentClass;
  return {
    symbol: str(value.symbol, 24),
    name: str(value.name, 80),
    listed: bool(value.listed),
    venueVerified: bool(value.venueVerified),
    instrumentClass:
      instrumentClass === "STOCK_TOKEN" || instrumentClass === "GENERIC_ERC20" || instrumentClass === "COMMUNITY_TOKEN"
        ? instrumentClass
        : null,
    classAgreed: value.classAgreed !== false,
    routes: Array.isArray(value.routes) ? value.routes.filter((r): r is string => typeof r === "string").slice(0, 8) : [],
    marketTypes: Array.isArray(value.marketTypes)
      ? value.marketTypes.filter((t): t is "spot" | "perp" => t === "spot" || t === "perp")
      : [],
    priced: bool(value.priced),
    reference: referencePrice === null ? null : { price: referencePrice, at: num(reference?.at) ?? 0 },
    uiMultiplier: typeof value.uiMultiplier === "string" ? value.uiMultiplier.slice(0, 40) : null,
    corporateActionAt: num(value.corporateActionAt),
    scheduledAction: bool(value.scheduledAction),
    oraclePaused: typeof value.oraclePaused === "boolean" ? value.oraclePaused : null,
  };
}

function parseEntry(raw: unknown): WatchEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (!isAddress(value.address)) return null;
  const seen = parseSeen(value.seen);
  if (!seen) return null;

  const alerts: WatchAlert[] = [];
  if (Array.isArray(value.alerts)) {
    for (const candidate of value.alerts.slice(0, MAX_ALERTS)) {
      if (!candidate || typeof candidate !== "object") continue;
      const kind = (candidate as Record<string, unknown>).kind;
      if (typeof kind !== "string" || !ALERT_KINDS.includes(kind as WatchAlertKind)) continue;
      alerts.push({ kind: kind as WatchAlertKind, threshold: num((candidate as Record<string, unknown>).threshold) });
    }
  }

  const history = Array.isArray(value.history)
    ? value.history
        .map(parseEvent)
        .filter((event): event is WatchEvent => event !== null)
        .slice(-MAX_EVENTS)
    : [];

  return {
    address: watchKey(value.address),
    addedAt: num(value.addedAt) ?? 0,
    note: str(value.note, MAX_NOTE),
    alerts,
    seen,
    history,
    dropped: Math.max(0, num(value.dropped) ?? 0),
  };
}

export function readWatchlist(): WatchEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries: WatchEntry[] = [];
    const seenKeys = new Set<string>();
    for (const candidate of parsed) {
      const entry = parseEntry(candidate);
      if (!entry || seenKeys.has(entry.address)) continue;
      seenKeys.add(entry.address);
      entries.push(entry);
      if (entries.length >= MAX_ENTRIES) break;
    }
    return entries;
  } catch {
    /* Private mode, a disabled store, a value someone pasted by hand — every
       one of them means "no watchlist", none of them means "fail". */
    return [];
  }
}

export function writeWatchlist(entries: readonly WatchEntry[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* A full or disabled store must not take the page down with it. */
  }
}

export const WATCHLIST_KEY = KEY;
