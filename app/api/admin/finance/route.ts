import { NextResponse, after } from "next/server";

import { isFinanceScope } from "@/lib/admin/finance";
import { readFinanceModel } from "@/lib/admin/finance.server";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Ryntra's financial panel (SOL-F1): earned · claimable · claimed · paid to creators · cashback · friends' rewards ·
 * costs · net, each beside the chain's record of it, and the launch business's figures.
 *
 * Admin session only; read only — nothing here signs, sends or writes. `scope=external` leaves Ryntra's own launches
 * and wallets out. The model may come from a read up to ten minutes old, which it names (`readAt`); `fresh=1` reads again.
 */
export async function GET(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const scope = params.get("scope") ?? "all";
  if (!isFinanceScope(scope)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  try {
    const { model: finance, running } = await readFinanceModel(scope, { fresh: params.get("fresh") === "1" });
    /* A newer read running behind this answer is kept alive after it, so it settles whole rather than frozen mid-way. */
    if (running) after(() => running.catch(() => undefined));
    return NextResponse.json({ finance }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
