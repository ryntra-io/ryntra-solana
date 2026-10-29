/**
 * How the Spot workspace shows a wallet's limit orders outside their table: a
 * line on the chart at the price each open order fills at, a mark on the
 * candle where one filled, and the count of the ones still waiting. Pure:
 * the orders come from «Мої ордери»' one read (`use-limit-orders.ts`).
 */

import type { ChartMarkerSpec, PriceLineSpec } from "../../../../lib/chart/types.ts";
import type { LimitOrderView } from "../../../../lib/solana/limits/sync.server.ts";
import type { LimitOrderState } from "../../../../lib/solana/limits/store.server.ts";

export type LimitToken = Readonly<{ symbol: string | null; decimals: number | null }>;

/* The quote assets' scale, known without a read: a busy catalogue never leaves a SOL or a dollar order unpriced. */
const KNOWN_DECIMALS: Readonly<Record<string, number>> = {
  So11111111111111111111111111111111111111112: 9,
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6,
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 6,
};

function decimalsOf(tokens: Readonly<Record<string, LimitToken>>, mint: string): number | null {
  return tokens[mint]?.decimals ?? KNOWN_DECIMALS[mint] ?? null;
}

/** The orders that can still fill — what the count, the lines and «Скасувати» are about. */
export const OPEN_LIMIT_STATES: ReadonlySet<LimitOrderState> = new Set(["PLACING", "OPEN", "PARTIAL", "CANCELLING"]);

export function isOpenLimit(order: Pick<LimitOrderView, "state">): boolean {
  return OPEN_LIMIT_STATES.has(order.state);
}

/** Quote per base the order fills at: the reviewed one when Ryntra placed it, else the two amounts' ratio. */
export function limitOrderPrice(order: LimitOrderView, tokens: Readonly<Record<string, LimitToken>>): number | null {
  if (order.fillPrice !== null && Number.isFinite(order.fillPrice) && order.fillPrice > 0) return order.fillPrice;
  const base = decimalsOf(tokens, order.baseMint);
  const quote = decimalsOf(tokens, order.quoteMint);
  if (base == null || quote == null || order.takingRaw === "0") return null;
  const making = Number(order.makingRaw);
  const taking = Number(order.takingRaw);
  if (!(making > 0) || !(taking > 0)) return null;
  const price = order.side === "buy" ? making / 10 ** quote / (taking / 10 ** base) : taking / 10 ** quote / (making / 10 ** base);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/** How much of the base the order buys or sells, as a number for a label. */
export function limitOrderBaseAmount(order: LimitOrderView, tokens: Readonly<Record<string, LimitToken>>): number | null {
  const decimals = decimalsOf(tokens, order.baseMint);
  if (decimals == null) return null;
  const raw = order.side === "buy" ? order.takingRaw : order.makingRaw;
  const value = Number(raw) / 10 ** decimals;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function openLimitCount(orders: readonly LimitOrderView[], baseMint?: string | null): number {
  return orders.filter((order) => isOpenLimit(order) && (baseMint == null || order.baseMint === baseMint)).length;
}

/**
 * One dashed line per open order of this market, at the price it fills at, in
 * the chart's own unit: dollars (a quote's dollar price converts it; a quote
 * whose price is not known draws no line rather than a wrong one), times the
 * supply when the chart shows the capitalisation. A buy is drawn in the
 * rising colour, a sale in the falling one.
 */
export function limitOrderLines(
  args: Readonly<{
    orders: readonly LimitOrderView[];
    tokens: Readonly<Record<string, LimitToken>>;
    baseMint: string;
    quoteUsd: (mint: string) => number | null;
    capFactor: number | null;
    label: (order: LimitOrderView, amount: number | null) => string;
  }>,
): PriceLineSpec[] {
  const lines: PriceLineSpec[] = [];
  for (const order of args.orders) {
    if (!isOpenLimit(order) || order.baseMint !== args.baseMint) continue;
    const price = limitOrderPrice(order, args.tokens);
    const usd = args.quoteUsd(order.quoteMint);
    if (price === null || usd === null || !(usd > 0)) continue;
    const value = price * usd * (args.capFactor ?? 1);
    if (!Number.isFinite(value) || value <= 0) continue;
    lines.push({
      id: `limit:${order.key}`,
      price: value,
      color: order.side === "buy" ? "up" : "down",
      title: args.label(order, limitOrderBaseAmount(order, args.tokens)),
      style: "dashed",
      width: 1,
    });
  }
  return lines;
}

/** A mark on the candle where a limit order of this market filled: below the bar for a buy, above it for a sale. */
export function limitFillMarkers(orders: readonly LimitOrderView[], baseMint: string, text: string): ChartMarkerSpec[] {
  const marks: ChartMarkerSpec[] = [];
  for (const order of orders) {
    if (order.baseMint !== baseMint) continue;
    for (const fill of order.fills) {
      const time = Math.floor(Date.parse(fill.at) / 1000);
      if (!Number.isFinite(time) || time <= 0) continue;
      marks.push(
        order.side === "buy"
          ? { time, position: "belowBar", shape: "arrowUp", color: "up", text }
          : { time, position: "aboveBar", shape: "arrowDown", color: "down", text },
      );
    }
  }
  return marks;
}
