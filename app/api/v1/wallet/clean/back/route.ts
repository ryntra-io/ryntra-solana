import { NextResponse } from "next/server";

import type { WalletCleanBackResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiHeaders } from "@/lib/api/v1/http";
import { privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { openCleanRead } from "@/lib/wallet-clean/http.server";
import { cleanBackAnswer } from "@/lib/wallet-clean/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * `GET /api/v1/wallet/clean/back?owner=` (contract 1.94.0) — «≈ … SOL to get back» from the chain alone: the rent of
 * every empty token account the owner may close, and wrapped SOL. No market read; a coin still held is not counted.
 */
export async function GET(request: Request) {
  const door = openCleanRead(request);
  if (!door.ok) return door.response;
  const answer = await cleanBackAnswer(door.owner).catch(() => null);
  if (!answer) return apiFailure("UNAVAILABLE", "The chain did not answer for this wallet. Try again.", { headers: rateLimitHeaders(door.rate) });
  return NextResponse.json(answer satisfies WalletCleanBackResponse, { headers: { ...apiHeaders(), ...privateNoStoreHeaders(), ...rateLimitHeaders(door.rate), Vary: "X-Ryntra-API" } });
}
