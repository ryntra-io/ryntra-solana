/**
 * The links between a coin's largest holders (`holder-links.ts`), read from the chain behind the
 * deployment's closed switch (`creator-scan.server.ts`).
 *
 * What one coin's read asks, at most, and how long it is kept:
 *
 * - the holders — the holders tab's own read (`readTokenHolders`, kept ninety seconds and shared): nothing new;
 * - Helius's scan — each of the `LINK_HOLDERS` largest holders that is a person's key: one call for its moves of the
 *   coin since the coin's birth (`HOLDER_SCAN_BUDGET` scanned at most, ≤ 13 credits), `LINK_PARALLEL` at a time; each
 *   holder's moves kept half an hour, so a holder still among the largest is not read again.
 *
 * The answer is kept fifteen minutes per coin, one read per coin in flight, a held copy for an hour when a fresh read
 * fails. So a coin page costs at most ~195 Helius credits once in fifteen minutes, whoever opens it, within the day's
 * ceiling of both tabs. A holder the read did not reach in time is not checked, and the answer says how many were.
 * Reads only: no key, no signature, nothing sent.
 */

import { PublicKey } from "@solana/web3.js";

import { movesOf, type CoinMove } from "./creator-chain.ts";
import { callCredits, creatorOpen, scanAllows, scanCall, ScanQuiet, type ScanDeps } from "./creator-scan.server.ts";
import { movesBody } from "./creator.ts";
import { holderLinksOf, type HolderLinksAnswer, type LinkHolder } from "./holder-links.ts";
import { readSpotTokenFacts } from "./markets.server.ts";
import type { TokenFacts, TokenHolder } from "./token-page.ts";
import { isNativeToken } from "./token-page.ts";
import { readTokenHolders } from "./token-page.server.ts";

export type HolderLinksFailure = Readonly<{ ok: false; code: "CLOSED" | "NOT_READ" | "UNREACHABLE" | "RATE_LIMITED"; reason: string; retryAfterMs?: number | null }>;
export type HolderLinksRead = Readonly<{ ok: true } & HolderLinksAnswer>;

/** The largest holders the map checks: people's keys only, pools and programs left out. */
export const LINK_HOLDERS = 15;
/** Moves of the coin one holder's call lists: a holder with more is checked on its newest. */
export const HOLDER_MOVES = 50;
/** The most history one holder's call scans: 10 credits, plus 1 per thousand. */
export const HOLDER_SCAN_BUDGET = 3_000;
/** Holders' calls in flight at once. */
export const LINK_PARALLEL = 5;

const ANSWER_TTL_MS = 15 * 60_000;
const HELD_MS = 60 * 60_000;
const HOLDER_TTL_MS = 30 * 60_000;
const READ_DEADLINE_MS = 8_000;
const CACHE_CEILING = 2_000;

type Cached<T> = { value: T; readAt: number };
type Checked = Readonly<{ moves: readonly CoinMove[]; whole: boolean }>;

const answers = new Map<string, Cached<HolderLinksRead>>();
const checks = new Map<string, Cached<Checked>>();
const flying = new Map<string, Promise<unknown>>();

function remember<T>(cache: Map<string, Cached<T>>, key: string, value: T, now: number): void {
  cache.delete(key);
  cache.set(key, { value, readAt: now });
  while (cache.size > CACHE_CEILING) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function once<T>(key: string, read: () => Promise<T>): Promise<T> {
  const pending = flying.get(key);
  if (pending) return pending as Promise<T>;
  const promise = read().finally(() => flying.delete(key));
  flying.set(key, promise);
  return promise;
}

/** Test seam: forget every read. */
export function resetHolderLinks(): void {
  answers.clear();
  checks.clear();
  flying.clear();
}

/** Whether an address is a person's key — on the curve — rather than a program's account. */
export function isPersonKey(address: string): boolean {
  try {
    return PublicKey.isOnCurve(new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}

type HoldersRead = Readonly<{ ok: true; holders: readonly TokenHolder[] }> | Readonly<{ ok: false; code: string; reason: string; retryAfterMs?: number | null }>;
type FactsRead = Readonly<{ ok: true; facts: TokenFacts | null }> | Readonly<{ ok: false }>;

export type HolderLinksDeps = Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => number;
  scan?: ScanDeps;
  holders?: (mint: string) => Promise<HoldersRead>;
  facts?: (mint: string) => Promise<FactsRead>;
  isWallet?: (address: string) => boolean;
}>;

/** Runs `work` over `items`, at most `parallel` at a time. */
async function pool<T>(items: readonly T[], parallel: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, lane));
}

