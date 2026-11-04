import { NextRequest, NextResponse } from "next/server";

import { privateNoStoreHeaders } from "@/lib/http-control";
import { payoutsOn, payoutsTreasury } from "@/lib/partner-payouts/payouts.server";
import { listStatements, readOpenWeek } from "@/lib/partner-payouts/store.server";
import { earningsOf, usdOfMicros } from "@/lib/partner-payouts/week";
import { getWalletProofFrom } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/api/partners/earnings?address=` (CITY-128) — a partner's own figures under decision 93: counted, paid, owed. Behind
 * the same proof `/api/rewards` asks: how much somebody earned is not public. Read from the weekly statements and the
 * running week's snapshot; nothing here counts or pays.
 */
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: privateNoStoreHeaders() });

export async function GET(req: NextRequest) {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return json({ error: "bad_request" }, 400);
  const proof = await getWalletProofFrom(req.headers);
  if (!proof || proof.chain !== "solana" || proof.address !== address) return json({ error: "proof required", proof: false }, 401);
  const treasury = payoutsTreasury();
  if (!payoutsOn() || !treasury) return json({ ok: true, on: false });
  const [statements, open] = await Promise.all([listStatements(treasury.store, treasury.network), readOpenWeek(treasury.store, treasury.network)]);
  const earnings = earningsOf(address, statements, { accrued: BigInt(open?.partners[address] ?? "0"), launch: BigInt(open?.launch?.[address] ?? "0") });
  return json({
    ok: true,
    on: true,
    accrued: usdOfMicros(earnings.accruedMicros),
    swap: usdOfMicros(BigInt(earnings.accruedMicros) - BigInt(earnings.launchMicros)),
    launch: usdOfMicros(earnings.launchMicros),
    paid: usdOfMicros(earnings.paidMicros),
    pending: usdOfMicros(earnings.pendingMicros),
    lastPaidWeek: earnings.lastPaidWeek,
  });
}
