import { randomUUID } from "node:crypto";

import { after, NextRequest, NextResponse } from "next/server";

import { recordProductEvent } from "@/lib/admin/activity";
import {
  isFeedbackCategory,
  isFeedbackSource,
  publicFeedbackRef,
  sanitizeFeedbackBody,
  sanitizeFeedbackRoute,
} from "@/lib/admin/feedback";
import { inboxCategoryFor, isFeedbackTopic, isSolanaWallet, recordFeedbackContext, sanitizeFeedbackContact } from "@/lib/admin/feedback-context";
import { openFeedbackThread } from "@/lib/admin/store";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { clientIp, FixedWindowLimiter } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { getSession, getWalletProof } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = new FixedWindowLimiter({ limit: 5, windowMs: 10 * 60 * 1000, maxKeys: 2000 });

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const rate = limiter.consume(`feedback:${clientIp(req.headers)}`);
  if (!rate.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  /* The cabinet sends a `topic` — question, idea, bug, security — and the
     inbox's own `category` is derived from it; the site form still sends a
     category directly. A question is `other` to the inbox and a question to
     the operator, through the context record below. */
  const topic = isFeedbackTopic(body.topic) ? body.topic : null;
  const category = topic ? inboxCategoryFor(topic) : body.category;
  if (!isFeedbackSource(body.source) || !isFeedbackCategory(category)) {
    return NextResponse.json({ error: "bad params" }, { status: 400 });
  }
  const text = sanitizeFeedbackBody(body.body);
  if (!text) return NextResponse.json({ error: "bad body" }, { status: 400 });
  const session = await getSession();
  const telegramId = session?.telegramId ?? null;
  const id = randomUUID();
  const opened = await openFeedbackThread({
    source: body.source,
    category,
    body: text,
    telegramId,
    locale: typeof body.locale === "string" ? body.locale.slice(0, 8) : null,
    route: sanitizeFeedbackRoute(body.route),
    publicRef: publicFeedbackRef(id),
  });
  /* The thread body stays in the inbox; the activity row is the fact that a
     person asked for help, on which surface, by account or anonymously. */
  const actor = telegramId ? ({ kind: "account", telegramId } as const) : ({ kind: "anonymous" } as const);
  const surface = body.source;
  if (!opened.ok) {
    after(() => recordProductEvent({ actor, name: "feedback_sent", outcome: "error", errorClass: "store_unavailable", surface }));
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  /* Who wrote, in the terms the inbox table does not hold. The wallet is
     taken as sent and marked proven only when this same session's proof
     cookie names it — a claim on the wire is not a proof. Non-fatal: the
     thread is already open. */
  const wallet = isSolanaWallet(body.wallet) ? body.wallet : null;
  const proof = wallet ? await getWalletProof() : null;
  await recordFeedbackContext(getGuardRuntime().store, {
    schema: "ryntra.feedback-context",
    schemaVersion: "1.0.0",
    id: opened.id,
    publicRef: opened.public_ref,
    topic: topic ?? (category === "other" ? "question" : category),
    wallet,
    proven: Boolean(wallet && proof && proof.chain === "solana" && proof.address === wallet),
    contact: sanitizeFeedbackContact(body.contact),
    route: sanitizeFeedbackRoute(body.route),
    locale: typeof body.locale === "string" ? body.locale.slice(0, 8) : null,
    createdAt: new Date().toISOString(),
  });
  after(() => recordProductEvent({ actor, name: "feedback_sent", outcome: "ok", surface, props: { category } }));
  return NextResponse.json({ ok: true, ref: opened.public_ref });
}
