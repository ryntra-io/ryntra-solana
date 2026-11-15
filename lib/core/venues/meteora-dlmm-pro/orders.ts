/**
 * How much of a DLMM Pro limit order has filled.
 *
 * The program emits nothing when a swap fills an order, and the order's own account does not say: it keeps, per tick,
 * the amount it put in and the tick's batch counter at that moment (`age`). The state lives on the tick. Orders
 * resting at a tick fill in batches: when a swap first reaches the tick's waiting orders they all become one batch
 * (`totalProcessingOrderAmount`), the counter (`orderAge`) goes up by one, and the batch then fills pro rata
 * (`processedOrderRemainingAmount` is what is left of it). Orders placed after that wait for the next batch, which
 * starts only when this one is gone. So, by the gap between the tick's counter and the order's:
 *
 * - 0 — still resting, nothing filled;
 * - 1 — in the batch being filled: unfilled is `amount × batch unfilled / batch total`, rounded up;
 * - 2 or more — its batch is finished: filled whole.
 *
 * What a fill pays is settled only when the owner collects (the program's `cancel_limit_order`): the unfilled part
 * comes back in the order's own token, the filled part in the other at the tick's exact price, rounded down, and with
 * it a share of the fee the tick's orders earned — `fee pool × this fill / all fills not yet collected`, rounded down,
 * in the fee's token (token X for an ask, token Y for a bid; token Y for both when the pool collects only in Y).
 *
 * A collected tick stays in the order with amount zero until the order is closed.
 *
 * Pure: no I/O, no clock, no SDK. Amounts are `bigint`.
 */

export type OrderEntry = Readonly<{ tickId: number; isAsk: boolean; amount: bigint; age: bigint }>;

/** A tick's limit-order fields, as its tick array keeps them. */
export type TickOrderState = Readonly<{
  tickId: number;
  /** The tick's square-root price, Q64.64: the price every order on it fills at. */
  sqrtPrice: bigint;
  orderAge: bigint;
  openOrderAmount: bigint;
  totalProcessingOrderAmount: bigint;
  processedOrderRemainingAmount: bigint;
  /** Filled and not yet collected, in the deposit token of each side. */
  fulfilledOrderAmountX: bigint;
  fulfilledOrderAmountY: bigint;
  /** The makers' fee pools of the two sides. */
  limitOrderFeeAskSide: bigint;
  limitOrderFeeBidSide: bigint;
}>;

export type OrderFillState = "collected" | "resting" | "partial" | "filled";

export type OrderFill = Readonly<{
  tickId: number;
  side: "ask" | "bid";
  state: OrderFillState;
  /** What the order put on this tick, in its own token: X for an ask, Y for a bid. */
  amountRaw: bigint;
  filledRaw: bigint;
  unfilledRaw: bigint;
  /** What the filled part pays in the other token — Y for an ask, X for a bid — at the tick's price, rounded down. */
  proceedsRaw: bigint;
  /** The maker's share of the tick's fee pool were it collected now, before a referral's fifth; in the fee's token. */
  feeShareRaw: bigint;
}>;

/** Token Y for `amountX` at a tick's price, rounded down: `amount × sqrtPrice² / 2¹²⁸`. */
export function yForX(amountX: bigint, sqrtPrice: bigint): bigint {
  return (amountX * sqrtPrice * sqrtPrice) >> 128n;
}

/** Token X for `amountY` at a tick's price, rounded down: `amount × 2¹²⁸ / sqrtPrice²`. */
export function xForY(amountY: bigint, sqrtPrice: bigint): bigint {
  if (sqrtPrice === 0n) throw new Error("A tick's price is zero.");
  return (amountY << 128n) / (sqrtPrice * sqrtPrice);
}

const ceilDiv = (numerator: bigint, denominator: bigint): bigint => (numerator + denominator - 1n) / denominator;

/**
 * One tick of an order against its tick's state. A tick whose counter is behind the order's cannot be read — the
 * program calls it an undetermined error — and throws here too.
 */
