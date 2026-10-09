/**
 * Ryntra Launch's executor — its switch and its own notes in the flight log.
 *
 * - **The switch** — the operator stops the executor on one market or on every
 *   market, and resumes it. While a market is stopped the executor signs
 *   nothing on it: no graduation, no ladder, no claim; the reads go on. Every
 *   flip that changes what holds on a market is a mark in that market's flight
 *   log — a stop of every market, a mark on each of them.
 * - **What the executor keeps per market** — its first pass (the log notes it
 *   once), the state of the market it last wrote down (a mark only when it
 *   changes), a graduation it sent that the chain has not answered yet, and its
 *   failed graduations in a row with when the last one failed.
 * - **The marks** — written once, never changed, read beside the chain's own
 *   events (`JournalMark`).
 *
 * Nothing here signs or reads the chain.
 */

import { randomUUID } from "node:crypto";

import type { JournalMark } from "../core/launch/autopilot.ts";
import type { MarketCycleState } from "../core/launch/market-health.ts";
import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";

const STOPS = "launchExecutorStops";
const MARKETS = "launchExecutorMarkets";
const MARKS = "launchJournalMarks";

/** The operator's stop: for every market of the network (`scope` "all") or for one token. */
export type ExecutorStop = Readonly<{
  version: number;
  cluster: string;
  scope: "all" | "market";
  /** The token, for a market's stop; null for every market. */
  token: string | null;
  stopped: boolean;
  at: string;
  /** Who flipped it, as the admin knows them — kept here, never shown in a log. */
  by: string;
}>;

export type ExecutorStops = Readonly<{ all: ExecutorStop | null; markets: ReadonlyMap<string, ExecutorStop> }>;

const stopKey = (cluster: string, token: string | null) => `solana:${cluster}:${token ?? "*"}`;

/** Every stop on a network, as the operator last set them. */
export async function readExecutorStops(store: GuardStore, cluster: string): Promise<ExecutorStops> {
  const rows = await store.versioned<ExecutorStop>(STOPS).valuesWithPrefix(`solana:${cluster}:`);
  let all: ExecutorStop | null = null;
  const markets = new Map<string, ExecutorStop>();
  for (const row of rows) {
    if (row.cluster !== cluster) continue;
    if (row.scope === "all") all = row;
    else if (row.token) markets.set(row.token, row);
  }
  return { all, markets };
}

/** The stop that holds on a market now — every market's first — or null while the executor may act there. */
export function stopOn(stops: ExecutorStops, token: string): Readonly<{ scope: "all" | "market"; at: string }> | null {
  if (stops.all?.stopped) return { scope: "all", at: stops.all.at };
  const own = stops.markets.get(token);
  return own?.stopped ? { scope: "market", at: own.at } : null;
}

export type SwitchOutcome = Readonly<{ changed: boolean; marked: readonly string[] }>;

/**
 * The operator's switch: stop or resume the executor on one market or on every market of the network (`tokens` — the
 * network's launches). A flip that changes nothing changes nothing. A mark goes into the log of every market where what
 * holds changes: a market already stopped on its own gets no second stop when every market stops, and is not resumed when
 * every market resumes.
 */
export async function setExecutorStop(
  store: GuardStore,
  args: Readonly<{ cluster: string; token: string | null; stopped: boolean; by: string; now: Date; tokens: readonly string[] }>,
): Promise<SwitchOutcome> {
  const stops = store.versioned<ExecutorStop>(STOPS);
  const marks = store.collection<StoredMark>(MARKS);
  const key = stopKey(args.cluster, args.token);
  const at = args.now.toISOString();
  const scope = args.token ? "market" : "all";
  const reach = args.token ? [args.token] : [...new Set(args.tokens)];
  return withBoundedCasRetry(async (): Promise<SwitchOutcome | false> => {
    const before = await readExecutorStops(store, args.cluster);
    const current = await stops.get(key);
    if ((current?.stopped ?? false) === args.stopped) return { changed: false, marked: [] };
    const next: ExecutorStop = { version: (current?.version ?? -1) + 1, cluster: args.cluster, scope, token: args.token, stopped: args.stopped, at, by: args.by };
    const after: ExecutorStops = args.token ? { all: before.all, markets: new Map([...before.markets, [args.token, next]]) } : { all: next, markets: before.markets };
    /* The marks first, each under the switch's next version: a flip whose write is lost takes its marks back. */
    const written: string[] = [];
    const marked: string[] = [];
    for (const token of reach) {
      const was = stopOn(before, token);
      const now = stopOn(after, token);
      if (Boolean(was) === Boolean(now)) continue;
      const market = await readExecutorMarket(store, args.cluster, token);
      const id = `${now ? "STOPPED" : "RESUMED"}:${scope}:v${next.version}`;
      await writeJournalMark(
        store,
        args.cluster,
        token,
        { kind: now ? "STOPPED" : "RESUMED", at, actor: "operator", state: now ? "PAUSED_RISK" : null, from: now ? (market?.state ?? null) : "PAUSED_RISK", signature: null, scope, pairRaw: null },
        id,
      );
      written.push(`solana:${args.cluster}:${token}:${id}`);
      marked.push(token);
    }
    if (await stops.compareAndSet(key, current ? current.version : null, next)) return { changed: true, marked };
    for (const row of written) await marks.delete(row);
    return false;
  });
}

/* ------------------------------------------------------------ what the executor keeps per market */

