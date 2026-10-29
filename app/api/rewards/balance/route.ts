import { NextRequest, NextResponse } from "next/server";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { walletHold } from "@/lib/growth/review-store";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { claimMinimumUsdMicros, rewardBalance } from "@/lib/rewards/balance";
import { readRewardRulesInForce } from "@/lib/rewards/rank-store";
import type { RewardPayoutAccount } from "@/lib/rewards/model";
import { usdText } from "@/lib/rewards/format";
import { internalWalletsForMoney } from "@/lib/rewards/internal";
import { listRewardEntries } from "@/lib/rewards/ledger";
import { heldUsdMicros, readReserveLedger } from "@/lib/rewards/reserve";
import { readPayoutAccount, readRewardsReserve, rewardsTreasuryConfig } from "@/lib/rewards/treasury.server";
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

/* Whether a wallet holds a USDC account changes rarely: kept a few minutes per instance, a failed read not at all. */
const accountCache = new Map<string, { at: number; value: RewardPayoutAccount }>();

async function payoutAccount(wallet: string): Promise<RewardPayoutAccount> {
  const now = Date.now();
  const cached = accountCache.get(wallet);
  if (cached && now - cached.at <= RESERVE_TTL_MS) return cached.value;
  const value = await readPayoutAccount(wallet);
  if (value !== "UNKNOWN") {
    if (accountCache.size > 2_000) accountCache.clear();
    accountCache.set(wallet, { at: now, value });
  }
  return value;
}

/* The owner's and the test wallets (Ріст 3): the list changes rarely — kept a minute per instance, a failed read not at all. */
let internalCache: { at: number; value: ReadonlySet<string> } | null = null;

async function internalWallets(store: ReturnType<typeof getGuardRuntime>["store"]): Promise<ReadonlySet<string> | null> {
  const now = Date.now();
  if (internalCache && now - internalCache.at <= 60_000) return internalCache.value;
  const value = await internalWalletsForMoney(store, process.env);
  if (value) internalCache = { at: now, value };
  return value;
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
    const now = new Date().toISOString();
    /* The rules in force as stored — the header starts nothing; a failed read keeps the dollar. */
    const rules = await readRewardRulesInForce(store, now).catch(() => null);
    const [entries, treasury, ledger, account] = await Promise.all([
      listRewardEntries(store, address), reserve(), readReserveLedger(store),
      rules?.claimFloor ? payoutAccount(address) : Promise.resolve<RewardPayoutAccount>("UNKNOWN"),
    ]);
    const minimum = claimMinimumUsdMicros(rules, account);
    const balance = rewardBalance({ entries, reserve: treasury, heldUsdMicros: heldUsdMicros(ledger, now), minimumUsdMicros: minimum });
    const config = rewardsTreasuryConfig();
    /* The header says what the Rewards page says: a wallet a review holds or stopped has nothing ready to claim. */
    const hold = await walletHold(store, address, new Date().toISOString()).catch(() => "REVIEW" as const);
    /* …and a team wallet, or one the list could not tell about, has nothing to claim either. */
    const internal = await internalWallets(store);
    const team = internal === null || internal.has(address);
    return json({
      ok: true,
      address,
      available: usdText(balance.availableUsdMicros),
      pending: usdText(balance.pendingUsdMicros),
      claimable: balance.claimable && config.configured && config.canSign && hold === "NONE" && !team,
      minimum: usdText(minimum),
    });
  } catch {
    return json({ ok: false, error: "REWARDS_UNAVAILABLE" }, 503);
  }
}
