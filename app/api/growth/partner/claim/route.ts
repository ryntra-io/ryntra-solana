import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSupportsConcurrentInstances } from "@/lib/guard/store";
import { claimPartnerPayout, observePayout, payoutSlotKey } from "@/lib/growth/partner-payout";
import { payoutChainReads, payoutDeps } from "@/lib/growth/partner-payout.server";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { formatUsdMicros } from "@/lib/rewards/model";
import { mutationOriginAllowed } from "@/lib/security";
import { getWalletProof } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/growth/partner/claim` — a creator partner takes what their pools
 * made available, to their own proven Solana wallet: the cashback claim's path
 * (`/api/rewards/claim`), the same treasury and reserve, a receipt per payout.
 * Open only after the canary's receipt; until then it answers `NOT_OPEN`.
 * `GET` observes and settles a payout already running; it never starts one.
 */
const RequestSchema = z.object({ address: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/) }).strict();
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: privateNoStoreHeaders() });

const STATUS: Readonly<Record<string, number>> = {
  PAID: 200,
  CLAIMING: 202,
  SUBMITTED_UNKNOWN: 202,
  FAILED: 502,
  NOT_OPEN: 409,
  ON_REVIEW: 409,
  STOPPED: 409,
  NOT_CLAIMABLE: 409,
  RESERVE_SHORT: 409,
  RESERVE_UNAVAILABLE: 503,
  ALREADY_RUNNING: 409,
  PAUSED: 409,
};

export async function POST(req: NextRequest) {
  const rate = consumeAgentControlRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) return json({ error: "forbidden origin" }, 403);
  const proof = await getWalletProof();
  if (!proof || proof.chain !== "solana") return json({ state: "PROOF_REQUIRED", proof: false }, 401);
  const body = await readAgentControlJson(req);
  const input = body.ok ? RequestSchema.safeParse(body.value) : null;
  if (!input?.success) return json({ state: "REFRESH_REQUIRED" }, 400);
  /* The body binds the screen to the proof; the only wallet ever paid is the proven one. */
  if (input.data.address !== proof.address) return json({ state: "WALLET_CHANGED", proof: false }, 409);
  const store = getGuardRuntime().store;
  if (!storeSupportsConcurrentInstances(store)) return json({ state: "STORE_NOT_DURABLE" }, 503);
  try {
    const out = await claimPartnerPayout(store, payoutDeps(), { wallet: proof.address });
    return json(
      { ok: out.state === "PAID", state: out.state, amount: out.usdMicros ? formatUsdMicros(BigInt(out.usdMicros)) : null, signature: out.signature ?? null },
      STATUS[out.state] ?? 409,
    );
  } catch {
    return json({ state: "UNAVAILABLE" }, 503);
  }
}

export async function GET(req: NextRequest) {
  const rate = consumeAgentControlRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  const proof = await getWalletProof();
  const address = new URL(req.url).searchParams.get("address");
  if (!proof || proof.chain !== "solana" || (address && address !== proof.address)) return json({ proof: false }, 401);
  try {
    const slot = await observePayout(getGuardRuntime().store, payoutChainReads(), payoutSlotKey("solana", proof.address));
    return json({ ok: true, payout: slot ? { state: slot.state, amount: formatUsdMicros(BigInt(slot.usdMicros)), signature: slot.signature } : null });
  } catch {
    return json({ state: "UNAVAILABLE" }, 503);
  }
}
