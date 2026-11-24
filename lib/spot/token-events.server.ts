/**
 * The coin's trades from Helius Parsed Events Scan over its mint address: the second source of the coin
 * page's trades, behind a closed switch.
 *
 * - **Closed by default.** It reads only when the deployment says `RYNTRA_SPOT_TOKEN_EVENTS=helius` and the mainnet
 *   node is Helius's with its key (`scanEndpointOf`, the same host and key as the node — nothing new is configured).
 *   Otherwise it answers null and the page reads GeckoTerminal as before.
 * - **What it costs.** A call is 10 credits plus one per thousand transactions scanned, its scan capped at
 *   `EVENTS_SCAN_BUDGET` (≤ 13 credits). A first read of a coin takes up to `MAX_CALLS` calls; a refresh of a coin
 *   read before asks one call for what is newer than its newest trade and merges it.
 * - **Whole or not.** A read that reached the end of the mint's history says so (`whole`): the coin's every trade is
 *   in the list, and its traders' table is the whole history.
 * - **Never half a row.** A swap of the coin without a price — its payment not in the transaction, or its price far
 *   off its neighbours' (`splitOffMarket`) — is not in `trades`: it is in `unpriced`, for the page to price from the
 *   pools' trades or leave out.
 * - **A day's ceiling.** One instance spends at most `RYNTRA_SPOT_TOKEN_EVENTS_DAILY_CREDITS` credits in a calendar
 *   day (UTC; 20 000 unless set): a read whose worst cost no longer fits is not made, and the page reads GeckoTerminal
 *   as when the scan is closed — nothing fails and nothing is said. The node's key is the whole site's.
 * - **Never instead of an answer.** A refusal, a malformed answer or a slow one throws inside and answers null; the
 *   scan then rests a minute and the page reads GeckoTerminal at once.
 *
 * Reads only: it signs nothing and sends nothing; the key travels inside the node's URL and is never printed — a
 * failure names the host alone.
 */

import { scanEndpointOf, SCAN_HOST, SCAN_PAUSE_MS } from "../core/history/address-history.ts";
import { resolveEndpoints } from "../solana/rpc.ts";
import { dayBudget, dayCeilingOf } from "./day-budget.ts";
import type { TokenTrade } from "./token-page.ts";
import { EVENTS_SCAN_BUDGET, EventsMalformed, eventsBody, mergeTrades, splitOffMarket, tradesOfEvents, unpricedOf, type EventsPricing, type UnpricedTrade } from "./token-events.ts";

export const TOKEN_EVENTS_ENV = "RYNTRA_SPOT_TOKEN_EVENTS";
export const TOKEN_EVENTS_ON = "helius";
/** The most credits one instance spends on the scan in a calendar day (UTC). */
export const TOKEN_EVENTS_DAILY_ENV = "RYNTRA_SPOT_TOKEN_EVENTS_DAILY_CREDITS";
export const TOKEN_EVENTS_DAILY_CREDITS = 20_000;
/** What a call costs: ten credits, and one more per thousand transactions scanned. */
const CALL_CREDITS = 10;
const CALL_CREDITS_MOST = CALL_CREDITS + Math.ceil(EVENTS_SCAN_BUDGET / 1_000);

/** Trades one list keeps: as many as GeckoTerminal's page gives, so the screens see the same depth. */
export const EVENTS_TRADES_TARGET = 300;
/** Calls one first read may make: at most ~40 credits. */
export const MAX_CALLS = 3;
const READ_DEADLINE_MS = 7_000;
const CALL_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

type Env = Readonly<Record<string, string | undefined>>;
type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** The scan's URL when the switch is on and the node is Helius's with its key; null otherwise. */
export function tokenEventsEndpoint(env: Env = process.env, rpcUrl: string | null | undefined = resolveEndpoints("mainnet")[0]?.url): string | null {
  if (env[TOKEN_EVENTS_ENV]?.trim().toLowerCase() !== TOKEN_EVENTS_ON) return null;
  return scanEndpointOf(rpcUrl);
}

