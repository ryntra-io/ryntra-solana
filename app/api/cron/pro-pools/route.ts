import { NextRequest, NextResponse } from "next/server";

import { earnProGate } from "@/lib/earn-pro/gate";
import { decideBearerAuth, LEGACY_KEY_ERROR } from "@/lib/security";
import { runProPoolsStep } from "@/lib/pro-pools/store.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The indexer of the Meteora DLMM Pro pools' tape, every minute (`lib/pro-pools/indexer.server.ts`): what landed in
 * the listed pools since the last step is read from the node, kept in the database, and each pool's day counted again
 * from it — the rows `/api/pro/pools/days` and a pool's own page answer from. One step at a time for the whole
 * deployment (a lease in the database): a pass that finds another running, or the database away, does nothing.
 * Internal — the cron's bearer only. Shut wherever DLMM Pro is. Reads only: signs, sends and trades nothing.
 */
export async function GET(req: NextRequest) {
  const decision = decideBearerAuth(
    { authorization: req.headers.get("authorization"), legacyKeyPresent: new URL(req.url).searchParams.has("key") },
    process.env.CRON_SECRET,
  );
  if (decision === "legacy-rejected") return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401 });
  if (decision !== "authorized") return NextResponse.json({ ok: false }, { status: 401 });
  const gate = earnProGate(process.env);
  if (!gate.open) return NextResponse.json({ ok: true, skipped: "closed" });
  /* The step never throws: what went wrong is in its report, and the next pass goes on from what was written. */
  const report = await runProPoolsStep(gate.network);
  return NextResponse.json({ ok: true, ...report });
}