export function orderFillOf(entry: OrderEntry, tick: TickOrderState): OrderFill {
  if (entry.tickId !== tick.tickId) throw new Error(`The order's tick ${entry.tickId} is not the tick ${tick.tickId}.`);
  const side = entry.isAsk ? "ask" : "bid";
  if (entry.amount === 0n) return { tickId: entry.tickId, side, state: "collected", amountRaw: 0n, filledRaw: 0n, unfilledRaw: 0n, proceedsRaw: 0n, feeShareRaw: 0n };
  const gap = tick.orderAge - entry.age;
  if (gap < 0n) throw new Error(`The order at tick ${entry.tickId} is ahead of its tick.`);
  let unfilled: bigint;
  if (gap === 0n) unfilled = entry.amount;
  else if (gap === 1n) unfilled = tick.totalProcessingOrderAmount === 0n ? 0n : ceilDiv(entry.amount * tick.processedOrderRemainingAmount, tick.totalProcessingOrderAmount);
  else unfilled = 0n;
  if (unfilled > entry.amount) unfilled = entry.amount;
  const filled = entry.amount - unfilled;
  const proceeds = filled === 0n ? 0n : entry.isAsk ? yForX(filled, tick.sqrtPrice) : xForY(filled, tick.sqrtPrice);
  const pool = entry.isAsk ? tick.limitOrderFeeAskSide : tick.limitOrderFeeBidSide;
  const allFilled = entry.isAsk ? tick.fulfilledOrderAmountX : tick.fulfilledOrderAmountY;
  const feeShare = filled === 0n || allFilled === 0n ? 0n : (pool * filled) / allFilled;
  return {
    tickId: entry.tickId,
    side,
    state: filled === 0n ? "resting" : unfilled === 0n ? "filled" : "partial",
    amountRaw: entry.amount,
    filledRaw: filled,
    unfilledRaw: unfilled,
    proceedsRaw: proceeds,
    feeShareRaw: feeShare > pool ? pool : feeShare,
  };
}

export type OrderSummary = Readonly<{
  /** The side of what is left of the order; null once every tick is collected. */
  side: "ask" | "bid" | null;
  /** Ticks not yet collected. */
  live: number;
  amountRaw: bigint;
  filledRaw: bigint;
  unfilledRaw: bigint;
  proceedsRaw: bigint;
  feeShareRaw: bigint;
  /** Every tick collected: the order can be closed and its rent taken back. */
  closable: boolean;
}>;

/** A whole order from its ticks. */
export function orderSummaryOf(fills: readonly OrderFill[]): OrderSummary {
  const live = fills.filter((fill) => fill.state !== "collected");
  const sum = (pick: (fill: OrderFill) => bigint) => live.reduce((total, fill) => total + pick(fill), 0n);
  return {
    /* From a tick still in the order: the program empties a collected one — its side too — so an order collected whole says none. */
    side: live[0]?.side ?? null,
    live: live.length,
    amountRaw: sum((fill) => fill.amountRaw),
    filledRaw: sum((fill) => fill.filledRaw),
    unfilledRaw: sum((fill) => fill.unfilledRaw),
    proceedsRaw: sum((fill) => fill.proceedsRaw),
    feeShareRaw: sum((fill) => fill.feeShareRaw),
    closable: fills.length > 0 && live.length === 0,
  };
}

/**
 * What collecting pays the owner, per token, before any Token-2022 transfer fee and before a referral's share of the
 * fee: the unfilled amounts back, the proceeds, and the fee shares in the fee's token. Several ticks of one order share
 * a fee pool only when they are the same tick, which an order never has, so the shares add up.
 */
export function collectPayoutOf(fills: readonly OrderFill[], feeOnlyInY: boolean): Readonly<{ xRaw: bigint; yRaw: bigint }> {
  let x = 0n;
  let y = 0n;
  for (const fill of fills) {
    if (fill.state === "collected") continue;
    if (fill.side === "ask") {
      x += fill.unfilledRaw;
      y += fill.proceedsRaw;
      if (feeOnlyInY) y += fill.feeShareRaw;
      else x += fill.feeShareRaw;
    } else {
      y += fill.unfilledRaw + fill.feeShareRaw;
      x += fill.proceedsRaw;
    }
  }
  return { xRaw: x, yRaw: y };
}