export type EventsRead = Readonly<{
  /** Whole trades only: each with its size, its dollars and its price. */
  trades: readonly TokenTrade[];
  /** Swaps of the coin this read could not price: not rows, unless the pools' trades price them. */
  unpriced: readonly UnpricedTrade[];
  /** The list reaches the start of the mint's history: nothing older exists. */
  whole: boolean;
  /** The read laid what is newer over the list read before (`known`), rather than reading the coin afresh. */
  refreshed: boolean;
  calls: number;
  scanned: number;
  credits: number;
}>;

/** What the reads cost in this process — for the lead's check of the credits. */
const STATS = { reads: 0, refreshes: 0, calls: 0, credits: 0, scanned: 0, failures: 0, capped: 0, unpriced: 0 };
export function tokenEventsStats(): Readonly<typeof STATS> {
  return { ...STATS };
}

let pausedUntil = 0;
/** The day's credits of this instance. */
const day = dayBudget();

/** What a scanned page cost, counted once: the call's ten credits were counted when it answered. */
function spendPage(credits: number, now: number): void {
  STATS.credits += credits;
  day.spend(credits - CALL_CREDITS, now);
}

class EventsUnavailable extends Error {}

const keyOf = (trade: Readonly<{ signature: string; side: string }>): string => `${trade.signature}:${trade.side}`;

/**
 * The list a read answers with: the trades at the market's price, and beside them everything that has none. `fresh` —
 * the trades this read brought (a refresh): only they are held against their neighbours, so a trade the list already
 * keeps — one a pool's trade priced among them — is not judged again at every refresh.
 */
function settle(all: readonly TokenTrade[], unpriced: readonly UnpricedTrade[], fresh: readonly TokenTrade[] | null = null): Readonly<{ trades: TokenTrade[]; unpriced: UnpricedTrade[] }> {
  const judged = fresh ? new Set(fresh.map(keyOf)) : null;
  const off = new Set(splitOffMarket(all).off.filter((trade) => !judged || judged.has(keyOf(trade))).map(keyOf));
  const left = [...unpriced, ...all.filter((trade) => off.has(keyOf(trade))).map((trade) => unpricedOf(trade, "off-market"))];
  STATS.unpriced += left.length;
  return { trades: all.filter((trade) => !off.has(keyOf(trade))), unpriced: left };
}

async function call(endpoint: string, body: Record<string, unknown>, until: number, deps: Required<Deps>): Promise<unknown> {
  const wait = Math.min(CALL_TIMEOUT_MS, until - deps.now());
  if (wait <= 0) throw new EventsUnavailable("The events read ran out of time.");
  let response: Response;
  try {
    response = await deps.fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(wait), cache: "no-store" });
  } catch {
    /* The fetch's own message can carry the URL, and so the key: the host alone. */
    throw new EventsUnavailable(`${SCAN_HOST} did not answer the events read.`);
  }
  const length = Number(response.headers.get("content-length") ?? NaN);
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new EventsUnavailable(`${SCAN_HOST} answered more than a page may hold.`);
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new EventsUnavailable(`${SCAN_HOST} answered more than a page may hold.`);
  if (!response.ok) throw new EventsUnavailable(`${SCAN_HOST} answered HTTP ${response.status} to the events read.`);
  STATS.calls += 1;
  /* An answered call is paid for, whatever it turns out to hold. */
  day.spend(CALL_CREDITS, deps.now());
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new EventsMalformed(`${SCAN_HOST} answered the events read with something other than JSON.`);
  }
}

type Deps = Readonly<{ fetch?: Fetch; now?: () => number; endpoint?: string | null; env?: Env }>;

/**
 * The coin's trades from the chain's events, or null where the switch is closed or the read failed. `known` is the
 * list read last for the coin: a refresh asks only for what is newer and merges it.
 */
