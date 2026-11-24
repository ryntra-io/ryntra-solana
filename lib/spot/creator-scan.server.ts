/**
 * The one door of the creator's tab and the holders' links to Helius's Parsed Events Scan: the deployment's
 * switch, the day's ceiling of credits, the rest after a failure, and the call itself.
 *
 * - **Closed by default.** Only with `RYNTRA_SPOT_CREATOR=on`. Closed, the page shows neither tab and the route reads
 *   nothing. Open, the scan is asked only where the mainnet node is Helius's with its key (`scanEndpointOf`: the same
 *   host and key — nothing new is configured); without it the creator's tab still names the creator and Jupiter's
 *   counts, and the links say the source is quiet.
 * - **What a call costs.** Ten credits, plus one per thousand transactions scanned, each call's scan capped by its own
 *   budget (the creator's ≤ 20 credits, a holder's ≤ 13). The callers say how many calls a read may make.
 * - **A day's ceiling.** One instance spends at most `RYNTRA_SPOT_CREATOR_DAILY_CREDITS` credits on both tabs in a
 *   calendar day (UTC; 15 000 unless set). A read whose worst cost no longer fits is not made: the tab answers as when
 *   the source is quiet. The node's key is the whole site's.
 * - **A failure rests the scan a minute** for both tabs: a source that is down is not asked once per visitor.
 *
 * Reads only: it signs nothing and sends nothing. The key travels inside the node's URL and is never printed — a
 * failure names the host alone.
 */

import { scanEndpointOf, SCAN_HOST, SCAN_PAUSE_MS } from "../core/history/address-history.ts";
import { resolveEndpoints } from "../solana/rpc.ts";
import { scanPageOf, type ScanPage } from "./creator-chain.ts";
import { dayBudget, dayCeilingOf } from "./day-budget.ts";

export const CREATOR_ENV = "RYNTRA_SPOT_CREATOR";
export const CREATOR_ON = "on";
export const CREATOR_DAILY_ENV = "RYNTRA_SPOT_CREATOR_DAILY_CREDITS";
export const CREATOR_DAILY_CREDITS = 15_000;
/** What a call costs before its scan: ten credits. */
export const CALL_CREDITS = 10;
const CALL_TIMEOUT_MS = 6_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

type Env = Readonly<Record<string, string | undefined>>;
export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** Whether the deployment opens the creator's tab and the holders' links. */
export function creatorOpen(env: Env = process.env): boolean {
  return env[CREATOR_ENV]?.trim().toLowerCase() === CREATOR_ON;
}

/** The scan's URL where the tabs are open and the node is Helius's with its key; null otherwise. */
export function creatorScanEndpoint(env: Env = process.env, rpcUrl: string | null | undefined = resolveEndpoints("mainnet")[0]?.url): string | null {
  if (!creatorOpen(env)) return null;
  return scanEndpointOf(rpcUrl);
}

/** The most a call costs whose scan reads at most `budget` transactions. */
export const callCredits = (budget: number): number => CALL_CREDITS + Math.ceil(budget / 1_000);

const day = dayBudget();
let pausedUntil = 0;
/** What the reads cost in this process — for the lead's check of the credits. */
const STATS = { calls: 0, credits: 0, scanned: 0, failures: 0, capped: 0 };

export function creatorScanStats(): Readonly<typeof STATS> {
  return { ...STATS };
}

/** The credits both tabs spent in this instance in the day of `now`. */
export function creatorDaySpent(now: number = Date.now()): number {
  return day.spent(now);
}

/** Test seam: the day starts over and the scan stops resting. */
export function resetCreatorScan(): void {
  day.reset();
  pausedUntil = 0;
  for (const key of Object.keys(STATS) as (keyof typeof STATS)[]) STATS[key] = 0;
}

export type ScanDeps = Readonly<{ fetch?: Fetch; now?: () => number; endpoint?: string | null; env?: Env }>;

/** Thrown inside when the scan cannot be read now; the callers answer as when the source is quiet. */
export class ScanQuiet extends Error {}

