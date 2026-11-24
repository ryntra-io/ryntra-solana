/**
 * The creator's tab of a coin: who launched it, the other coins that wallet launched and how each went, and
 * what it did with this one. Behind the deployment's closed switch (`creator-scan.server.ts`).
 *
 * What one coin's first read asks, at most, and how long it is kept:
 *
 * - Jupiter — the coin's detail (the read every coin page already shares) and one search for up to a hundred of the
 *   creator's coins at once (`readSpotFactsByMint`);
 * - Helius's scan — the creator's launches: up to `LAUNCH_CALLS` calls (≤ 20 credits each), kept half an hour per
 *   creator, so every coin of one creator shares them; the creator's moves of this coin since its birth: up to
 *   `MOVE_CALLS` calls (≤ 20 credits each), kept ten minutes per coin;
 * - the node — the creator's balance of the coin: one `getTokenAccountsByOwner`;
 * - GeckoTerminal — the daily bars of at most `PEAK_READS` of the coins, inside the chart's own minute budget as its
 *   junior (`"page"`): the highest capitalisation, kept six hours per coin. Refused, the figure is a dash.
 *
 * The whole answer is kept ten minutes per coin, one read per coin in flight, and a held copy answers for an hour when
 * a fresh read fails. So a coin page costs at most ~80 Helius credits once in ten minutes, whoever opens it, within the
 * day's ceiling of both tabs. Reads only: no key, no signature, nothing sent.
 */

import { createSolanaRpcHandle, withRpcDiscipline } from "../solana/rpc.ts";
import { readSpotCandles } from "./candles.server.ts";
import { launchesOf, movesOf, type CoinMove, type Launch } from "./creator-chain.ts";
import { scanAllows, scanPages, ScanQuiet, creatorOpen, type ScanDeps } from "./creator-scan.server.ts";
import {
  balanceOfParsedAccounts,
  capSupplyOf,
  creatorActionOf,
  creatorCoinsOf,
  creatorCountsOf,
  launchesBody,
  movesBody,
  peakCandidates,
  peakOfBars,
  CREATOR_SCAN_BUDGET,
  type CreatorAnswer,
} from "./creator.ts";
import type { SpotMarket } from "./markets.ts";
import { readSpotFactsByMint, readSpotTokenFacts } from "./markets.server.ts";
import { isNativeToken, type TokenFacts } from "./token-page.ts";

export type CreatorFailure = Readonly<{ ok: false; code: "CLOSED" | "NO_CREATOR" | "NOT_READ" | "UNREACHABLE" | "RATE_LIMITED"; reason: string; retryAfterMs?: number | null }>;
export type CreatorRead = Readonly<{ ok: true } & CreatorAnswer>;

/** Calls one read of the creator's launches may make: a busy launcher's last two hundred transactions on the curves. */
export const LAUNCH_CALLS = 2;
/** Calls one read of the creator's moves of the coin may make. */
export const MOVE_CALLS = 2;
/** Coins whose highest capitalisation one read asks GeckoTerminal for. */
export const PEAK_READS = 3;

const ANSWER_TTL_MS = 10 * 60_000;
const HELD_MS = 60 * 60_000;
const LAUNCHES_TTL_MS = 30 * 60_000;
const MOVES_TTL_MS = 10 * 60_000;
const PEAK_TTL_MS = 6 * 3_600_000;
const SCAN_DEADLINE_MS = 7_000;
const PEAK_DEADLINE_MS = 4_000;
const CACHE_CEILING = 400;

type Cached<T> = { value: T; readAt: number };

function fresh<T>(cache: Map<string, Cached<T>>, key: string, ttlMs: number, now: number): Cached<T> | null {
  const hit = cache.get(key);
  return hit && now - hit.readAt < ttlMs ? hit : null;
}

