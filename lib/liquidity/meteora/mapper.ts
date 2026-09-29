/**
 * Meteora's DLMM and DAMM v2 Data API pool records → Ryntra's `LiquidityPool`.
 *
 * Pure. One record in, one normalized pool out — or null when the record is
 * not a pool that contains the mint asked for, or is malformed in a way that
 * would put a figure on the page the venue did not state. The field
 * meanings come from the venue's own OpenAPI documents, read on 2026-09-21:
 * `tvl` is "total liquidity the liquidity pair holding, also known as Total
 * Value Locked"; `volume` and `fees` are `TimeWindowData` over 30m … 24h;
 * `pool_config.base_fee_pct` is the "base fee rate"; DLMM's `dynamic_fee_pct`
 * is "base fee + variable fee"; `is_blacklisted` is the venue's own flag.
 */

import { counterKindOf, type LiquidityPool, type LiquidityPoolKind, type PoolToken } from "../model.ts";

export const METEORA_DATA_API: Readonly<Record<LiquidityPoolKind, string>> = {
  dlmm: "https://dlmm.datapi.meteora.ag",
  "damm-v2": "https://damm-v2.datapi.meteora.ag",
};

/** The venue's own pool pages, in the path forms its documentation links use. */
export const METEORA_APP_PATH: Readonly<Record<LiquidityPoolKind, string>> = {
  dlmm: "https://app.meteora.ag/dlmm",
  "damm-v2": "https://app.meteora.ag/dammv2",
};

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
const text = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : null);

function token(raw: unknown): PoolToken | null {
  if (typeof raw !== "object" || raw === null) return null;
  const node = raw as Record<string, unknown>;
  const mint = text(node.address, 44);
  if (!mint || !BASE58.test(mint)) return null;
  const decimals = typeof node.decimals === "number" && Number.isInteger(node.decimals) && node.decimals >= 0 && node.decimals <= 18 ? node.decimals : null;
  return { mint, symbol: text(node.symbol, 32) ?? mint.slice(0, 4) + "…", name: text(node.name, 80) ?? "", decimals };
}

function window24h(raw: unknown): number | null {
  if (typeof raw !== "object" || raw === null) return null;
  return finite((raw as Record<string, unknown>)["24h"]);
}

const epochMsToIso = (value: unknown): string | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  /* The Data APIs state milliseconds; a value that reads as seconds is treated as such. */
  const ms = value < 1e12 ? value * 1000 : value;
  return new Date(ms).toISOString();
};

/**
 * Map one record. `mint` is the verified stock mint the list was filtered
 * by; a record that does not carry it on either side is not this stock's
 * pool, whatever the search matched on.
 */
export function mapMeteoraPool(raw: unknown, kind: LiquidityPoolKind, mint: string, stockMints: ReadonlySet<string>): LiquidityPool | null {
  if (typeof raw !== "object" || raw === null) return null;
  const node = raw as Record<string, unknown>;
  const address = text(node.address, 44);
  if (!address || !BASE58.test(address)) return null;
  const x = token(node.token_x);
  const y = token(node.token_y);
  if (!x || !y) return null;
  const stockSide: "x" | "y" | null = x.mint === mint ? "x" : y.mint === mint ? "y" : null;
  if (!stockSide) return null;
  const stock = stockSide === "x" ? x : y;
  const counter = stockSide === "x" ? y : x;
  const config = typeof node.pool_config === "object" && node.pool_config !== null ? (node.pool_config as Record<string, unknown>) : {};
  const launchpad = text(node.launchpad, 64);
  return {
    provider: "meteora",
    kind,
    address,
    name: text(node.name, 120) ?? `${x.symbol}-${y.symbol}`,
    stockSide,
    stock,
    counter,
    counterKind: counterKindOf(counter.mint, stockMints),
    tvlUsd: finite(node.tvl),
    volume24hUsd: window24h(node.volume),
    fees24hUsd: window24h(node.fees),
    baseFeePct: finite(config.base_fee_pct),
    dynamicFeePct: kind === "dlmm" ? finite(node.dynamic_fee_pct) : null,
    stockAmount: finite(stockSide === "x" ? node.token_x_amount : node.token_y_amount),
    counterAmount: finite(stockSide === "x" ? node.token_y_amount : node.token_x_amount),
    createdAt: epochMsToIso(node.created_at),
    blacklisted: node.is_blacklisted === true,
    launchpad,
    source: { api: `${METEORA_DATA_API[kind]}/pools/${address}`, page: `${METEORA_APP_PATH[kind]}/${address}` },
  };
}

/** The list endpoint's page: `{ total, data: [...] }`. Returns null when the body is not that shape. */
export function mapMeteoraPage(body: unknown, kind: LiquidityPoolKind, mint: string, stockMints: ReadonlySet<string>): Readonly<{ total: number | null; pools: readonly LiquidityPool[] }> | null {
  if (typeof body !== "object" || body === null) return null;
  const node = body as Record<string, unknown>;
  if (!Array.isArray(node.data)) return null;
  const pools: LiquidityPool[] = [];
  const seen = new Set<string>();
  for (const raw of node.data) {
    const pool = mapMeteoraPool(raw, kind, mint, stockMints);
    if (pool && !seen.has(pool.address)) {
      seen.add(pool.address);
      pools.push(pool);
    }
  }
  const total = typeof node.total === "number" && Number.isInteger(node.total) && node.total >= 0 ? node.total : null;
  return { total, pools };
}
