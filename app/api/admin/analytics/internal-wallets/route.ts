import { NextResponse } from "next/server";

import { addInternalWallet, internalWalletsFromEnv, isInternalWalletAddress, listInternalWallets, removeInternalWallet } from "@/lib/admin/internal-wallets";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The owner's internal-wallet list: the test wallets the business figures
 * leave out. Admin session only. The deployment's own list is reported
 * beside it and cannot be edited from here — it is configuration, not data.
 */
export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const listed = await listInternalWallets(getGuardRuntime().store);
  if (listed.status !== "measured") return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json(
    { wallets: listed.rows, fromEnv: internalWalletsFromEnv(process.env) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await readBody(request);
  const wallet = body?.wallet;
  const label = typeof body?.label === "string" && body.label.trim().length > 0 ? body.label.trim() : "internal";
  if (!isInternalWalletAddress(wallet)) return NextResponse.json({ error: "bad_wallet" }, { status: 400 });
  const result = await addInternalWallet(getGuardRuntime().store, { wallet, label, now: new Date().toISOString() });
  if (!result.ok) return NextResponse.json({ error: result.reason === "INVALID" ? "bad_request" : "unavailable" }, { status: result.reason === "INVALID" ? 400 : 503 });
  return NextResponse.json({ ok: true, created: result.created });
}

export async function DELETE(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await readBody(request);
  const wallet = body?.wallet;
  if (!isInternalWalletAddress(wallet)) return NextResponse.json({ error: "bad_wallet" }, { status: 400 });
  const removed = await removeInternalWallet(getGuardRuntime().store, wallet);
  if (!removed) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json({ ok: true });
}
