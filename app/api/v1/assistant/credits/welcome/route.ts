import { welcomeHolderForWallet } from "@/app/api/v1/agent/runtime";
import { claimWelcome, rpcWalletHistory } from "@/lib/assistant/credits/welcome";
import { readCreditsResponse } from "@/lib/assistant/credits/view";
import type { AssistantCreditsResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { FixedWindowLimiter, rateLimitHeaders } from "@/lib/http-control";
import { resolveEndpoint } from "@/lib/solana/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Six asks a minute per wallet on a warm instance; the one-time claim itself is the store's. */
const limiter = new FixedWindowLimiter({ limit: 6, windowMs: 60_000, maxKeys: 5_000 });

/**
 * `POST /api/v1/assistant/credits/welcome` (contract 1.52.0) — the welcome
 * credits, once per wallet and once per account: for a wallet that has lived
 * and acted (its history read from one public RPC call, nothing signed).
 * `WELCOME_TAKEN` when they were given, `WELCOME_NOT_ELIGIBLE` for a wallet
 * younger or quieter than the check — the free credits of every day are its
 * anyway.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const rate = limiter.consume(proof.address);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many asks in a minute; try again shortly.", { headers: rateLimitHeaders(rate) });
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "Credits need a durable store; this deployment does not have one.");
  const nowMs = Date.now();
  const resolved = await welcomeHolderForWallet(proof.address, nowMs);
  if (!resolved) return apiFailure("CAPABILITY_UNAVAILABLE", "Credits are switched off on this deployment.");
  /* One welcome per account needs the account known: when the accounts store is silent, none is given now. */
  if (!resolved.known) return apiFailure("UNAVAILABLE", "Whether this wallet belongs to an account could not be read now; try again shortly.", { headers: rateLimitHeaders(rate) });
  const context = { holder: resolved.holder, config: resolved.config };
  const claimed = await claimWelcome(guard.store, { holder: resolved.holder, wallet: proof.address, accountId: resolved.accountId, history: rpcWalletHistory(resolveEndpoint("mainnet")), config: resolved.config, nowMs });
  if (!claimed.ok) return apiFailure(claimed.code, claimed.reason, { headers: rateLimitHeaders(rate) });
  return apiJson((await readCreditsResponse(guard.store, context, nowMs, claimed.credits)) satisfies AssistantCreditsResponse, 200, { ...rateLimitHeaders(rate), "cache-control": "private, no-store" });
}
