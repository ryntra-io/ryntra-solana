import { NextRequest, NextResponse } from "next/server";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders, publicCacheHeaders } from "@/lib/http-control";
import { readPartnerFacts } from "@/lib/rewards/partner-facts.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/rewards/partner-facts` — what Ryntra Partners pays, as the code computes it (R2).
 *
 * Read only and the same for everybody: no wallet, no session, nothing written — the rules in force are read as
 * stored, never started by this read. Every figure comes from the rules modules (`lib/rewards/partner-facts.ts`);
 * a store that does not answer is a 503, never a guess. Cached for a minute at the edge.
 */
export async function GET(req: NextRequest) {
  const rate = consumeSolanaReadRequest(req.headers);
  if (!rate.allowed) return NextResponse.json({ error: "rate limited" }, { status: 429, headers: privateNoStoreHeaders() });
  let store;
  try {
    store = getGuardRuntime().store;
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: privateNoStoreHeaders() });
  }
  const facts = await readPartnerFacts(store, new Date().toISOString());
  if (!facts) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: privateNoStoreHeaders() });
  return NextResponse.json(facts, { headers: publicCacheHeaders(60, 300) });
}
