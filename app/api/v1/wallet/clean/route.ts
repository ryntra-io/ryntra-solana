import { NextResponse } from "next/server";

import type { WalletCleanReadResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiHeaders } from "@/lib/api/v1/http";
import { privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { openCleanRead } from "@/lib/wallet-clean/http.server";
import { cleanReadAnswer } from "@/lib/wallet-clean/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/wallet/clean?owner=` (contract 1.94.0) — what a clean of the wallet would take: small coins swapped into
 * SOL, empty accounts closed for their rent, litter burnt, wrapped SOL unwrapped; and the risk marks of every coin it
 * holds. Public, as the chain is; never kept.
 */
export async function GET(request: Request) {
  const door = openCleanRead(request);
  if (!door.ok) return door.response;
  const answer = await cleanReadAnswer(door.owner).catch(() => null);
  if (!answer) return apiFailure("UNAVAILABLE", "The chain did not answer for this wallet. Try again.", { headers: rateLimitHeaders(door.rate) });
  return NextResponse.json(answer satisfies WalletCleanReadResponse, { headers: { ...apiHeaders(), ...privateNoStoreHeaders(), ...rateLimitHeaders(door.rate), Vary: "X-Ryntra-API" } });
}
