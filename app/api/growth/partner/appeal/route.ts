import { NextRequest, NextResponse } from "next/server";

import { consumeAgentControlRequest } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { readPoolPartner } from "@/lib/growth/partner-store";
import { poolSubject, walletSubject } from "@/lib/growth/review";
import { actOnCase } from "@/lib/growth/review-store";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { getWalletProofFrom } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/growth/partner/appeal` — a person's appeal on a review that holds
 * their money: `{ network?, pool?, text }`. With `pool` — one of their own
 * partner pools (`network` solana by default, or arc); without — their own
 * wallet's freeze. One appeal until it is answered. Behind proof of the wallet;
 * the words are kept in the case's log, the answer is due within 72 hours. It
 * says nothing about why the money is held: that is the reviewer's.
 */
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: privateNoStoreHeaders() });
const POOL: Readonly<Record<"solana" | "arc", RegExp>> = { solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, arc: /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/ };

export async function POST(req: NextRequest) {
  const rate = consumeAgentControlRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) return json({ error: "forbidden" }, 403);
  const proof = await getWalletProofFrom(req.headers).catch(() => null);
  if (!proof || proof.chain !== "solana") return json({ error: "proof required", proof: false }, 401);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "bad request" }, 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "bad request" }, 400);
  }
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 1000) : "";
  if (!text) return json({ error: "text required" }, 400);
  const network = body.network === undefined || body.network === "solana" ? "solana" : body.network === "arc" ? "arc" : null;
  if (!network) return json({ error: "bad request" }, 400);
  const pool = body.pool === undefined || body.pool === null ? null : typeof body.pool === "string" && POOL[network].test(body.pool) ? (network === "arc" ? body.pool.toLowerCase() : body.pool) : undefined;
  if (pool === undefined) return json({ error: "bad request" }, 400);
  const store = getGuardRuntime().store;
  try {
    let subject = walletSubject(proof.address);
    if (pool) {
      /* Only the pool's own partner appeals on it — and a pool that is not theirs reads the same as no case. */
      const binding = await readPoolPartner(store, network, pool);
      if (!binding || binding.partner !== proof.address) return json({ ok: false, state: "NO_CASE" }, 404);
      subject = poolSubject(network, pool);
    }
    const outcome = await actOnCase(store, { subject, action: { kind: "APPEAL", note: text }, by: "person", now: new Date().toISOString() });
    if (!outcome.ok && outcome.code === "UNAVAILABLE") return json({ ok: false, state: "UNAVAILABLE" }, 503);
    /* One answer whatever stands behind the pool — a case, a reason found at the launch, nothing — so the answer
       never tells which; the words are with the reviewer, who answers within 72 hours. */
    return json({ ok: true });
  } catch {
    return json({ ok: false, state: "UNAVAILABLE" }, 503);
  }
}
