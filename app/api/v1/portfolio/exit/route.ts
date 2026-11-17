import { NextResponse } from "next/server";

import type { PortfolioExitOverviewResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiHeaders } from "@/lib/api/v1/http";
import { privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { openExitRead } from "@/lib/portfolio/exit/http.server";
import { exitOverviewAnswer } from "@/lib/portfolio/exit/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/portfolio/exit?owner=&mode=&target=` — what one approval would take out of
 * the wallet's positions: `mode=exit` — every position one step leaves, into `target` (SOL, USDC or SPLIT);
 * `mode=collect` — only the pools' fees. Each step picked or not, what no step takes out with its reason, and «≈» of
 * what comes. Nothing is built; public, as the chain is.
 */
export async function GET(request: Request) {
  const door = openExitRead(request);
  if (!door.ok) return door.response;
  const answer = await exitOverviewAnswer({ owner: door.owner, mode: door.mode, target: door.target }).catch(() => null);
  if (!answer) return apiFailure("UNAVAILABLE", "The portfolio could not be read. Try again.", { headers: rateLimitHeaders(door.rate) });
  return NextResponse.json(answer satisfies PortfolioExitOverviewResponse, { headers: { ...apiHeaders(), ...privateNoStoreHeaders(), ...rateLimitHeaders(door.rate), Vary: "X-Ryntra-API" } });
}
