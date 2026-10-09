import { NextRequest, NextResponse } from "next/server";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { rewardBalance } from "@/lib/rewards/balance";
import { usdText } from "@/lib/rewards/format";
import { listRewardEntries } from "@/lib/rewards/ledger";
import { heldUsdMicros, readReserveLedger } from "@/lib/rewards/reserve";
import { REWARD_MINIMUM_CLAIM_USD_MICROS } from "@/lib/rewards/model";
import { readRewardsReserve, rewardsTreasuryConfig } from "@/lib/rewards/treasury.server";
import { getWalletProofFrom } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * `GET /api/rewards/balance?address=<wallet>` — only what the header's
 * «Винагороди» needs: how much has gathered, whether it may be claimed now
 * (the same rule as Rewards: the minimum, and payouts switched on), and how
 * much is still on its way.
 *
 * The header asks from every page, so this is a read and nothing else: no
 * queue replayed, no account created, no referral edge written (those belong
 * to opening Rewards itself, `/api/rewards`). The treasury's balance is a
 * chain read; it is kept a few minutes per instance, since a header light
 * does not need it to the second and the RPC quota is the trading pages'.
 * Behind the wallet's own proof, as every reward figure is.
 */

const RESERVE_TTL_MS = 5 * 60 * 1000;
let reserveCache: { at: number; value: ReturnType<typeof readRewardsReserve> } | null = null;

function reserve(): ReturnType<typeof readRewardsReserve> {
  const now = Date.now();
  if (!reserveCache || now - reserveCache.at > RESERVE_TTL_MS) {
    const value = readRewardsReserve();
    reserveCache = { at: now, value };
    /* A failed read is not kept: the next ask tries again. */
    value.catch(() => {
      if (reserveCache?.value === value) reserveCache = null;
    });
  }
  return reserveCache.value;
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders() });
}

export async function GET(req: NextRequest) {
  const rate = consumeSolanaReadRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  const address = new URL(req.url).searchParams.get("address") ?? "";
  const proof = await getWalletProofFrom(req.headers);
  if (!proof || proof.chain !== "solana" || proof.address !== address) {
    return json({ error: "proof required", proof: false }, 401);
  }
  try {
    const store = getGuardRuntime().store;
    const [entries, treasury, ledger] = await Promise.all([listRewardEntries(store, address), reserve(), readReserveLedger(store)]);
    const balance = rewardBalance({ entries, reserve: treasury, heldUsdMicros: heldUsdMicros(ledger, new Date().toISOString()) });
    const config = rewardsTreasuryConfig();
    return json({
      ok: true,
      address,
      available: usdText(balance.availableUsdMicros),
      pending: usdText(balance.pendingUsdMicros),
      claimable: balance.claimable && config.configured && config.canSign,
      minimum: usdText(REWARD_MINIMUM_CLAIM_USD_MICROS),
    });
  } catch {
    return json({ ok: false, error: "REWARDS_UNAVAILABLE" }, 503);
  }
}