/** The links of the coin's largest holders, or why there are none: the tabs closed, SOL, or the holders not read. */
export async function readHolderLinks(mint: string, deps: HolderLinksDeps = {}): Promise<HolderLinksRead | HolderLinksFailure> {
  const env = deps.env ?? process.env;
  if (!creatorOpen(env)) return { ok: false, code: "CLOSED", reason: "The holders' links are not open on this deployment." };
  if (isNativeToken(mint)) return { ok: false, code: "NOT_READ", reason: "SOL is held by every wallet on the network; its holders are not linked." };
  const now = deps.now ?? Date.now;
  const hit = answers.get(mint);
  if (hit && now() - hit.readAt < ANSWER_TTL_MS) return hit.value;
  return once(`links:${mint}`, async () => {
    const started = now();
    const held = hit && started - hit.readAt < HELD_MS ? hit : null;
    const quiet = (code: HolderLinksFailure["code"], reason: string, retryAfterMs?: number | null): HolderLinksRead | HolderLinksFailure => (held ? { ...held.value, stale: true } : { ok: false, code, reason, retryAfterMs: retryAfterMs ?? null });
    const [holdersRead, factsRead] = await Promise.all([(deps.holders ?? readTokenHolders)(mint), (deps.facts ?? readSpotTokenFacts)(mint)]);
    if (!holdersRead.ok) return quiet(holdersRead.code === "RATE_LIMITED" ? "RATE_LIMITED" : holdersRead.code === "NOT_READ" ? "NOT_READ" : "UNREACHABLE", holdersRead.reason, holdersRead.retryAfterMs);
    const facts = factsRead.ok ? factsRead.facts : null;
    const isWallet = deps.isWallet ?? isPersonKey;
    /* Pools, curves, vaults and locks are never a link; a person's key is. */
    const skip = new Set(holdersRead.holders.filter((row) => row.labels.includes("pool") || row.labels.includes("program")).map((row) => row.owner));
    const people: LinkHolder[] = holdersRead.holders
      .filter((row) => !skip.has(row.owner) && isWallet(row.owner))
      .slice(0, LINK_HOLDERS)
      .map((row) => ({ owner: row.owner, sharePct: row.sharePct }));
    const bornS = facts?.createdAt ? Math.floor(Date.parse(facts.createdAt) / 1000) - 60 : null;

    const moves = new Map<string, readonly CoinMove[]>();
    let whole = true;
    const toRead: LinkHolder[] = [];
    for (const holder of people) {
      const known = checks.get(`${holder.owner}:${mint}`);
      if (known && started - known.readAt < HOLDER_TTL_MS) {
        moves.set(holder.owner, known.value.moves);
        whole &&= known.value.whole;
      } else toRead.push(holder);
    }
    const scan: ScanDeps = { ...deps.scan, env, now };
    const endpoint = toRead.length ? scanAllows(toRead.length, HOLDER_SCAN_BUDGET, scan) : null;
    if (toRead.length && !endpoint && moves.size === 0 && people.length >= 2) return quiet("UNREACHABLE", "The chain's history is not read now.");
    if (endpoint) {
      const until = started + READ_DEADLINE_MS;
      await pool(toRead, LINK_PARALLEL, async (holder) => {
        try {
          const page = await scanCall(endpoint, movesBody(holder.owner, mint, { sinceS: bornS, limit: HOLDER_MOVES, budget: HOLDER_SCAN_BUDGET }), { ...scan, until });
          const checked: Checked = { moves: movesOf([page], holder.owner, mint), whole: page.next === null };
          remember(checks, `${holder.owner}:${mint}`, checked, now());
          moves.set(holder.owner, checked.moves);
          whole &&= checked.whole;
        } catch (failure) {
          if (!(failure instanceof ScanQuiet)) throw failure;
        }
      });
    }
    /* Not one holder could be checked: the source is quiet, not «no links». */
    if (people.length >= 2 && moves.size === 0) return quiet("UNREACHABLE", "The chain's history did not answer.");
    const checkedPeople = people.filter((holder) => moves.has(holder.owner));
    const links = holderLinksOf({ holders: checkedPeople, moves, isWallet, skip, creator: facts?.dev ?? null });
    const value: HolderLinksRead = { ok: true, ...links, checked: checkedPeople.length, of: people.length, whole: whole && checkedPeople.length === people.length, observedAt: new Date(now()).toISOString(), stale: false };
    remember(answers, mint, value, now());
    return value;
  });
}

/** The most credits one coin's read of the links may spend: every holder's one call at its budget. */
export const LINKS_MOST_CREDITS = LINK_HOLDERS * callCredits(HOLDER_SCAN_BUDGET);
