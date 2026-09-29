import { NextRequest, NextResponse } from "next/server";

import { processBroadcastQueue } from "@/lib/admin/broadcast-queue";
import { decideBearerAuth, LEGACY_KEY_ERROR } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const decision = decideBearerAuth(
    {
      authorization: req.headers.get("authorization"),
      legacyKeyPresent: new URL(req.url).searchParams.has("key"),
    },
    process.env.CRON_SECRET,
  );
  if (decision === "legacy-rejected") {
    return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401 });
  }
  if (decision !== "authorized") return NextResponse.json({ ok: false }, { status: 401 });
  const result = await processBroadcastQueue();
  if (!result) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  return NextResponse.json({ ok: true, ...result });
}
