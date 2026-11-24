import { NextRequest, NextResponse } from "next/server";

import { privateNoStoreHeaders } from "@/lib/http-control";
import { reportError } from "@/lib/monitor";
import { decideBearerAuth, LEGACY_KEY_ERROR } from "@/lib/security";
import { copyMoneyMinute } from "@/lib/wallet-watch/copy-money-minute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * «Повторюй за гаманцем» with money at work (vercel.json, every minute — a copy builds at most one order a
 * minute): one pass of her copies on mainnet (`lib/wallet-watch/copy-money-minute.server.ts`). Only while the switch is
 * open (`RYNTRA_AGENT_COPY=on`, the agent's mandate on mainnet, its KMS key the registry's agent); closed, it reads nothing,
 * sends nothing and says why. Called by Vercel's cron with `CRON_SECRET`; anything else is refused.
 */
export async function GET(req: NextRequest) {
  const decision = decideBearerAuth({ authorization: req.headers.get("authorization"), legacyKeyPresent: req.nextUrl.searchParams.has("key") }, process.env.CRON_SECRET);
  if (decision === "legacy-rejected") return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401, headers: privateNoStoreHeaders() });
  if (decision !== "authorized") return NextResponse.json({ ok: false }, { status: 401, headers: privateNoStoreHeaders() });
  try {
    const answer = await copyMoneyMinute(process.env);
    return NextResponse.json({ ok: true, ...answer }, { headers: privateNoStoreHeaders() });
  } catch (error) {
    /* A pass that failed whole is taken again a minute on: each order is written down before it is sent. */
    void reportError("cron:agent-copy", error, {});
    return NextResponse.json({ ok: false, error: "COPY_UNAVAILABLE" }, { status: 503, headers: privateNoStoreHeaders() });
  }
}