function remember<T>(cache: Map<string, Cached<T>>, key: string, value: T, now: number): void {
  cache.delete(key);
  cache.set(key, { value, readAt: now });
  while (cache.size > CACHE_CEILING) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

const answers = new Map<string, Cached<CreatorRead>>();
const launchReads = new Map<string, Cached<readonly Launch[]>>();
const moveReads = new Map<string, Cached<Readonly<{ moves: readonly CoinMove[]; whole: boolean }>>>();
const peaks = new Map<string, Cached<number | null>>();
const flying = new Map<string, Promise<unknown>>();

function once<T>(key: string, read: () => Promise<T>): Promise<T> {
  const pending = flying.get(key);
  if (pending) return pending as Promise<T>;
  const promise = read().finally(() => flying.delete(key));
  flying.set(key, promise);
  return promise;
}

/** Test seam: forget every read. */
export function resetCreatorReads(): void {
  answers.clear();
  launchReads.clear();
  moveReads.clear();
  peaks.clear();
  flying.clear();
}

type FactsRead = Readonly<{ ok: true; market: SpotMarket | null; facts: TokenFacts | null; stale: boolean }> | Readonly<{ ok: false; code: string; reason: string; retryAfterMs?: number | null }>;
type MarketsRead = Readonly<{ ok: true; byMint: ReadonlyMap<string, SpotMarket>; facts: ReadonlyMap<string, TokenFacts> }> | Readonly<{ ok: false }>;

export type CreatorDeps = Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => number;
  scan?: ScanDeps;
  facts?: (mint: string) => Promise<FactsRead>;
  markets?: (mints: readonly string[]) => Promise<MarketsRead>;
  balance?: (owner: string, mint: string) => Promise<number | null>;
  bars?: (mint: string) => Promise<readonly Readonly<{ high: number }>[] | null>;
}>;

/** The creator's balance of the coin, from the node: one call, short, without a retry; null when it did not answer. */
async function balanceOnChain(owner: string, mint: string): Promise<number | null> {
  const handle = createSolanaRpcHandle({ network: "mainnet", timeoutMs: 4_000, retries: 0 });
  try {
    const response = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.getTokenAccountsByOwner(owner as never, { mint: mint as never }, { encoding: "jsonParsed", commitment: "confirmed" }).send({ abortSignal }),
    );
    return balanceOfParsedAccounts((response as { value?: unknown }).value);
  } catch {
    return null;
  }
}

/** A coin's daily bars from GeckoTerminal, as the chart's junior; null when refused. */
async function dailyBars(mint: string): Promise<readonly Readonly<{ high: number }>[] | null> {
  const read = await readSpotCandles(mint, "1d", "page");
  return read.ok ? read.candles : null;
}

/** Waits for `read` at most until `deadline`; null past it. */
async function within<T>(read: Promise<T>, deadline: number, now: () => number): Promise<T | null> {
  const left = deadline - now();
  if (left <= 0) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read, new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), left)))]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The creator's tab of a coin, or why there is none: the tabs closed, a coin with no creator named (SOL, a stock, a coin
 * Jupiter does not list or names no creator for), or the catalogue not answering with nothing held.
 */
