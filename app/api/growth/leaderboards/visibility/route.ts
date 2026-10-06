import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { setBoardVisibility } from "@/lib/growth/league-store";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { getWalletProof } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/growth/leaderboards/visibility` — `{ address, hidden }`.
 *
 * Hide a wallet from every board, or show it again. Only the wallet itself
 * may, behind its own proof and from this site's own pages. Hidden, it is
 * left off every board on the next read and its avatar wears no frame
 * anywhere else; nothing it earned changes.
 */
function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders() });
}

const BodySchema = z.object({ address: z.string().min(32).max(64), hidden: z.boolean() }).strict();

export async function POST(req: NextRequest) {
  const rate = consumeSolanaReadRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return json({ error: "forbidden origin" }, 403);
  }
  const body = await readAgentControlJson(req);
  if (!body.ok) return json({ error: "bad request" }, body.status);
  const parsed = BodySchema.safeParse(body.value);
  if (!parsed.success) return json({ error: "bad request" }, 400);
  const proof = await getWalletProof();
  if (!proof || proof.chain !== "solana" || proof.address !== parsed.data.address) {
    return json({ error: "proof required", proof: false }, 401);
  }
  try {
    await setBoardVisibility(getGuardRuntime().store, { wallet: parsed.data.address, hidden: parsed.data.hidden, now: new Date().toISOString() });
    return json({ ok: true, hidden: parsed.data.hidden });
  } catch {
    return json({ ok: false, error: "VISIBILITY_UNAVAILABLE" }, 503);
  }
}
