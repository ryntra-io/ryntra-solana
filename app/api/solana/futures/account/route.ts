import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { WALLET } from "@/lib/phoenix/market-data";
import { readFuturesAccount } from "@/lib/phoenix/read.server";

import { answer, failure } from "../respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * A wallet's Phoenix account (B7): `?wallet=<address>` — its collateral, positions and resting orders, read by the
 * public address alone, as Phoenix serves them to anyone. Nothing is signed or held; never cached.
 */
export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  if (!WALLET.test(wallet)) return failure(400, "VALIDATION_ERROR", "An account is addressed by a Solana wallet address.", rate);
  return answer(await readFuturesAccount(wallet), rate, "private");
}