export async function readCreator(mint: string, deps: CreatorDeps = {}): Promise<CreatorRead | CreatorFailure> {
  const env = deps.env ?? process.env;
  if (!creatorOpen(env)) return { ok: false, code: "CLOSED", reason: "The creator's tab is not open on this deployment." };
  if (isNativeToken(mint)) return { ok: false, code: "NOT_READ", reason: "SOL has no creator." };
  const now = deps.now ?? Date.now;
  const hit = fresh(answers, mint, ANSWER_TTL_MS, now());
  if (hit) return hit.value;
  return once(`creator:${mint}`, async () => {
    const started = now();
    const held = fresh(answers, mint, HELD_MS, started);
    const factsRead = await (deps.facts ?? readSpotTokenFacts)(mint);
    if (!factsRead.ok) {
      if (held) return { ...held.value, stale: true };
      return { ok: false, code: factsRead.code === "RATE_LIMITED" ? "RATE_LIMITED" : "UNREACHABLE", reason: factsRead.reason, retryAfterMs: factsRead.retryAfterMs ?? null } as const;
    }
    const market = factsRead.market;
    const facts = factsRead.facts;
    const creator = facts?.dev ?? null;
    if (!market || !creator || market.category === "stock") return { ok: false, code: "NO_CREATOR", reason: "No source names a creator for this coin." } as const;

    const scan: ScanDeps = { ...deps.scan, env, now };
    const until = started + SCAN_DEADLINE_MS;
    const bornS = facts?.createdAt ? Math.floor(Date.parse(facts.createdAt) / 1000) - 60 : null;
    const moveKey = `${creator}:${mint}`;
    const knownLaunches = fresh(launchReads, creator, LAUNCHES_TTL_MS, started)?.value ?? null;
    const knownMoves = fresh(moveReads, moveKey, MOVES_TTL_MS, started)?.value ?? null;
    /* The day's ceiling holds the worst of what is still to read; past it nothing is asked and the tab says less. */
    const calls = (knownLaunches ? 0 : LAUNCH_CALLS) + (knownMoves ? 0 : MOVE_CALLS);
    const endpoint = calls ? scanAllows(calls, CREATOR_SCAN_BUDGET, scan) : null;

    const launchesRead: Promise<readonly Launch[] | null> = knownLaunches
      ? Promise.resolve(knownLaunches)
      : endpoint
        ? scanPages(endpoint, (cursor) => launchesBody(creator, cursor), LAUNCH_CALLS, { ...scan, until })
            .then(({ pages }) => {
              const value = launchesOf(pages, creator);
              remember(launchReads, creator, value, now());
              return value;
            })
            .catch((failure: unknown) => {
              if (failure instanceof ScanQuiet) return null;
              throw failure;
            })
        : Promise.resolve(null);
    const movesRead: Promise<Readonly<{ moves: readonly CoinMove[]; whole: boolean }> | null> = knownMoves
      ? Promise.resolve(knownMoves)
      : endpoint
        ? scanPages(endpoint, (cursor) => movesBody(creator, mint, { sinceS: bornS, paginationToken: cursor }), MOVE_CALLS, { ...scan, until })
            .then(({ pages, whole }) => {
              const value = { moves: movesOf(pages, creator, mint), whole };
              remember(moveReads, moveKey, value, now());
              return value;
            })
            .catch((failure: unknown) => {
              if (failure instanceof ScanQuiet) return null;
              throw failure;
            })
        : Promise.resolve(null);
    const [launches, moves, balance] = await Promise.all([launchesRead, movesRead, (deps.balance ?? balanceOnChain)(creator, mint)]);

    /* The coins' names, logos and capitalisations: one search for all of them; this coin's from its own read. */
    const others = (launches ?? []).map((launch) => launch.mint).filter((other) => other !== mint);
    const marketsRead = others.length ? await (deps.markets ?? readSpotFactsByMint)(others) : null;
    const byMint = new Map<string, SpotMarket>(marketsRead?.ok ? marketsRead.byMint : []);
    const factsBy = new Map<string, TokenFacts>(marketsRead?.ok ? marketsRead.facts : []);
    byMint.set(mint, market);
    if (facts) factsBy.set(mint, facts);

    const peakOf = new Map<string, number | null>();
    for (const coinMint of byMint.keys()) {
      const known = fresh(peaks, coinMint, PEAK_TTL_MS, started);
      if (known) peakOf.set(coinMint, known.value);
    }
    const draft = creatorCoinsOf({ mint, launches: launches ?? [], markets: byMint, facts: factsBy, peaks: peakOf });
    const wanted = peakCandidates(draft, PEAK_READS + peakOf.size).filter((coinMint) => !peakOf.has(coinMint)).slice(0, PEAK_READS);
    const readBars = deps.bars ?? dailyBars;
    const peakDeadline = now() + PEAK_DEADLINE_MS;
    await Promise.all(
      wanted.map(async (coinMint) => {
        const bars = await within(readBars(coinMint).catch(() => null), peakDeadline, now);
        if (bars === null) return;
        const value = peakOfBars(bars, capSupplyOf(byMint.get(coinMint), factsBy.get(coinMint)));
        peakOf.set(coinMint, value);
        remember(peaks, coinMint, value, now());
      }),
    );
    const coins = creatorCoinsOf({ mint, launches: launches ?? [], markets: byMint, facts: factsBy, peaks: peakOf });
    const counts = creatorCountsOf(facts, coins, launches !== null);
    const supply = facts?.totalSupply ?? capSupplyOf(market, facts);
    const action = moves ? creatorActionOf({ moves: moves.moves, balance, supply, whole: moves.whole }) : null;
    const value: CreatorRead = {
      ok: true,
      creator,
      launched: counts.launched,
      listed: counts.listed,
      coins,
      coinsWhole: counts.whole,
      action,
      observedAt: new Date(now()).toISOString(),
      stale: factsRead.stale,
    };
    /* A read that could not reach the chain at all is not kept as the coin's answer for ten minutes. */
    if (launches !== null || moves !== null || !endpoint) remember(answers, mint, value, now());
    return value;
  });
}
