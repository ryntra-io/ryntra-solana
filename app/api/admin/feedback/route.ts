import { NextRequest, NextResponse } from "next/server";

import { isFeedbackStatus, sanitizeAdminReply } from "@/lib/admin/feedback";
import { feedbackContextView, listFeedbackContexts, readFeedbackContext } from "@/lib/admin/feedback-context";
import { getGuardRuntime } from "@/lib/guard/runtime";
import {
  appendAdminAudit,
  getFeedbackThread,
  listFeedback,
  replyFeedback,
  setFeedbackDelivery,
  setFeedbackState,
} from "@/lib/admin/store";
import { mutationOriginAllowed } from "@/lib/security";
import { getAdminSession } from "@/lib/session";
import { sendPlainMessage } from "@/lib/telegram/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  /* Who wrote — topic, wallet, contact, page — joins from the Guard store by
     thread id; a thread without a context reads as it did before. */
  const store = getGuardRuntime().store;
  if (id) {
    const row = await getFeedbackThread(id);
    if (!row?.ok) return NextResponse.json({ error: "unavailable" }, { status: 503 });
    const context = feedbackContextView(await readFeedbackContext(store, id));
    return NextResponse.json({ ...row, context });
  }
  const rows = await listFeedback();
  if (!rows) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const contexts = await listFeedbackContexts(store);
  return NextResponse.json({ threads: rows.map((row) => ({ ...row, context: feedbackContextView(contexts.get(row.id)) })) });
}

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "bad params" }, { status: 400 });

  if (body.action === "state") {
    if (!isFeedbackStatus(body.status) || typeof body.reason !== "string") {
      return NextResponse.json({ error: "bad params" }, { status: 400 });
    }
    await appendAdminAudit({
      actorTelegramId: admin,
      action: "feedback_state",
      outcome: "attempt",
      reason: body.reason,
      payload: { id, status: body.status },
    });
    const row = await setFeedbackState({
      id,
      status: body.status,
      reason: body.reason,
      actorTelegramId: admin,
    });
    if (!row?.ok) {
      await appendAdminAudit({
        actorTelegramId: admin,
        action: "feedback_state",
        outcome: "failed",
        reason: body.reason,
        payload: { id },
      });
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    await appendAdminAudit({
      actorTelegramId: admin,
      action: "feedback_state",
      outcome: "ok",
      reason: body.reason,
      payload: { id, status: body.status },
    });
    return NextResponse.json({ ok: true, status: row.status });
  }

  const text = sanitizeAdminReply(body.body);
  if (!text) return NextResponse.json({ error: "bad body" }, { status: 400 });
  await appendAdminAudit({
    actorTelegramId: admin,
    action: "feedback_reply",
    outcome: "attempt",
    payload: { id },
  });
  const row = await replyFeedback({ id, body: text, actorTelegramId: admin });
  if (!row?.ok || !row.message_id) {
    await appendAdminAudit({
      actorTelegramId: admin,
      action: "feedback_reply",
      outcome: "failed",
      payload: { id },
    });
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  let delivery: "sent" | "failed" | "blocked" | "not_applicable" = "not_applicable";
  if (row.needs_bot && typeof row.telegram_id === "number") {
    const sent = await sendPlainMessage(row.telegram_id, text);
    delivery = sent ? "sent" : "failed";
    await setFeedbackDelivery(row.message_id, delivery);
  } else {
    await setFeedbackDelivery(row.message_id, "not_applicable");
  }
  await appendAdminAudit({
    actorTelegramId: admin,
    action: "feedback_reply",
    outcome: delivery === "sent" || delivery === "not_applicable" ? "ok" : "failed",
    targetTelegramId: typeof row.telegram_id === "number" ? row.telegram_id : null,
    payload: { id, delivery },
  });
  return NextResponse.json({ ok: true, delivery });
}
