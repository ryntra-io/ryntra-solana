import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/session";
import { requireFreshMfa } from "@/lib/admin/auth";
import { metrics } from "@/lib/beta/rpc";
import { sendPlainMessage } from "@/lib/telegram/api";
import { mutationOriginAllowed } from "@/lib/security";
import { adminAuditAction, runAuditedAdminAction, type AdminAuditTerminalOutcome } from "@/lib/admin-audit";

import { toDescriptiveMetrics } from "@/lib/metrics-response.mjs";
import { projectAdminUser, type RawAdminUser } from "@/lib/admin/users";
import { appendAdminAudit } from "@/lib/admin/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const BETA_APP_SECRET = process.env.BETA_APP_SECRET;

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !BETA_APP_SECRET) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_secret: BETA_APP_SECRET, ...args }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export async function GET(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q");
  const [m, users, extra] = await Promise.all([
    metrics(),
    rpc<unknown[]>("admin_users_list", { p_query: q, p_limit: 200 }),
    rpc<Record<string, unknown>>("admin_extra", {}),
  ]);
  const descriptiveMetrics = toDescriptiveMetrics(m);
  if (!descriptiveMetrics || !users || !extra) {
    return NextResponse.json({ error: "admin data unavailable" }, { status: 503 });
  }
  return NextResponse.json({
    metrics: descriptiveMetrics,
    users: (users as RawAdminUser[]).map((row) => projectAdminUser(row)),
    extra,
  });
}

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const gate = await requireFreshMfa();
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.reason === "reverify" ? 403 : 401 });
  const admin = gate.admin.telegramId;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const action = adminAuditAction(body.action);
  if (!action) return NextResponse.json({ error: "unknown action" }, { status: 400 });
  const result = await runAuditedAdminAction(admin, action, async () => {

    if (action === "message_user") {
      const tgId = typeof body.telegram_id === "number" ? body.telegram_id : null;
      const text = typeof body.text === "string" ? body.text.trim().slice(0, 3500) : "";
      if (!tgId || text.length < 2) return { outcome: "rejected", payload: { error: "bad params" }, status: 400 };
      const r = await sendPlainMessage(tgId, text);
      return { outcome: r !== null ? "ok" : "failed", payload: { ok: r !== null } };
    }

    if (action === "broadcast") {
      const text = typeof body.text === "string" ? body.text.trim().slice(0, 3500) : "";
      const status = typeof body.status === "string" ? body.status : null;
      if (text.length < 2) return { outcome: "rejected", payload: { error: "bad params" }, status: 400 };
      const targets = await rpc<{ telegram_id: number }[]>("admin_broadcast_targets", { p_status: status });
      if (!targets) return { outcome: "failed", payload: { error: "targets unavailable" }, status: 500 };
      /* Defence in depth on a path that sends real messages to real people.
         The schema already makes a duplicate impossible — `beta_users.telegram_id`
         is UNIQUE, `beta_access.user_id` is the primary key, and
         `beta_tasks (user_id, task_type)` is UNIQUE — so the target query cannot
         fan out. This keeps that true if a future join or filter is added:
         nobody receives the same broadcast twice because of a query change. */
      const unique = [...new Map(targets.map((t) => [t.telegram_id, t])).values()];
      let sent = 0, failed = 0;
      for (const t of unique.slice(0, 500)) {
        const r = await sendPlainMessage(t.telegram_id, text);
        if (r !== null) sent++; else failed++;
        if ((sent + failed) % 25 === 0) await new Promise((res) => setTimeout(res, 1100)); // Telegram ~30 msg/s
      }
      const outcome: AdminAuditTerminalOutcome = failed === 0 ? "ok" : sent > 0 ? "partial" : "failed";
      // `targets` reports what was actually considered after deduplication, not
      // the raw row count — otherwise the audit record would overstate reach.
      return { outcome, payload: { ok: failed === 0, targets: unique.length, sent, failed } };
    }

    if (action === "run_fill_check") {
      const secret = process.env.CRON_SECRET;
      if (!secret) return { outcome: "failed", payload: { error: "CRON_SECRET not set" }, status: 500 };
      const base = new URL(req.url).origin;
      // Secret travels in the header, never the URL — URLs land in logs and traces.
      const r = await fetch(`${base}/api/cron/fills`, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(55000),
      });
      return { outcome: r.ok ? "ok" : "failed", payload: await r.json(), status: r.status };
    }
    return { outcome: "rejected", payload: { error: "unknown action" }, status: 400 };
  });
  if (!result) return NextResponse.json({ error: "audit unavailable" }, { status: 503 });
  void appendAdminAudit({
    actorTelegramId: admin,
    action,
    outcome: result.outcome,
  });
  return NextResponse.json(result.payload, { status: result.status ?? 200 });
}
