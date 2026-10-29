/**
 * The life of Phoenix's data on a page (PERP-4, spec §18 «REST snapshot → WebSocket deltas → local caches … reconnect
 * restores state from fresh snapshots»): a snapshot makes the cache live; deltas keep it live while they come in order;
 * a read that failed, a gap in the deltas or silence past `maxAgeMs` makes it stale — said on screen as «Дані не
 * оновлюються» with the time of the last update, and new risk is closed; a stale cache is never patched back to life by
 * deltas: it recovers from a fresh snapshot only.
 *
 * Today the snapshot is Ryntra's own read of Phoenix's REST (`/api/solana/futures/*`), polled; the deltas' place is
 * kept for the market-data gateway's stream of Phoenix's WebSocket (the browser never opens Phoenix itself). Pure: the
 * page passes the clock — its monotonic one for ages, the wall clock only for the time a person reads.
 */

export type FeedPhase = "cold" | "live" | "stale" | "recovering";

export type FeedState = Readonly<{
  phase: FeedPhase;
  /** When the cache last changed, on the page's monotonic clock (minus the answer's age at the edge); null before any. */
  freshAt: number | null;
  /** The same moment on the wall clock, for «оновлено о …»; null before any. */
  updatedAt: number | null;
  /** The last delta's sequence, to see a gap; null until a delta came. */
  seq: number | null;
}>;

export type FeedEvent =
  /** A whole answer: the cache is this. `ageMs` — how long it waited at the edge. */
  | Readonly<{ kind: "snapshot"; at: number; wall: number; ageMs?: number }>
  /** A change on top of the cache, in order by `seq`. */
  | Readonly<{ kind: "delta"; at: number; wall: number; seq: number }>
  /** A read or the stream failed: what stands is no longer live; the next snapshot recovers it. */
  | Readonly<{ kind: "fail" }>
  /** Time passes: past `maxAgeMs` without a change the cache is stale. */
  | Readonly<{ kind: "tick"; now: number; maxAgeMs: number }>;

export const COLD_FEED: FeedState = { phase: "cold", freshAt: null, updatedAt: null, seq: null };

export function feedStep(state: FeedState, event: FeedEvent): FeedState {
  switch (event.kind) {
    case "snapshot": {
      const age = Math.max(0, event.ageMs ?? 0);
      return { phase: "live", freshAt: event.at - age, updatedAt: event.wall - age, seq: null };
    }
    case "delta":
      /* A delta builds only on a live cache, and only the next one: anything else waits for a fresh snapshot. */
      if (state.phase !== "live") return state;
      if (state.seq !== null && event.seq !== state.seq + 1) return { ...state, phase: "recovering" };
      return { phase: "live", freshAt: event.at, updatedAt: event.wall, seq: event.seq };
    case "fail":
      return state.phase === "cold" ? state : { ...state, phase: "recovering" };
    case "tick":
      if (state.phase === "live" && state.freshAt !== null && event.now - state.freshAt > event.maxAgeMs) return { ...state, phase: "stale" };
      return state;
  }
}

/** Whether what the page shows is not live: stale, or waiting for a fresh snapshot after a failure or a gap. */
export const feedStale = (state: FeedState): boolean => state.phase === "stale" || state.phase === "recovering";

/**
 * How old the markets may be before the page says they stopped, when no read failed (a read that hangs): the edge's own
 * five seconds and as long again while it refetches, and one of the page's five-second polls — a healthy market never
 * flips. A break the page can see — a read that fails — is stale at once (spec §19, scenario 10: a 15-second break).
 */
export const MARKETS_MAX_AGE_MS = 20_000;
