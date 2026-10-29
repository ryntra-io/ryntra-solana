/**
 * The assistant's keyless public sources, read on the server (AI-03).
 *
 * DexScreener (a token's pairs) and RugCheck (a token's risk report): one GET
 * each, bounded in time, cached per mint (`cache.ts`) so a question answers
 * from memory most of the time and a burst of questions makes one request.
 * No key, no write, no account: these are the same public answers any
 * browser gets. A failure is a read with a reason, never a throw.
 */

import { createReadCache, type CachedRead } from "./cache.ts";
import { dexPairsUrl, parseDexPairs, type DexPair } from "./dexscreener.ts";
import { parseRugCheck, rugCheckUrl, type RugCheckReport } from "./rugcheck.ts";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type SourceDeps = Readonly<{ fetchImpl?: FetchLike; timeoutMs?: number }>;

/* DexScreener's pairs move by the minute; the report changes rarely. */
const dexCache = createReadCache<readonly DexPair[]>({ ttlMs: 30_000, staleMs: 5 * 60_000 });
const rugCache = createReadCache<RugCheckReport | null>({ ttlMs: 10 * 60_000, staleMs: 60 * 60_000 });

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function getJson(url: string, deps: SourceDeps): Promise<Readonly<{ ok: true; status: number; body: unknown }> | Readonly<{ ok: false; reason: string }>> {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  try {
    const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(deps.timeoutMs ?? 6_000) });
    if (response.status === 404) return { ok: true, status: 404, body: null };
    if (response.status === 429) return { ok: false, reason: "The source's rate limit was reached." };
    if (!response.ok) return { ok: false, reason: `The source answered ${response.status}.` };
    return { ok: true, status: response.status, body: await response.json() };
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, reason: timeout ? "The source did not answer in time." : "The source could not be reached." };
  }
}

export async function readDexPairs(mint: string, deps: SourceDeps = {}): Promise<CachedRead<readonly DexPair[]>> {
  if (!MINT.test(mint)) return { ok: false, reason: "That is not a token address." };
  return dexCache.read(mint, async () => {
    const got = await getJson(dexPairsUrl(mint), deps);
    if (!got.ok) return got;
    return { ok: true, value: got.status === 404 ? [] : parseDexPairs(got.body, mint) };
  });
}

export async function readRugCheck(mint: string, deps: SourceDeps = {}): Promise<CachedRead<RugCheckReport | null>> {
  if (!MINT.test(mint)) return { ok: false, reason: "That is not a token address." };
  return rugCache.read(mint, async () => {
    const got = await getJson(rugCheckUrl(mint), deps);
    if (!got.ok) return got;
    if (got.status === 404) return { ok: true, value: null };
    const report = parseRugCheck(got.body);
    return report ? { ok: true, value: report } : { ok: false, reason: "The source answered something that is not a report." };
  });
}

export function resetAssistantSourceCaches(): void {
  dexCache.reset();
  rugCache.reset();
}
