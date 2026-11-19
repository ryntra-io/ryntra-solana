import { NextResponse } from "next/server";

import { apiFailure, apiHeaders } from "@/lib/api/v1/http";
import { isPoolAddress } from "@/lib/earn-pools/bins";
import { earnProGate } from "@/lib/earn-pro/gate";
import { earnProClosed, openEarnProRead } from "@/lib/earn-pro/http.server";
import { publicCacheHeaders, rateLimitHeaders } from "@/lib/http-control";
import type { ProPoolAnswer } from "@/lib/pro-pools/model";
import { readProPool } from "@/lib/pro-pools/read.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * `GET /api/pro/pools/<address>` — one Meteora DLMM Pro pool, read now: the same row as the list's, for the
 * pool's own page. Public and read-only; kept twenty seconds.
 */
export async function GET(request: Request, { params }: { params: Promise<{ address: string }> }) {
  const door = openEarnProRead(request);
  if (!door.ok) return door.response;
  const gate = earnProGate(process.env);
  if (!gate.open) return earnProClosed(door.rate);
  const { address } = await params;
  if (!isPoolAddress(address)) return apiFailure("VALIDATION_ERROR", "address: a pool's address.", { headers: rateLimitHeaders(door.rate) });
  const row = await readProPool(gate.network, address).catch(() => undefined);
  if (row === undefined) return apiFailure("UNAVAILABLE", "The chain did not answer for the pool. Try again.", { headers: rateLimitHeaders(door.rate) });
  if (row === null) return apiFailure("EARN_PRO_NOT_A_PIER","No Meteora DLMM Pro pool at the address.", { headers: rateLimitHeaders(door.rate) });
  const body: ProPoolAnswer = { network: gate.network, at: new Date().toISOString(), pool: row };
  return NextResponse.json(body, { headers: { ...apiHeaders(), ...publicCacheHeaders(15, 30), ...rateLimitHeaders(door.rate), Vary: "X-Ryntra-API" } });
}
