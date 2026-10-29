import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { decodeTouch, touchKeyFrom, TOUCH_COOKIE, TOUCH_PENDING_COOKIE } from "@/lib/growth/touch";
import { bindTouchWallet } from "@/lib/growth/touch-store";
import { openCountAllowed } from "@/lib/growth/link-opens";
import { clientIp, privateNoStoreHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { getWalletProof } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/growth/touch` — `{ address }`: the wallet that just appeared in a browser carrying a first touch
 * (Ріст 7). The product's shell sends it once, only while the readable `rgtp` says a touch waits; the source is
 * written for that wallet once and never again (`bindTouchWallet`), and the waiting mark is cleared, so the next
 * wallet in the same browser is not the post's.
 *
 * Nothing changes for the person: no reward, no access, no prompt. A browser can only bind with the touch it
 * carries itself (the cookie is signed), and the panel calls a wallet acquired by the source only when the wallet
 * first appeared after the touch and met it the moment it did — so naming a stranger's wallet, known or not yet seen,
 * moves no number, and one touch binds one wallet (its random name is spent with the binding).
 */
function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders() });
}

const BodySchema = z.object({ address: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/) }).strict();

function settled(body: Record<string, unknown>): NextResponse {
  const response = json(body);
  response.cookies.delete(TOUCH_PENDING_COOKIE);
  return response;
}

export async function POST(req: NextRequest) {
  const rate = consumeSolanaReadRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return json({ error: "forbidden origin" }, 403);
  }
  /* A person connects a wallet or two; a few binds a minute from one network address at most. */
  if (!openCountAllowed(`bind:${clientIp(req.headers)}`)) return json({ error: "rate limited" }, 429);
  const body = await readAgentControlJson(req);
  if (!body.ok) return json({ error: "bad request" }, body.status);
  const parsed = BodySchema.safeParse(body.value);
  if (!parsed.success) return json({ error: "bad request" }, 400);
  const now = Date.now();
  const touch = decodeTouch(req.cookies.get(TOUCH_COOKIE)?.value, touchKeyFrom(process.env), now);
  if (!touch) return settled({ ok: true, bound: false });
  const proof = await getWalletProof().catch(() => null);
  const proven = proof?.chain === "solana" && proof.address === parsed.data.address;
  try {
    const outcome = await bindTouchWallet(getGuardRuntime().store, { wallet: parsed.data.address, touch, now: new Date(now).toISOString(), proven });
    return settled({ ok: true, bound: outcome === "bound" });
  } catch {
    /* The store did not answer: the mark stays, and the next page asks again. */
    return json({ ok: false, error: "TOUCH_UNAVAILABLE" }, 503);
  }
}