export type ExecutorMarket = Readonly<{
  version: number;
  cluster: string;
  token: string;
  /** The executor's first pass over the market; null before it. */
  watchedAt: string | null;
  /** The state of the market the executor last wrote down; null before the first. */
  state: MarketCycleState | null;
  /** A graduation the executor sent and the chain has not answered yet — written before the send. */
  graduation: Readonly<{ signature: string; validUntil: number; sentAt: string }> | null;
  /** Failed graduations in a row, and when the last one failed (unix seconds); 0 and null once one goes through. */
  failures: number;
  failedAt: number | null;
  /** When the market's ladder first had a budget, and how much (raw); null before. */
  budgetAt: string | null;
  budgetRaw: string | null;
  updatedAt: string;
}>;

const marketKey = (cluster: string, token: string) => `solana:${cluster}:${token}`;

export function emptyExecutorMarket(cluster: string, token: string, now: Date): ExecutorMarket {
  return { version: -1, cluster, token, watchedAt: null, state: null, graduation: null, failures: 0, failedAt: null, budgetAt: null, budgetRaw: null, updatedAt: now.toISOString() };
}

export async function readExecutorMarket(store: GuardStore, cluster: string, token: string): Promise<ExecutorMarket | null> {
  return (await store.versioned<ExecutorMarket>(MARKETS).get(marketKey(cluster, token))) ?? null;
}

/** What the executor keeps on every market of a network, by token — one read. */
export async function readExecutorMarkets(store: GuardStore, cluster: string): Promise<Map<string, ExecutorMarket>> {
  const rows = await store.versioned<ExecutorMarket>(MARKETS).valuesWithPrefix(`solana:${cluster}:`);
  return new Map(rows.filter((row) => row.cluster === cluster).map((row) => [row.token, row]));
}

/** The market's record changed by `change` — read again and changed again when another write came first. */
export async function updateExecutorMarket(
  store: GuardStore,
  cluster: string,
  token: string,
  now: Date,
  change: (current: ExecutorMarket) => Omit<ExecutorMarket, "version" | "updatedAt">,
): Promise<ExecutorMarket> {
  const markets = store.versioned<ExecutorMarket>(MARKETS);
  const key = marketKey(cluster, token);
  return withBoundedCasRetry(async () => {
    const current = (await markets.get(key)) ?? emptyExecutorMarket(cluster, token, now);
    const next: ExecutorMarket = { ...change(current), version: current.version + 1, updatedAt: now.toISOString() };
    return (await markets.compareAndSet(key, current.version < 0 ? null : current.version, next)) ? next : false;
  });
}

/* ------------------------------------------------------------ the marks */

type StoredMark = JournalMark & Readonly<{ cluster: string; token: string }>;

/**
 * A mark in a market's flight log, under a key of its own. `id` — what makes it the one mark it is (a state at a version
 * of the market's record, a stop at a version of the switch): written again under the same id it stays one mark, so a
 * writer that dies between the mark and its record writes it once. Without an id, a key no other mark has.
 */
export async function writeJournalMark(store: GuardStore, cluster: string, token: string, mark: JournalMark, id: string = `${mark.at}:${randomUUID().slice(0, 8)}`): Promise<void> {
  const row: StoredMark = { ...mark, cluster, token };
  await store.collection<StoredMark>(MARKS).set(`solana:${cluster}:${token}:${id}`, row);
}

/** Every mark in a market's flight log, the oldest first. */
export async function journalMarks(store: GuardStore, cluster: string, token: string): Promise<readonly JournalMark[]> {
  const rows = await store.collection<StoredMark>(MARKS).valuesWithPrefix(`solana:${cluster}:${token}:`);
  return rows
    .filter((row) => row.cluster === cluster && row.token === token)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map(({ cluster: _cluster, token: _token, ...mark }) => mark);
}

/* ------------------------------------------------------------ where the executor may sign, and what a minute sent */

export type AutopilotPaused = "NO_NETWORK" | "LANE_CLOSED" | "NOT_HERE" | "NO_SHARED_STORE" | "NO_EXECUTOR";

/**
 * Why the executor does not run here, or null when it may: no network; Launch's operator stop closed; on mainnet, a
 * deployment that is not production (a preview, a local server) or a store not every instance shares — the records
 * written before each send, the leases and the marks must outlive the instance that wrote them —; no executor's key.
 */
export function executorPaused(args: Readonly<{ network: Readonly<{ cluster: string }> | null; laneOpen: boolean; writesHere: boolean; sharedStore: boolean; key: boolean }>): AutopilotPaused | null {
  if (!args.network) return "NO_NETWORK";
  if (!args.laneOpen) return "LANE_CLOSED";
  if (!args.writesHere) return "NOT_HERE";
  if (args.network.cluster === "mainnet" && !args.sharedStore) return "NO_SHARED_STORE";
  if (!args.key) return "NO_EXECUTOR";
  return null;
}

/** The steps of a transaction the executor sent in this minute — exactly these, nothing read from an older send. */
export const SENT_STEPS: ReadonlySet<string> = new Set(["GRADUATED", "GRADUATION_SENT", "GRADUATION_FAILED", "FLOOR_POOL", "FLOOR_PLACED", "FLOOR_RAISED", "FLOOR_ADDED", "FLOOR_SYNCED", "HOLDER_CLAIMED"]);

/** How many transactions a minute signed and sent, from its steps. */
export function sentCount(steps: readonly Readonly<{ step: string; signature?: string }>[]): number {
  return steps.filter((step) => step.signature && SENT_STEPS.has(step.step)).length;
}
