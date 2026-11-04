/**
 * Stops on spot (CITY-149) — the pure part, shared by the engine and the city.
 *
 * A stop is the engine's watched kind: «sell when the price falls to», «buy when the price rises to».
 * the person is told, and their wallet signs the sale, or nothing is sold. Nothing here holds a key, and nothing moves
 * by itself.
 *
 * The line is `limitAmounts` of the limits engine — what the amount delivers at that price, in the output's raw units —
 * and the quote's own `outAmountRaw` is compared with it. The city (`city/lib/trade/stops.ts`) and the cron
 * (`./run.ts`) both judge a stop by these two functions, so they can never disagree.
 *
 * Pure and client-safe: no network, no `process.env`, no clock.
 */

import { limitAmounts, rawToDecimal, scaledDecimal } from "../solana/limits/model.ts";

export type StopSide = "buy" | "sell";

export type StopExpiry = "1d" | "7d" | "30d" | "never";
export const STOP_EXPIRIES: readonly StopExpiry[] = ["1d", "7d", "30d", "never"];
const EXPIRY_MS: Record<Exclude<StopExpiry, "never">, number> = { "1d": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };

/** When a stop set now with this expiry stops being watched; null for «until cancelled». */
export function expiresAtOf(expiry: StopExpiry, now: number): number | null {
  return expiry === "never" ? null : now + EXPIRY_MS[expiry];
}

/** A stop's life in the engine: watched, reached and waiting for the person, done (the sale settled), let go, or past its time. */
export type StopState = "watching" | "reached" | "done" | "cancelled" | "expired";

/** At most this many live stops (watched or reached) per wallet. */
export const MAX_STOPS = 20;

export type StopCoin = Readonly<{ mint: string; symbol: string; decimals: number }>;

/** What a stop is made of: the side, the two coins, the amount it spends and the price. */
export type StopTerms = Readonly<{
  side: StopSide;
  /** The coin bought or sold. */
  base: StopCoin;
  /** What the price is counted in, and what pays or is paid. */
  quote: StopCoin;
  /** What the stop spends when reached: the quote on a buy, the base on a sale; raw units. */
  amountRaw: string;
  /** Quote per base, as the person typed it. */
  price: string;
}>;

export const inputMintOf = (stop: Pick<StopTerms, "side" | "base" | "quote">): string => (stop.side === "buy" ? stop.quote.mint : stop.base.mint);
export const outputMintOf = (stop: Pick<StopTerms, "side" | "base" | "quote">): string => (stop.side === "buy" ? stop.base.mint : stop.quote.mint);

/** What `amountRaw` brings at `price`, raw units of the output, by the limits engine's own arithmetic; null when it cannot be a stop. */
export function stopThreshold(input: StopTerms): string | null {
  if (!/^\d+$/.test(input.amountRaw) || BigInt(input.amountRaw) === 0n) return null;
  const scaled = scaledDecimal(input.price, 18);
  if (scaled === null || scaled <= 0n) return null;
  const spentDecimals = input.side === "buy" ? input.quote.decimals : input.base.decimals;
  const amounts = limitAmounts({
    pair: { baseMint: input.base.mint, baseDecimals: input.base.decimals, quoteMint: input.quote.mint, quoteDecimals: input.quote.decimals },
    side: input.side,
    amount: rawToDecimal(input.amountRaw, spentDecimals),
    price: input.price,
  });
  return amounts?.takingRaw ?? null;
}

/** Whether the engine's quote for the stop's amount has come to the stop's price. */
export function stopReached(stop: Readonly<{ thresholdRaw: string }>, outAmountRaw: string): boolean {
  return /^\d+$/.test(outAmountRaw) && /^\d+$/.test(stop.thresholdRaw) && BigInt(outAmountRaw) <= BigInt(stop.thresholdRaw);
}

/** A stop as the engine keeps it under the wallet. Times are milliseconds since the epoch. */
export type EngineStop = StopTerms &
  Readonly<{
    id: string;
    owner: string;
    base: StopCoin & Readonly<{ name: string }>;
    /** What the amount brings at the stop's price, raw units of the output: reached when a quote brings no more. */
    thresholdRaw: string;
    /** The language the person set it in: the note that tells them is said in it. */
    locale: "en" | "uk";
    createdAt: number;
    expiresAt: number | null;
    state: StopState;
    reachedAt: number | null;
    /** What the quote said the amount brings, the moment it was reached. */
    reachedOutRaw: string | null;
    updatedAt: number;
  }>;

/** How the stop stands now: a watched or reached stop past its time has expired, whether the cron has written it yet or not. */
export function stopView(stop: Pick<EngineStop, "state" | "expiresAt">, now: number): StopState {
  if ((stop.state === "watching" || stop.state === "reached") && stop.expiresAt !== null && now >= stop.expiresAt) return "expired";
  return stop.state;
}

/** A stop that still counts against the wallet's limit. */
export const isLive = (stop: Pick<EngineStop, "state" | "expiresAt">, now: number): boolean => {
  const view = stopView(stop, now);
  return view === "watching" || view === "reached";
};

/** Finished stops are kept this long for «My orders», then dropped from the list. */
export const KEEP_FINISHED_MS = 30 * 86_400_000;

/** The id of a stop the engine keeps: `stp_` and twenty hex digits. */
export const STOP_ID = /^stp_[0-9a-f]{20}$/;
