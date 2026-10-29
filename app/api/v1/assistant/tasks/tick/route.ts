import { NextRequest, NextResponse } from "next/server";

import { runTasks } from "@/lib/assistant/tasks/runtime.server";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { reportError } from "@/lib/monitor";
import { decideBearerAuth, LEGACY_KEY_ERROR } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * «Доручення»'s cron (AI-19), every minute: each task whose slot has come
 * asks its question through the assistant's own path, leaves its note in the
 * inbox and queues Telegram and push for the monitoring cron — while the
 * person's computer is off. Internal — the cron's bearer only, not part of the
 * public contract. Signs, sends money and trades nothing.
 */
export async function GET(req: NextRequest) {
  const decision = decideBearerAuth(
    { authorization: req.headers.get("authorization"), legacyKeyPresent: new URL(req.url).searchParams.has("key") },
    process.env.CRON_SECRET,
  );
  if (decision === "legacy-rejected") return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401 });
  if (decision !== "authorized") return NextResponse.json({ ok: false }, { status: 401 });
  const guard = getGuardRuntime();
  if (!guard.writes.allowed) return NextResponse.json({ ok: true, skipped: "read-only" });
  try {
    const run = await runTasks(guard.store, req);
    return NextResponse.json({ ok: true, ...run });
  } catch (error) {
    /* A pass that failed whole is taken again a minute on; a leased task waits out its lease, never runs twice. */
    void reportError("cron:assistant-tasks", error, {});
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