export async function readMintTradeEvents(
  mint: string,
  pricing: EventsPricing,
  known: Readonly<{ trades: readonly TokenTrade[]; whole: boolean }> | null = null,
  deps: Deps = {},
): Promise<EventsRead | null> {
  const endpoint = deps.endpoint !== undefined ? deps.endpoint : tokenEventsEndpoint();
  if (!endpoint) return null;
  const full: Required<Deps> = { fetch: deps.fetch ?? ((input, init) => fetch(input, init)), now: deps.now ?? Date.now, endpoint, env: deps.env ?? process.env };
  if (full.now() < pausedUntil) return null;
  const newest = known?.trades[0] ? Math.floor(Date.parse(known.trades[0].at) / 1000) : null;
  const refresh = known !== null && newest !== null && Number.isFinite(newest);
  /* The day's ceiling: the read's worst cost — a refresh that turns into a first read is one call more — must fit. */
  const ceiling = dayCeilingOf(full.env[TOKEN_EVENTS_DAILY_ENV], TOKEN_EVENTS_DAILY_CREDITS);
  if (!day.allows(((refresh ? 1 : 0) + MAX_CALLS) * CALL_CREDITS_MOST, ceiling, full.now())) {
    STATS.capped += 1;
    return null;
  }
  const until = full.now() + READ_DEADLINE_MS;
  try {
    if (known && newest !== null && Number.isFinite(newest)) {
      const page = tradesOfEvents(await call(endpoint, eventsBody({ mint, sinceS: newest }), until, full), mint, pricing);
      spendPage(page.credits, full.now());
      STATS.scanned += page.scanned;
      /* Everything newer fit in one call: merged onto the list read before, its depth unchanged. More — read afresh. */
      if (page.next === null) {
        STATS.refreshes += 1;
        const merged = settle(mergeTrades(page.trades, known.trades, Number.MAX_SAFE_INTEGER), page.unpriced, page.trades);
        const kept = merged.trades.slice(0, EVENTS_TRADES_TARGET);
        /* The oldest trades leave a full list: it no longer reaches the start of the history. */
        return { trades: kept, unpriced: merged.unpriced, whole: known.whole && kept.length === merged.trades.length, refreshed: true, calls: 1, scanned: page.scanned, credits: page.credits };
      }
    }
    let trades: TokenTrade[] = [];
    let unpriced: UnpricedTrade[] = [];
    let token: string | null = null;
    let calls = 0;
    let scanned = 0;
    let credits = 0;
    let whole = false;
    while (calls < MAX_CALLS) {
      const page = tradesOfEvents(await call(endpoint, eventsBody({ mint, paginationToken: token }), until, full), mint, pricing);
      calls += 1;
      scanned += page.scanned;
      credits += page.credits;
      spendPage(page.credits, full.now());
      STATS.scanned += page.scanned;
      trades = mergeTrades(trades, page.trades, Number.MAX_SAFE_INTEGER);
      unpriced = [...unpriced, ...page.unpriced];
      if (page.next === null) {
        whole = trades.length <= EVENTS_TRADES_TARGET;
        break;
      }
      if (page.next === token) throw new EventsMalformed("The events read answered the same cursor twice.");
      token = page.next;
      if (trades.length >= EVENTS_TRADES_TARGET) break;
    }
    STATS.reads += 1;
    const cut = trades.slice(0, EVENTS_TRADES_TARGET);
    /* A list cut at its depth counts only the unpriced swaps of the span it keeps. */
    const floor = trades.length > cut.length && cut.length > 0 ? Date.parse(cut[cut.length - 1]!.at) : Number.NEGATIVE_INFINITY;
    const listed = settle(cut, unpriced.filter((entry) => Date.parse(entry.at) >= floor));
    return { trades: listed.trades, unpriced: listed.unpriced, whole, refreshed: false, calls, scanned, credits };
  } catch {
    STATS.failures += 1;
    pausedUntil = full.now() + SCAN_PAUSE_MS;
    return null;
  }
}

/** Test seam: the scan stops resting, and its day starts over. */
export function resetTokenEvents(): void {
  pausedUntil = 0;
  day.reset();
}

/** The credits this instance spent on the scan in the day of `now`. */
export function tokenEventsDaySpent(now: number = Date.now()): number {
  return day.spent(now);
}
