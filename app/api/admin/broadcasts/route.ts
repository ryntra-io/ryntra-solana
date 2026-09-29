import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  campaignMayCancel,
  isBroadcastAudience,
  publicBroadcastRef,
  sanitizeCampaignBody,
  sanitizeCampaignCta,
  sanitizeCampaignName,
} from "@/lib/admin/broadcast";
import { processBroadcastQueue } from "@/lib/admin/broadcast-queue";
import {
  appendAdminAudit,
  cancelBroadcast,
  createBroadcast,
  enqueueBroadcast,
  listBroadcasts,
  markBroadcastTested,
  previewBroadcastAudience,
  updateBroadcast,
} from "@/lib/admin/store";
import { mutationOriginAllowed } from "@/lib/security";
import { getAdminSession } from "@/lib/session";
import { requireFreshMfa } from "@/lib/admin/auth";
import { sendPlainDelivery } from "@/lib/telegram/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const audience = new URL(req.url).searchParams.get("audience");
  if (audience) {
    if (!isBroadcastAudience(audience)) return NextResponse.json({ error: "bad params" }, { status: 400 });
    const n = await previewBroadcastAudience(audience);
    if (n == null) return NextResponse.json({ error: "unavailable" }, { status: 503 });
    return NextResponse.json({ n });
  }
  const rows = await listBroadcasts();
  if (!rows) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json({ campaigns: rows });
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
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "create" || action === "update") {
    const name = sanitizeCampaignName(body.name);
    const audience = isBroadcastAudience(body.audience) ? body.audience : null;
    const text = sanitizeCampaignBody(body.body);
    const cta = body.cta == null || body.cta === "" ? null : sanitizeCampaignCta(body.cta);
    if (!name || !audience || !text || (body.cta && cta == null)) {
      return NextResponse.json({ error: "bad params" }, { status: 400 });
    }
    if (action === "create") {
      const publicRef = publicBroadcastRef(randomUUID());
      await appendAdminAudit({
        actorTelegramId: admin,
        action: "campaign_create",
        outcome: "attempt",
        payload: { audience, public_ref: publicRef },
      });
      const row = await createBroadcast({
        name,
        audience,
        body: text,
        cta,
        publicRef,
        actorTelegramId: admin,
      });
      if (!row?.ok || !row.id) {
        await appendAdminAudit({
          actorTelegramId: admin,
          action: "campaign_create",
          outcome: "failed",
          payload: { public_ref: publicRef },
        });
        return NextResponse.json({ error: row?.error ?? "unavailable" }, { status: 503 });
      }
      await appendAdminAudit({
        actorTelegramId: admin,
        action: "campaign_create",
        outcome: "ok",
        payload: { id: row.id, public_ref: row.public_ref },
      });
      return NextResponse.json({ id: row.id, public_ref: row.public_ref, state: row.state });
    }
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "bad params" }, { status: 400 });
    const row = await updateBroadcast({ id, name, audience, body: text, cta });
    if (!row?.ok) return NextResponse.json({ error: row?.error ?? "unavailable" }, { status: 503 });
    return NextResponse.json({ state: row.state });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "bad params" }, { status: 400 });

  if (action === "test") {
    await appendAdminAudit({
      actorTelegramId: admin,
      action: "campaign_test",
      outcome: "attempt",
      payload: { id },
    });
    const campaigns = await listBroadcasts();
    const campaign = campaigns?.find((row) => row.id === id);
    const text = campaign?.body ? sanitizeCampaignBody(campaign.body) : sanitizeCampaignBody(body.body);
    if (!text) {
      await appendAdminAudit({
        actorTelegramId: admin,
        action: "campaign_test",
        outcome: "rejected",
        payload: { id },
      });
      return NextResponse.json({ error: "bad params" }, { status: 400 });
    }
    const sent = await sendPlainDelivery(admin, `TEST\n\n${text}`);
    if (sent.kind !== "sent") {
      await appendAdminAudit({
        actorTelegramId: admin,
        action: "campaign_test",
        outcome: "failed",
        payload: { id, kind: sent.kind },
      });
      return NextResponse.json({ error: "test_failed", kind: sent.kind }, { status: 502 });
    }
    const row = await markBroadcastTested(id, admin);
    if (!row?.ok) {
      await appendAdminAudit({
        actorTelegramId: admin,
        action: "campaign_test",
        outcome: "failed",
        payload: { id },
      });
      return NextResponse.json({ error: row?.error ?? "unavailable" }, { status: 503 });
    }
    await appendAdminAudit({
      actorTelegramId: admin,
      action: "campaign_test",
      outcome: "ok",
      payload: { id },
    });
    return NextResponse.json({ state: row.state, delivery: "sent" });
  }

  if (action === "enqueue") {
    const scheduledAt = typeof body.scheduled_at === "string" && body.scheduled_at.trim()
      ? body.scheduled_at
      : null;
    await appendAdminAudit({
      actorTelegramId: admin,
      action: "campaign_enqueue",
      outcome: "attempt",
      payload: { id },
    });
    const row = await enqueueBroadcast({ id, actorTelegramId: admin, scheduledAt });
    if (!row?.ok) {
      const status = row?.error === "test_required" ? 409 : 503;
      await appendAdminAudit({
        actorTelegramId: admin,
        action: "campaign_enqueue",
        outcome: row?.error === "test_required" ? "rejected" : "failed",
        payload: { id, error: row?.error },
      });
      return NextResponse.json({ error: row?.error ?? "unavailable" }, { status });
    }
    await appendAdminAudit({
      actorTelegramId: admin,
      action: "campaign_enqueue",
      outcome: "ok",
      payload: { id, n: row.n, state: row.state },
    });
    let queue = null;
    if (row.state === "QUEUED") queue = await processBroadcastQueue();
    return NextResponse.json({ state: row.state, n: row.n, queue });
  }

  if (action === "cancel") {
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 2) return NextResponse.json({ error: "bad params" }, { status: 400 });
    await appendAdminAudit({
      actorTelegramId: admin,
      action: "campaign_cancel",
      outcome: "attempt",
      reason,
      payload: { id },
    });
    const row = await cancelBroadcast({ id, actorTelegramId: admin, reason });
    if (!row?.ok) {
      await appendAdminAudit({
        actorTelegramId: admin,
        action: "campaign_cancel",
        outcome: "failed",
        reason,
        payload: { id },
      });
      return NextResponse.json({ error: row?.error ?? "unavailable" }, { status: 503 });
    }
    if (row.state && !campaignMayCancel(row.state) && row.state !== "CANCELLED") {
      return NextResponse.json({ error: "frozen" }, { status: 409 });
    }
    await appendAdminAudit({
      actorTelegramId: admin,
      action: "campaign_cancel",
      outcome: "ok",
      reason,
      payload: { id },
    });
    return NextResponse.json({ state: row.state });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
