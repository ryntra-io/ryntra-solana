/**
 * CITY-174 — a regular buy of a fixed size with its price held on chain (decision 95 (b)).
 *
 * The person says: buy this much every so often, never above this price. The policy then pins the input to exactly the
 * size, the output's mint, and the minimum it must bring — so the highest price she pays is the size over the floor,
 * whoever holds the agent's key (CITY-136 §2, «межа ціни»). The day's cap is one buy per period times the buys a day.
 *
 * Here: the floor from a price, and the agent's decision on each tick — buy when the market is under the ceiling, wait
 * when it is not (a buy above it would fall on chain anyway, and the agent never pays the fee for that).
 */

import type { PublicKey } from "@solana/web3.js";

import type { FixedBuy } from "./terms.ts";

/**
 * The floor of a buy: at most `maxPrice` of the budget per one whole output token. Amounts are base units; the price is
 * a decimal in whole tokens (budget per output), as a person types it. Rounded up — the floor never lets a cent more.
 */
export function floorFor(input: Readonly<{ amountIn: bigint; budgetDecimals: number; outputDecimals: number; maxPrice: string }>): bigint {
  const match = /^(\d+)(?:\.(\d{1,18}))?$/.exec(input.maxPrice.trim());
  if (!match) throw new Error("the price is a plain decimal");
  const fraction = match[2] ?? "";
  const priceScaled = BigInt(match[1]! + fraction);
  if (priceScaled === 0n) throw new Error("the price is above zero");
  /* minOut = amountIn / 10^bd / price × 10^od = amountIn × 10^(od + f) / (priceScaled × 10^bd). */
  const numerator = input.amountIn * 10n ** BigInt(input.outputDecimals + fraction.length);
  const denominator = priceScaled * 10n ** BigInt(input.budgetDecimals);
  return (numerator + denominator - 1n) / denominator;
}

export function fixedBuy(outputMint: PublicKey, amountIn: bigint, minOut: bigint): FixedBuy {
  if (amountIn <= 0n || minOut <= 0n) throw new Error("a regular buy has a size and a floor");
  return { amountIn, outputMint, minOut };
}

export type BuyTick = Readonly<{ action: "buy"; minOut: bigint }> | Readonly<{ action: "wait"; reason: "price-above-ceiling" | "spent-today" }>;

/** On a tick: buy with the floor as the minimum when the quote clears it; otherwise wait for the market. */
export function buyTick(input: Readonly<{ buy: FixedBuy; quoteOut: bigint; spentToday: bigint; perDay: bigint }>): BuyTick {
  if (input.spentToday + input.buy.amountIn > input.perDay) return { action: "wait", reason: "spent-today" };
  if (input.quoteOut < input.buy.minOut) return { action: "wait", reason: "price-above-ceiling" };
  return { action: "buy", minOut: input.buy.minOut };
}
