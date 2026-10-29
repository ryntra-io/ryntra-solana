/**
 * Meteora, read-only and keyless: the DLMM and DAMM v2 Data APIs — the same public endpoints Ryntra's engine reads.
 *
 * A pool record gives this package three things: a second, independent price (the pool's own `current_price`, the
 * price of token X in token Y, turned into dollars), the pool's depth and trading, and Meteora's own statement of
 * whether the token's freeze authority is disabled. DAMM v2 is also where a DBC launch graduates, so the same reader
 * confirms a graduation Jupiter states.
 *
 * The venue's limits are 30 (DLMM) and 10 (DAMM v2) requests a second; a 429 comes back as a value and is not retried.
 * The Data APIs state no time for a record, so readings carry `timeFrom: "read"`.
 */

import { measure, notMeasured, valueOf, type Measured, type Reading } from "../contract.ts";
import type { AuthorityRead } from "../badges.ts";
import { readJson, type JsonRead, type ReadDeps } from "./http.ts";
import { isMint } from "./jupiter.ts";

export const METEORA_KINDS = ["dlmm", "damm-v2"] as const;
export type MeteoraKind = (typeof METEORA_KINDS)[number];

export const METEORA_BASE: Readonly<Record<MeteoraKind, string>> = Object.freeze({
  dlmm: "https://dlmm.datapi.meteora.ag",
  "damm-v2": "https://damm-v2.datapi.meteora.ag",
});

const SOURCE = { dlmm: "meteora-dlmm", "damm-v2": "meteora-damm-v2" } as const;

/** Dollar stablecoins whose pools price a token in dollars directly. */
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
export const WSOL = "So11111111111111111111111111111111111111112";
const DOLLARS: ReadonlySet<string> = new Set([USDC, USDT]);

export const POOLS_PAGE_SIZE = 10;

/** The pools holding a mint on either side, deepest first — the venue's own filter syntax. */
export function meteoraPoolsUrl(kind: MeteoraKind, mint: string, base = METEORA_BASE[kind]): string {
  const filter = encodeURIComponent(`token_x=${mint} || token_y=${mint}`);
  return `${base}/pools?page_size=${POOLS_PAGE_SIZE}&sort_by=tvl:desc&filter_by=${filter}`;
}

export const meteoraPoolUrl = (kind: MeteoraKind, address: string, base = METEORA_BASE[kind]): string => `${base}/pools/${address}`;

export type MeteoraPool = Readonly<{
  kind: MeteoraKind;
  address: string;
  url: string;
  observedAt: string;
  /** The side of the pool the asked mint is on, and the other side's mint. */
  side: "x" | "y";
  counterMint: string;
  /** The asked token's price in the counter token, from the pool's own `current_price`. */
  priceInCounter: Measured;
  tvlUsd: Measured;
  volume24hUsd: Measured;
  blacklisted: boolean;
  launchpad: string | null;
  /** Meteora's statement of the asked token's freeze authority. */
  freeze: AuthorityRead;
}>;

const record = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

/** A non-negative figure; the venue's negatives are faults, not readings. */
const amount = (raw: unknown): Measured => {
  const figure = measure(raw);
  return figure.state === "measured" && figure.value < 0 ? notMeasured("negative figure") : figure;
};

/** One pool record, as seen from `mint`; null when the record is not a pool that holds it. */
export function parseMeteoraPool(raw: unknown, kind: MeteoraKind, mint: string, readAt: string): MeteoraPool | null {
  const node = record(raw);
  if (!node || !isMint(node.address)) return null;
  const x = record(node.token_x);
  const y = record(node.token_y);
  if (!x || !y || !isMint(x.address) || !isMint(y.address)) return null;
  const side = x.address === mint ? "x" : y.address === mint ? "y" : null;
  if (!side) return null;
  const own = side === "x" ? x : y;
  const counter = side === "x" ? y : x;
  /* `current_price` is X in Y. From Y's side it is the inverse; a zero price has no inverse and measured nothing. */
  const current = measure(node.current_price);
  const priceInCounter: Measured =
    current.state !== "measured" || current.value <= 0 ? notMeasured("pool states no price") : side === "x" ? current : { state: "measured", value: 1 / current.value };
  const volume = record(node.volume);
  const url = meteoraPoolUrl(kind, node.address);
  const disabled = own.freeze_authority_disabled;
  return {
    kind,
    address: node.address,
    url,
    observedAt: readAt,
    side,
    counterMint: counter.address as string,
    priceInCounter,
    tvlUsd: amount(node.tvl),
    volume24hUsd: amount(volume?.["24h"]),
    blacklisted: node.is_blacklisted === true,
    launchpad: typeof node.launchpad === "string" && node.launchpad.length > 0 ? node.launchpad : null,
    freeze: { authority: "freeze", source: SOURCE[kind], url, observedAt: readAt, state: disabled === true ? "revoked" : disabled === false ? "active" : "not_measured" },
  };
}

