import { NextRequest, NextResponse } from "next/server";

import { runMorningBriefs } from "@/lib/assistant/brief/runtime.server";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { reportError } from "@/lib/monitor";
import { decideBearerAuth, LEGACY_KEY_ERROR } from "@/lib/security";

import { briefDepsFor } from "../../../agent/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * «Ранковий огляд»'s cron (AI-10), every five minutes: every wallet whose
 * brief is due gets its note — «Сьогодні на ринку», built once for everyone
 * in the hour, and its own changes — and the deliveries queued for the
 * monitoring cron to send. Internal — the cron's bearer only, not part of the
 * public contract. Signs, sends money and trades nothing.
 */
export async function GET(req: NextRequest) {
  const decision = decideBearerAuth(
    { authorization: req.headers.get("authorization"), legacyKeyPresent: new URL(req.url).searchParams.has("key") },
    process.env.CRON_SECRET,
  );
  if (decision === "legacy-rejected") return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401 });
  if (decision !== "authorized") return NextResponse.json({ ok: false }, { status: 401 });
  let run;
  try {
    const deps = await briefDepsFor(req);
    run = await runMorningBriefs({ store: getGuardRuntime().store, readers: deps.readers, model: deps.model, budget: deps.budget, concurrency: deps.concurrency });
  } catch (error) {
    /* A pass that failed whole leaves every brief undone; the next pass, five minutes on, takes them again. */
    void reportError("cron:assistant-brief", error, {});
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true, subscribers: run.subscribers, due: run.due, delivered: run.delivered, waiting: run.waiting, deferred: run.deferred, personalCalls: run.personalCalls, marketCall: run.marketCall, costUsd: run.costMicroUsd / 1_000_000 });
}
