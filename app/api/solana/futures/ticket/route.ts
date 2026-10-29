import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { readTicketMargin } from "@/lib/phoenix/margin.server";
import { SYMBOL, WALLET } from "@/lib/phoenix/market-data";
import { MAX_PERP_SLIPPAGE_BPS, MIN_PERP_SLIPPAGE_BPS } from "@/lib/phoenix/orders-model";

import { answer, failure } from "../respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const DIGITS = /^\d{1,20}$/;

/**
 * The Perps ticket's margin by Phoenix's SDK (PERP-4): `?wallet&symbol&side=long|short&type=market|limit&leverage` and,
 * when typed, `size` (base lots), a limit's `price` (ticks), `reduceOnly=1`, `slippageBps`, `feeBps` (Phoenix's taker
 * rate and Ryntra's, the estimate's fees) and `fill` (ticks: where the page's book fills a market order). The account's
 * health, the most the order may be, its margin, fees and the estimated liquidation price after it — read only, never
 * cached: it is the person's account.
 */
export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const query = new URL(request.url).searchParams;
  const wallet = query.get("wallet") ?? "";
  const symbol = query.get("symbol") ?? "";
  const side = query.get("side");
  const type = query.get("type");
  const size = query.get("size") ?? "";
  const price = query.get("price") ?? "";
  const fill = query.get("fill") ?? "";
  const leverage = Number(query.get("leverage"));
  const slippage = Number(query.get("slippageBps") ?? MIN_PERP_SLIPPAGE_BPS);
  const fee = Number(query.get("feeBps") ?? "0");
  const valid =
    WALLET.test(wallet) &&
    SYMBOL.test(symbol) &&
    (side === "long" || side === "short") &&
    (type === "market" || type === "limit") &&
    (size === "" || DIGITS.test(size)) &&
    (type === "market" ? price === "" : DIGITS.test(price) && BigInt(price) > 0n) &&
    (fill === "" || DIGITS.test(fill)) &&
    Number.isInteger(leverage) &&
    leverage >= 1 &&
    leverage <= 1_000 &&
    Number.isInteger(slippage) &&
    slippage >= MIN_PERP_SLIPPAGE_BPS &&
    slippage <= MAX_PERP_SLIPPAGE_BPS &&
    Number.isFinite(fee) &&
    fee >= 0 &&
    fee <= 100;
  if (!valid) return failure(400, "VALIDATION_ERROR", "A ticket is a wallet, a market, a side, a type and a leverage; sizes and prices in lots and ticks.", rate);
  const read = await readTicketMargin(wallet, {
    symbol,
    side: side as "long" | "short",
    type: type as "market" | "limit",
    limitTicks: type === "limit" ? BigInt(price) : null,
    sizeLots: size === "" ? null : BigInt(size),
    reduceOnly: query.get("reduceOnly") === "1",
    leverage,
    slippageBps: slippage,
    feeRate: fee / 10_000,
    fillTicks: fill === "" ? null : BigInt(fill),
  });
  return answer(read, rate, "private");
}
