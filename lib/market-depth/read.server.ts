import "server-only";

import { CURATED } from "../../city/lib/market/curated.ts";
import { DEPTH_LIMIT, listCoins, listPaths, mergeCoins, type DepthAnswer, type DepthList, type DepthWindow, type JupiterTokenV2 } from "./model.ts";

/**
 * The server's read of the Market's depth: Jupiter's Token API v2 with the engine's own key (`RYNTRA_JUPITER_API_KEY`,
 * the one the city and the swaps read with), bounded in time and size, each path read at most once a `FRESH_MS` for
 * every visitor of this instance, and one read at a time per path. Without the key the reads go `KEYLESS_GAP_MS` apart
 * — Jupiter's keyless limit is 0.5 requests a second — and a read that would wait too long is not queued. A person's
 * own reads (starred coins, a coin screen) keep a small pool of their own and a budget of Jupiter reads a minute, so
 * they never push the lists out nor spend the key the swaps quote with. A path that fails answers with its last good read.
 */

const BASE = "https://api.jup.ag/tokens/v2";
const KEY_ENV = "RYNTRA_JUPITER_API_KEY";
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 3_000_000;
/** A path's answer is fresh this long. */
export const FRESH_MS = 45_000;
/** A failed path answers with its last good read up to this old; older, the list is read as empty. */
const KEPT_MS = 30 * 60_000;
const KEYLESS_GAP_MS = 2_100;
/** Without a key, a read that would wait longer than this for its turn is not queued: the list answers what it kept. */
const KEYLESS_WAIT_MAX_MS = 6_500;
/** The lists' paths kept (each list × window is up to three): never pushed out by a person's own reads. */
const MAX_PATHS = 48;
/** A person's starred coins and a coin screen's own read: a pool of their own, small. */
const MAX_SAVED_PATHS = 64;
/** Jupiter reads for starred coins this instance makes in a minute, all visitors together; past it, only what is kept. */
const SAVED_MISSES_PER_MINUTE = 60;

/** The engine's own stocks (the city's avenue): the «Stocks» list reads them by mint. */
export const STOCK_MINTS: readonly string[] = CURATED.filter(([, district]) => district === "avenue").map(([mint]) => mint);
const STOCKS = new Set(STOCK_MINTS);

type Kept = { at: number; tokens: readonly JupiterTokenV2[] };
const lists = new Map<string, Kept>();
const saved = new Map<string, Kept>();
const flying = new Map<string, Promise<readonly JupiterTokenV2[] | null>>();
/** When the next keyless read may go. */
let keylessFree = 0;
let savedWindow = { from: 0, misses: 0 };

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function fetchPath(path: string, fetchImpl: typeof fetch): Promise<readonly JupiterTokenV2[] | null> {
  const key = process.env[KEY_ENV];
  if (!key) {
    // Keyless: spaced under Jupiter's limit across the instance; the first read goes at once, a long queue is refused.
    const now = Date.now();
    const slot = Math.max(now, keylessFree);
    if (slot - now > KEYLESS_WAIT_MAX_MS) return null;
    keylessFree = slot + KEYLESS_GAP_MS;
    if (slot > now) await pause(slot - now);
  }
  const headers: Record<string, string> = { accept: "application/json" };
  if (key) headers["x-api-key"] = key;
  try {
    const res = await fetchImpl(`${BASE}/${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return null;
    const body = await res.text();
    if (body.length > MAX_BYTES) return null;
    const parsed: unknown = JSON.parse(body);
    return Array.isArray(parsed) ? (parsed as JupiterTokenV2[]) : null;
  } catch {
    return null;
  }
}

function keep(pool: Map<string, Kept>, max: number, path: string, tokens: readonly JupiterTokenV2[]): void {
  pool.delete(path);
  pool.set(path, { at: Date.now(), tokens });
  // A Map keeps the order things were set in: the first is the oldest.
  while (pool.size > max) pool.delete(pool.keys().next().value!);
}

/** Whether one more Jupiter read for starred coins fits this minute's budget. */
function savedMissAllowed(now: number): boolean {
  if (now - savedWindow.from >= 60_000) savedWindow = { from: now, misses: 0 };
  if (savedWindow.misses >= SAVED_MISSES_PER_MINUTE) return false;
  savedWindow.misses += 1;
  return true;
}

/** One path, fresh or from what this instance already read. `pool` — the lists', or a person's own. */
export async function readPath(path: string, now: number = Date.now(), fetchImpl: typeof fetch = fetch, pool: "lists" | "saved" = "lists"): Promise<readonly JupiterTokenV2[]> {
  const store = pool === "saved" ? saved : lists;
  const had = store.get(path);
  if (had && now - had.at < FRESH_MS) return had.tokens;
  let read = flying.get(path);
  if (!read) {
    if (pool === "saved" && !savedMissAllowed(now)) return had && now - had.at < KEPT_MS ? had.tokens : [];
    read = fetchPath(path, fetchImpl).finally(() => flying.delete(path));
    flying.set(path, read);
  }
  const tokens = await read;
  if (tokens) {
    keep(store, pool === "saved" ? MAX_SAVED_PATHS : MAX_PATHS, path, tokens);
    return tokens;
  }
  return had && now - had.at < KEPT_MS ? had.tokens : [];
}

/** One list over one window, as the Market shows it. `null` — Jupiter answered none of its paths. */
export async function readDepth(list: DepthList, window: DepthWindow, fetchImpl: typeof fetch = fetch): Promise<DepthAnswer | null> {
  const paths = listPaths(list, window, STOCK_MINTS);
  const answers = await Promise.all(paths.map((path) => readPath(path, Date.now(), fetchImpl)));
  if (answers.every((answer) => answer.length === 0)) return null;
  return { list, window, coins: listCoins(list, window, answers, STOCKS), readAt: new Date().toISOString() };
}

/** For the tests: forget what this instance read. */
export function forgetDepth(): void {
  lists.clear();
  saved.clear();
  flying.clear();
  keylessFree = 0;
  savedWindow = { from: 0, misses: 0 };
}

/** The coins a person starred, by mint (at most `DEPTH_LIMIT`), in the order given. `null` — Jupiter did not answer. */
export async function readSaved(mints: readonly string[], fetchImpl: typeof fetch = fetch): Promise<DepthAnswer | null> {
  const asked = [...new Set(mints)].slice(0, DEPTH_LIMIT);
  if (!asked.length) return { list: "saved", window: "24h", coins: [], readAt: new Date().toISOString() };
  const tokens = await readPath(`search?query=${[...asked].sort().join(",")}`, Date.now(), fetchImpl, "saved");
  if (!tokens.length) return null;
  const coins = mergeCoins([tokens], STOCKS);
  const order = new Map(asked.map((mint, i) => [mint, i]));
  return { list: "saved", window: "24h", coins: coins.filter((c) => order.has(c.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!), readAt: new Date().toISOString() };
}
