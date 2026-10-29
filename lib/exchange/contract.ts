/**
 * The Exchange's quote contract on Solana's side (B9): what every quote source
 * hands the «Обмін» screen of `@ryntra/core` (A9).
 *
 * `ExchangeQuote` is the core's own shape (`@ryntra/core/ui`, `exchange-model.ts`,
 * from 0.2.0). This build still installs the core at 0.1.0, which carries the
 * contracts the shape is made of (`Quote`, `Amount`, `Fees` — identical in both
 * versions) but not the screen, so the shape is written here once, field for
 * field, and gives way to the core's import when B1 brings 0.2.0 in. Nothing in it
 * is this build's invention.
 *
 * Pure and client-safe: no network, no environment, no clock.
 */

import type { Amount, AssetId, Fees, NetworkId, Quote } from "@ryntra/core/adapters";

/** One executor's quote, as the core's Exchange screen reads it. */
export interface ExchangeQuote {
  /** Stable while the quote is refreshed: the selection follows it. */
  readonly id: string;
  /** As the person reads it: the executor's name. */
  readonly executor: string;
  readonly quote: Quote;
  /** ms, the executor's own estimate; never a promise. */
  readonly delivery_ms: number;
}

/** One side of an exchange: a network and an asset on it, with its decimals already known. */
export type ExchangeSide = Readonly<{
  network: NetworkId;
  /** Mint on Solana (wrapped SOL for SOL), contract on an EVM network. */
  asset: AssetId;
  symbol: string;
  decimals: number;
  /** The network's own coin — SOL, ETH — rather than a token. */
  native: boolean;
  /** Whether the token index vouches for it; false is «nobody has checked», said to the person rather than hidden. */
  verified?: boolean;
}>;

export type ExchangeQuoteRequest = Readonly<{
  /** The intent every quote answers; the screen ranks only quotes of one intent. */
  intentId: string;
  from: ExchangeSide;
  to: ExchangeSide;
  /** Base units of `from`, as typed. Never raised by a provider. */
  amountRaw: string;
  /** The wallet that signs on the source network; some executors price per wallet. */
  user: string | null;
  /** Where the money arrives; on one network, the same wallet. */
  recipient: string | null;
}>;

/**
 * How Ryntra's fee travels with one executor — the B9 «fee parameters», named
 * per executor because each one carries it through its own mechanism and pays it
 * somewhere different.
 */
export type ExchangeFeeRoute = Readonly<{
  executor: string;
  /** The executor's own parameter names, as sent. */
  parameter: string;
  /** Basis points asked for. */
  bps: number;
  /** Where it lands, as the person or an auditor would look for it. */
  paidTo: string;
  /** Whether a receiving address is configured; without one nothing is asked and Review shows no Ryntra line. */
  configured: boolean;
}>;

/** Why a source gave no quote — said per executor, so the screen never reads one silence as all of them. */
export type ExchangeRefusal = Readonly<{
  executor: string;
  code: "NOT_SERVED" | "NO_ROUTE" | "NEEDS_WALLET" | "RATE_LIMITED" | "UNAVAILABLE" | "FEE_NOT_CARRIED";
  reason: string;
}>;

export type ExchangeSourceAnswer = Readonly<{ ok: true; quote: ExchangeQuote; fee: ExchangeFeeRoute }> | Readonly<{ ok: false; refusal: ExchangeRefusal }>;

/** One quote source: an executor that may or may not serve a pair, and answers once. */
export interface ExchangeQuoteSource {
  readonly executor: string;
  /** Same network or across networks, and which ones — decided before anything is asked. */
  serves(request: ExchangeQuoteRequest): boolean;
  quote(request: ExchangeQuoteRequest): Promise<ExchangeSourceAnswer>;
}

/* ---------- small helpers every source shares ---------- */

export const amountOf = (units: bigint | string, asset: AssetId, decimals: number): Amount => ({ units: typeof units === "bigint" ? units.toString() : units, asset, decimals });

/** Drop the fees no executor stated, so the screen draws only the lines that exist. */
export function feesOf(fees: Readonly<Record<keyof Fees, Amount | null | undefined>>): Fees {
  const out: { venue?: Amount; builder?: Amount; ryntra?: Amount; gas?: Amount } = {};
  for (const key of ["venue", "builder", "ryntra", "gas"] as const) {
    const fee = fees[key];
    if (fee && BigInt(fee.units) > 0n) out[key] = fee;
  }
  return out;
}

/** Re-scale base units between two decimals, cutting (never rounding up) when there are fewer. */
export function rescale(units: bigint, from: number, to: number): bigint {
  if (from === to) return units;
  return from > to ? units / 10n ** BigInt(from - to) : units * 10n ** BigInt(to - from);
}

/** A quote id stable for one executor and one intent, so a refresh keeps the selection. */
export const quoteId = (executor: string, intentId: string): string => `${executor.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${intentId}`;