/**
 * Whether a read of at most `calls` calls of `budget` each may be made now: the scan open and not resting, and the
 * day's ceiling holding its worst cost. A read that may not be made counts as capped.
 */
export function scanAllows(calls: number, budget: number, deps: ScanDeps = {}): string | null {
  const endpoint = deps.endpoint !== undefined ? deps.endpoint : creatorScanEndpoint(deps.env);
  if (!endpoint) return null;
  const now = (deps.now ?? Date.now)();
  if (now < pausedUntil) return null;
  const ceiling = dayCeilingOf((deps.env ?? process.env)[CREATOR_DAILY_ENV], CREATOR_DAILY_CREDITS);
  if (!day.allows(calls * callCredits(budget), ceiling, now)) {
    STATS.capped += 1;
    return null;
  }
  return endpoint;
}

/** One call of the scan → its page. Paid for once answered, whatever it holds; a failure rests the scan a minute. */
export async function scanCall(endpoint: string, body: Record<string, unknown>, deps: ScanDeps & Readonly<{ until?: number }> = {}): Promise<ScanPage> {
  const now = deps.now ?? Date.now;
  const send = deps.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const wait = Math.min(CALL_TIMEOUT_MS, deps.until === undefined ? CALL_TIMEOUT_MS : deps.until - now());
  if (wait <= 0) throw new ScanQuiet("The scan ran out of time.");
  /* Another read's failure rests the scan for every read: the calls still queued are not made. */
  if (now() < pausedUntil) throw new ScanQuiet("The scan rests after a failure.");
  try {
    let response: Response;
    try {
      response = await send(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(wait), cache: "no-store" });
    } catch {
      /* The fetch's own message can carry the URL, and so the key: the host alone. */
      throw new ScanQuiet(`${SCAN_HOST} did not answer the scan.`);
    }
    const length = Number(response.headers.get("content-length") ?? NaN);
    if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new ScanQuiet(`${SCAN_HOST} answered more than a page may hold.`);
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new ScanQuiet(`${SCAN_HOST} answered more than a page may hold.`);
    if (!response.ok) throw new ScanQuiet(`${SCAN_HOST} answered HTTP ${response.status} to the scan.`);
    STATS.calls += 1;
    day.spend(CALL_CREDITS, now());
    let answer: unknown;
    try {
      answer = JSON.parse(text) as unknown;
    } catch {
      throw new ScanQuiet(`${SCAN_HOST} answered the scan with something other than JSON.`);
    }
    const page = scanPageOf(answer);
    /* The call's ten were counted when it answered; what its scan cost beyond them, now. */
    const charged = page.credits > 0 ? page.credits : CALL_CREDITS + Math.ceil(page.scanned / 1_000);
    day.spend(Math.max(0, charged - CALL_CREDITS), now());
    STATS.credits += charged;
    STATS.scanned += page.scanned;
    return page;
  } catch (failure) {
    STATS.failures += 1;
    pausedUntil = now() + SCAN_PAUSE_MS;
    throw failure instanceof ScanQuiet ? failure : new ScanQuiet("The scan answered something it could not read.");
  }
}

/**
 * Up to `calls` pages of one listing, newest first: the pages read and whether the listing ended within them (the
 * history, or the window, reached). `body` makes a call's body for a cursor.
 */
export async function scanPages(endpoint: string, body: (cursor: string | null) => Record<string, unknown>, calls: number, deps: ScanDeps & Readonly<{ until?: number; enough?: (pages: readonly ScanPage[]) => boolean }> = {}): Promise<Readonly<{ pages: ScanPage[]; whole: boolean }>> {
  const pages: ScanPage[] = [];
  let cursor: string | null = null;
  for (let call = 0; call < calls; call += 1) {
    const page = await scanCall(endpoint, body(cursor), deps);
    pages.push(page);
    if (page.next === null) return { pages, whole: true };
    if (page.next === cursor) throw new ScanQuiet("The scan answered the same cursor twice.");
    cursor = page.next;
    if (deps.enough?.(pages)) break;
  }
  return { pages, whole: false };
}
