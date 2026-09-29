import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSupportsConcurrentInstances } from "@/lib/guard/store";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { openClaim, readClaim, transitionClaim, claimUnresolved, armClaim } from "@/lib/rewards/claim";
import { reconcileClaimOnChain } from "@/lib/rewards/claim-settlement.server";
import { listRewardEntries, totalRewards } from "@/lib/rewards/ledger";
import { formatUsdMicros } from "@/lib/rewards/model";
import { payRewardClaim, readRewardsReserve } from "@/lib/rewards/treasury.server";
import { heldUsdMicros, holdReserve, readReserveLedger, releaseReserve } from "@/lib/rewards/reserve";
import { rewardBalance } from "@/lib/rewards/balance";
import { mutationOriginAllowed } from "@/lib/security";
import { getWalletProof } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RequestSchema = z.object({ address: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/) }).strict();
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: privateNoStoreHeaders() });

/** The body binds the current screen to the proof. It cannot redirect payment:
 * the only payable address is still the server's proven wallet. */
export async function POST(req: NextRequest) {
  const rate = consumeAgentControlRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) return json({ error: "forbidden origin" }, 403);
  const proof = await getWalletProof();
  if (!proof || proof.chain !== "solana") return json({ state: "PROOF_REQUIRED", proof: false }, 401);
  const body = await readAgentControlJson(req);
  const input = body.ok ? RequestSchema.safeParse(body.value) : null;
  if (!input?.success) return json({ state: "REFRESH_REQUIRED", reason: "Refresh the page before claiming." }, 400);
  if (input.data.address !== proof.address) return json({ state: "WALLET_CHANGED", proof: false }, 409);
  const wallet = proof.address;
  const store = getGuardRuntime().store;
  if (!storeSupportsConcurrentInstances(store)) return json({ state: "STORE_NOT_DURABLE" }, 503);
  const now = new Date().toISOString();
  try {
    const existing = await readClaim(store, wallet);
    if (claimUnresolved(existing)) {
      // Checking an old payout never starts another in the same request.
      const settled = await reconcileClaimOnChain(store, existing!, now);
      return json({ ok: !settled.stillOpen, state: settled.state }, settled.stillOpen ? 202 : 200);
    }
    if (existing) await reconcileClaimOnChain(store, existing, now);
    const [entries, reserve, ledger] = await Promise.all([listRewardEntries(store, wallet), readRewardsReserve(), readReserveLedger(store)]);
    const balance = rewardBalance({ entries, reserve, heldUsdMicros: heldUsdMicros(ledger, now) });
    if (!balance.claimable) return json({ state: "NOT_CLAIMABLE", reason: balance.claimBlockedReason, available: formatUsdMicros(balance.availableUsdMicros) }, 409);
    const amount = balance.availableUsdMicros;
    const opened = await openClaim(store, { wallet, usdMicros: amount, now, expectedVersion: existing?.version ?? null });
    if (!opened.ok) return json({ state: "ALREADY_RUNNING", reason: opened.reason }, 409);
    const claimId = opened.claim.claimId;
    const held = await holdReserve(store, { claimId, wallet, usdMicros: amount, treasuryUsdMicros: reserve.usdMicros, now });
    if (!held.ok) {
      await transitionClaim(store, { wallet, claimId, from: "CLAIMING", to: "FAILED", at: now, note: held.reason });
      return json({ state: "RESERVE_UNAVAILABLE" }, 409);
    }
    const paid = await payRewardClaim({ wallet, usdMicros: amount, beforeSubmit: async prepared => {
      const armed = await armClaim(store, { wallet, claimId, ...prepared, at: new Date().toISOString() });
      return armed.ok;
    } });
    if (!paid.ok && paid.code !== "SUBMIT_UNKNOWN") {
      const failed = await transitionClaim(store, { wallet, claimId, from: "CLAIMING", to: "FAILED", at: new Date().toISOString(), note: paid.reason });
      if (failed.ok) { await releaseReserve(store, claimId, new Date().toISOString()); return json({ state: "FAILED" }, 502); }
      // A lost acknowledgement of the arm may already have stored its signature.
    }
    const current = await readClaim(store, wallet);
    if (!current || current.claimId !== claimId) return json({ state: "SUBMITTED_UNKNOWN" }, 202);
    const settled = await reconcileClaimOnChain(store, current, new Date().toISOString());
    return json({ ok: settled.state === "PAID", state: settled.state, amount: formatUsdMicros(amount), signature: current.signature }, settled.stillOpen ? 202 : 200);
  } catch {
    return json({ state: "UNAVAILABLE", reason: "The payout could not be checked right now." }, 503);
  }
}

/** Polling observes and settles an existing claim; it cannot build or send. */
export async function GET(req: NextRequest) {
  const rate = consumeAgentControlRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  const proof = await getWalletProof();
  const address = new URL(req.url).searchParams.get("address");
  if (!proof || proof.chain !== "solana" || (address && address !== proof.address)) return json({ proof: false }, 401);
  try {
    const store = getGuardRuntime().store;
    const existing = await readClaim(store, proof.address);
    if (existing) await reconcileClaimOnChain(store, existing, new Date().toISOString());
    const claim = await readClaim(store, proof.address);
    const entries = await listRewardEntries(store, proof.address);
    return json({ ok: true, address: proof.address, claim: claim ? { state: claim.state, amount: formatUsdMicros(BigInt(claim.usdMicros)), signature: claim.signature } : null,
      claimed: formatUsdMicros(totalRewards(entries).claimedUsdMicros) });
  } catch { return json({ state: "UNAVAILABLE" }, 503); }
}
