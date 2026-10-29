import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { isHistoryKind } from "@/lib/phoenix/history";
import { SYMBOL, WALLET } from "@/lib/phoenix/market-data";
import { readFuturesFundingHistory, readFuturesOrderHistory, readFuturesTrades } from "@/lib/phoenix/read.server";

import { answer, failure } from "../respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * A wallet's own history on Phoenix's perpetuals (PERP-5, spec §11.1): `?wallet=<address>&kind=trades|orders|funding`
 * and, to narrow it to one market, `&symbol=SOL` — the fills it made with their fees and realised result, the orders
 * it placed and what became of each, and the funding it paid or received with the time of every settlement. Phoenix's
 * own public reads by the public address alone, as the account read is; nothing is signed or held, and never cached.
 */
export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const params = new URL(request.url).searchParams;
  const wallet = params.get("wallet") ?? "";
  const kind = params.get("kind") ?? "";
  const symbol = params.get("symbol");
  if (!WALLET.test(wallet)) return failure(400, "VALIDATION_ERROR", "A history is addressed by a Solana wallet address.", rate);
  if (!isHistoryKind(kind)) return failure(400, "VALIDATION_ERROR", "A history is one of trades, orders or funding.", rate);
  if (symbol !== null && !SYMBOL.test(symbol)) return failure(400, "VALIDATION_ERROR", "A market is addressed by its symbol.", rate);
  if (kind === "trades") return answer(await readFuturesTrades(wallet, symbol), rate, "private");
  if (kind === "orders") return answer(await readFuturesOrderHistory(wallet, symbol), rate, "private");
  return answer(await readFuturesFundingHistory(wallet, symbol), rate, "private");
}
