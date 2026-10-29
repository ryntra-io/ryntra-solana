import { NextRequest, NextResponse } from "next/server";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { liquidityView } from "@/lib/growth/liquidity";
import { readLiquiditySightings } from "@/lib/growth/liquidity-read.server";
import { readLiquidity, recordLiquiditySighting } from "@/lib/growth/liquidity-store";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { logoutNavigationAllowed, mutationOriginAllowed } from "@/lib/security";
import { getWalletProofFrom } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/growth/liquidity?address=<wallet>` — the liquidity badges of the
 * wallet that proved itself: Pool Contributor · Steward · Strategist, from
 * its Meteora positions read on Solana now (the Pools pages' own read), and
 * whether it chose to show them on the boards.
 *
 * The read is the evidence: a counted position in range adds today to the
 * wallet's days and dates any badge it reaches — only when the request comes
 * from this site's own page, so a link elsewhere cannot add a day nobody
 * looked at (it gets the view, unwritten). Nothing else is written, no
 * position or amount is kept, and nothing here moves money — liquidity earns
 * badges, never a payment. Solana not answering adds nothing
 * and takes nothing: the page shows what was earned before.
 */
function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders() });
}

export async function GET(req: NextRequest) {
  const rate = consumeSolanaReadRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  const address = req.nextUrl.searchParams.get("address") ?? "";
  const proof = await getWalletProofFrom(req.headers).catch(() => undefined);
  if (proof === undefined) return json({ ok: false, error: "LIQUIDITY_UNAVAILABLE" }, 503);
  if (!proof || proof.chain !== "solana" || proof.address !== address) return json({ error: "proof required", proof: false }, 401);
  try {
    const store = getGuardRuntime().store;
    /* Ryntra's own page: an Origin or Fetch-Metadata of this site, or — for a browser that sends neither — its Referer. */
    const ownPage =
      mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site")) ||
      (req.headers.get("origin") === null && logoutNavigationAllowed(req.url, req.headers.get("sec-fetch-site"), req.headers.get("referer")));
    const read = await readLiquiditySightings(address).catch(() => ({ ok: false }) as const);
    const record = read.ok && ownPage ? await recordLiquiditySighting(store, address, read.positions, read.at) : await readLiquidity(store, address);
    return json({ ok: true, address, liquidity: liquidityView(record, read.ok ? read : null) });
  } catch {
    return json({ ok: false, error: "LIQUIDITY_UNAVAILABLE" }, 503);
  }
}
