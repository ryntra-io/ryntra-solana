import { NextRequest, NextResponse } from "next/server";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { readPartnerPage, type LaunchLike } from "@/lib/growth/partner-page-store";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { ensureRewardAccount } from "@/lib/rewards/ledger";
import { freeReserveUsdMicros, readReserveLedger } from "@/lib/rewards/reserve";
import { readRewardsReserve } from "@/lib/rewards/treasury.server";
import { referralLink } from "@/lib/rewards/referral";
import { getWalletProofFrom } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Where a creator lands from a partner's link. */
const LAUNCH_PATH = "/app/launch/new";

/**
 * `GET /api/growth/partner/network?address=<wallet>` — «Creator partners» on
 * Rewards, for the wallet that proved itself: level, code and link, activated
 * creators, the money by state, the funnel, one row per launch it is named on
 * and its badges. Read only — nothing is written but the reward account a
 * first visit creates (as `/api/rewards` does), so a person has a link to copy.
 *
 * Never a reason a pool is held and never another person's full address: the
 * page is the partner's own read of the shadow ledger.
 */
function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders() });
}

function publicOrigin(req: NextRequest): string {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  const rate = consumeSolanaReadRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  const address = req.nextUrl.searchParams.get("address") ?? "";
  const proof = await getWalletProofFrom(req.headers).catch(() => null);
  if (!proof || proof.chain !== "solana" || proof.address !== address) return json({ error: "proof required", proof: false }, 401);
  try {
    const store = getGuardRuntime().store;
    const now = new Date().toISOString();
    const account = await ensureRewardAccount(store, address, now);
    const launch = launchNetwork();
    /* The launch lane's own index of a creator's launches on this deployment's network, read only. */
    const launchesOf = async (creator: string): Promise<readonly LaunchLike[]> =>
      launch ? store.collection<LaunchLike>("launchesByCreator").valuesWithPrefix(`solana:${launch.cluster}:${creator}:`) : [];
    /* The partner's link opens the launch: it is for creators, and a creator follows it to launch a token. */
    const link = `${referralLink(publicOrigin(req), account.code)}?to=${LAUNCH_PATH}`;
    /* The free reward reserve, read live as cashback reads it: «Get» never offers what the pot does not hold free. */
    const [reserve, ledger] = await Promise.all([readRewardsReserve(), readReserveLedger(store)]);
    const free = reserve.state === "FUNDED" || reserve.state === "PARTIAL" || reserve.state === "EMPTY" ? freeReserveUsdMicros({ treasuryUsdMicros: reserve.usdMicros, ledger, now }) : null;
    const page = await readPartnerPage(store, { launchesOf }, { wallet: address, referral: { code: account.code, link }, now, freeReserveUsdMicros: free });
    return json({ ok: true, address, page });
  } catch {
    return json({ ok: false, error: "PARTNERS_UNAVAILABLE" }, 503);
  }
}
