/**
 * The Meteora Data APIs, read the way the resilience work reads an issuer:
 * one bounded call per pool kind, a byte ceiling, one retry on a fast 5xx
 * only — never on a 429 (asking again is the wrong answer to "too many"),
 * never after a timeout (asking again doubles the silence). The two APIs
 * are keyless and rate-limited by the venue at 30 (DLMM) and 10 (DAMM v2)
 * requests a second; the reader above caches per mint so a page never
 * spends more than two calls.
 *
 * The filter is the venue's own syntax, verified on 2026-09-21:
 * `filter_by=token_x=<mint> || token_y=<mint>` returns every pool that holds
 * the mint on either side and nothing else; `sort_by=tvl:desc` puts the deep
 * pools first, so one page of 200 carries every pool that could matter.
 */

import { mapMeteoraPage } from "./mapper.ts";
import { METEORA_DATA_API } from "./mapper.ts";
import type { LiquidityPool, LiquidityPoolKind } from "../model.ts";

export const METEORA_PAGE_SIZE = 200;
export const METEORA_TIMEOUT_MS = 6_000;
/** More than any list this feature reads (200 pools ≈ 700 KB); a body past it is a fault, not data. */
export const METEORA_MAX_BYTES = 2_000_000;

export type MeteoraPoolsRead = Readonly<{ ok: true; kind: LiquidityPoolKind; pools: readonly LiquidityPool[]; total: number | null; fetchedAt: string }>;
export type MeteoraFailure = Readonly<{ ok: false; kind: LiquidityPoolKind; code: "HTTP" | "SHAPE" | "NETWORK" | "RATE_LIMITED" | "TIMEOUT" | "TOO_LARGE"; reason: string }>;

export type MeteoraDeps = Readonly<{
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}>;

export function meteoraPoolsUrl(kind: LiquidityPoolKind, mint: string): string {
  const filter = encodeURIComponent(`token_x=${mint} || token_y=${mint}`);
  return `${METEORA_DATA_API[kind]}/pools?page_size=${METEORA_PAGE_SIZE}&sort_by=tvl:desc&filter_by=${filter}`;
}

const isTimeout = (error: unknown): boolean => error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

/** Every pool of one kind that holds the mint, mapped; or the reason there is none. */
export async function readMeteoraPools(kind: LiquidityPoolKind, mint: string, stockMints: ReadonlySet<string>, deps: MeteoraDeps = {}): Promise<MeteoraPoolsRead | MeteoraFailure> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? METEORA_TIMEOUT_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const url = meteoraPoolsUrl(kind, mint);
  let response: Response | null = null;
  let lastError: unknown = null;
  for (let round = 0; round < 2; round += 1) {
    if (round > 0) await sleep(500);
    try {
      const answer = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
      if (answer.ok || answer.status < 500) {
        response = answer;
        break;
      }
      /* A fast 5xx is the venue's own fault and the one case a second read is a safe read. */
      response = answer;
      lastError = null;
    } catch (error) {
      lastError = error;
      if (isTimeout(error)) return { ok: false, kind, code: "TIMEOUT", reason: `Meteora did not answer within ${timeoutMs} ms.` };
    }
  }
  if (!response) return { ok: false, kind, code: "NETWORK", reason: lastError instanceof Error ? lastError.message : String(lastError) };
  if (response.status === 429) return { ok: false, kind, code: "RATE_LIMITED", reason: "Meteora's rate limit was reached." };
  if (!response.ok) return { ok: false, kind, code: "HTTP", reason: `Meteora answered ${response.status}.` };
  const length = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > METEORA_MAX_BYTES) return { ok: false, kind, code: "TOO_LARGE", reason: "Meteora's answer is larger than this reader accepts." };
  let body: unknown;
  try {
    const raw = await response.text();
    if (raw.length > METEORA_MAX_BYTES) return { ok: false, kind, code: "TOO_LARGE", reason: "Meteora's answer is larger than this reader accepts." };
    body = JSON.parse(raw) as unknown;
  } catch (error) {
    return { ok: false, kind, code: "SHAPE", reason: `Meteora's answer is not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const page = mapMeteoraPage(body, kind, mint, stockMints);
  if (!page) return { ok: false, kind, code: "SHAPE", reason: "Meteora's answer is not a pool list." };
  return { ok: true, kind, pools: page.pools, total: page.total, fetchedAt: (deps.now ?? (() => new Date()))().toISOString() };
}
