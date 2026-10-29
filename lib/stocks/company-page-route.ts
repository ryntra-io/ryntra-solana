/**
 * Which page a company's address opens (UX-503) — pure, so the page, the
 * token's address and the tests read one rule.
 *
 * A token whose issuer opened a swap window keeps a page with the deadline
 * and the swap whatever the catalogues say: when no catalogue lists it (or
 * none answers), `/app/stocks/<its symbol>` — and the same address with
 * `?convert=1`, `?sell=1` or `&from=monitoring` — opens the event's own page,
 * never «not found». Every way in names the token by the symbol the watch
 * writes («SPACEX»): the path strip, a holding's swap and sale, a reminder,
 * the bell, Spot's deadline line, and the token's address.
 */

import { isWatched, type WatchedEvent } from "./conversion-watch.ts";
import type { LifecycleEvent } from "./instrument.ts";
import { LIFECYCLE_EVENTS, lifecycleEventFor, lifecycleEventForTicker } from "./lifecycle-events.ts";

export type CompanyPageAnswer =
  | Readonly<{ kind: "company" }>
  | Readonly<{ kind: "event"; event: WatchedEvent }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "unavailable" }>;

/** What `/app/stocks/<ticker>` shows for the asset read it got: the company, the event's page, «not found», or «read it again». */
export function companyPageAnswer(ticker: string, read: Readonly<{ ok: true }> | Readonly<{ ok: false; code: string }>, events: readonly LifecycleEvent[] = LIFECYCLE_EVENTS): CompanyPageAnswer {
  if (read.ok) return { kind: "company" };
  const event = lifecycleEventForTicker(ticker, events);
  if (isWatched(event)) return { kind: "event", event };
  return read.code === "UNKNOWN_ASSET" ? { kind: "not-found" } : { kind: "unavailable" };
}

/** The page of a watched token — where its address, its holders and Spot's deadline line lead. */
export function eventPagePath(event: WatchedEvent): string {
  return `/app/stocks/${encodeURIComponent(event.watch.symbol)}`;
}

/** Where a pasted address of a watched token goes: its event's page, before Spot; null for every other mint. */
export function eventPageForMint(mint: string): string | null {
  const event = lifecycleEventFor(mint);
  return isWatched(event) ? eventPagePath(event) : null;
}