/** A list page `{ data: [...] }`, or a single pool record, as pools holding `mint`; each address once. */
export function parseMeteoraPools(body: unknown, kind: MeteoraKind, mint: string, readAt: string): MeteoraPool[] {
  const node = record(body);
  const rows = node && Array.isArray(node.data) ? node.data : node ? [node] : [];
  const seen = new Set<string>();
  const out: MeteoraPool[] = [];
  for (const raw of rows) {
    const pool = parseMeteoraPool(raw, kind, mint, readAt);
    if (pool && !seen.has(pool.address)) {
      seen.add(pool.address);
      out.push(pool);
    }
  }
  return out;
}

/**
 * The pool's price in dollars, as a reading: the deepest pool of this kind that is not blacklisted and holds at least
 * `minTvlUsd`, priced in a dollar stablecoin directly or in SOL through `solUsd`. Null when no pool qualifies.
 */
export function poolPriceReading(pools: readonly MeteoraPool[], args: Readonly<{ minTvlUsd: number; solUsd: number | null }>): Reading | null {
  const deep = pools
    .filter((pool) => !pool.blacklisted && (valueOf(pool.tvlUsd) ?? -1) >= args.minTvlUsd && pool.priceInCounter.state === "measured")
    .filter((pool) => DOLLARS.has(pool.counterMint) || (pool.counterMint === WSOL && args.solUsd !== null))
    .sort((a, b) => (valueOf(b.tvlUsd) ?? 0) - (valueOf(a.tvlUsd) ?? 0))[0];
  if (!deep) return null;
  const inCounter = valueOf(deep.priceInCounter) as number;
  const dollars = DOLLARS.has(deep.counterMint);
  return {
    source: SOURCE[deep.kind],
    url: deep.url,
    observedAt: deep.observedAt,
    timeFrom: "read",
    value: { state: "measured", value: dollars ? inCounter : inCounter * (args.solUsd as number) },
    derivation: dollars ? "pool price in a dollar stablecoin" : "pool price in SOL × SOL/USD",
  };
}

/** The pools' summed depth in dollars, or `not_measured` when no pool stated one. */
export function poolsDepth(pools: readonly MeteoraPool[]): Measured {
  const stated = pools.filter((pool) => !pool.blacklisted).map((pool) => valueOf(pool.tvlUsd)).filter((value): value is number => value !== null);
  return stated.length ? { state: "measured", value: stated.reduce((sum, value) => sum + value, 0) } : notMeasured("no pool stated its depth");
}

export type MeteoraRead = Readonly<{ pools: readonly MeteoraPool[]; failures: readonly Extract<JsonRead, { ok: false }>[] }>;

/** Read the pools holding `mint` from both Data APIs. Failures are listed; whatever was read is returned. */
export async function readMeteoraPools(mint: string, deps: ReadDeps = {}): Promise<MeteoraRead> {
  const pools: MeteoraPool[] = [];
  const failures: Extract<JsonRead, { ok: false }>[] = [];
  for (const kind of METEORA_KINDS) {
    const read = await readJson(meteoraPoolsUrl(kind, mint), deps);
    if (read.ok) pools.push(...parseMeteoraPools(read.body, kind, mint, read.readAt));
    else failures.push(read);
  }
  return { pools, failures };
}

/** Read one DAMM v2 pool by address — the pool a DBC launch graduated into — as seen from `mint`. */
export async function readGraduatedPool(address: string, mint: string, deps: ReadDeps = {}): Promise<{ pool: MeteoraPool | null; failure: Extract<JsonRead, { ok: false }> | null }> {
  if (!isMint(address)) return { pool: null, failure: null };
  const read = await readJson(meteoraPoolUrl("damm-v2", address), deps);
  if (!read.ok) return { pool: null, failure: read };
  return { pool: parseMeteoraPools(read.body, "damm-v2", mint, read.readAt).find((pool) => pool.address === address) ?? null, failure: null };
}
