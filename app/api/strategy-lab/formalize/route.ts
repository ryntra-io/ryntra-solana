import { createHash } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordProductEvent } from "@/lib/admin/activity";
import { normalizeLocale } from "@/app/i18n/locales";
import { FixedWindowLimiter, privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { canKeepPersonalData, getSession, subjectOf } from "@/lib/session";
import { subjectKey } from "@/lib/account/subject";
import { canonicalJson } from "@/lib/strategy-lab/approval";
import { StrategyBriefSchema } from "@/lib/strategy-lab/ai-schemas";
import { StrategyAiBudgetController } from "@/lib/strategy-lab/ai-budget";
import { STRATEGY_FORMALIZE_MAX_BODY_BYTES, consumeStrategyLabPreSession, readBoundedJson } from "@/lib/strategy-lab/http";
import { strategyLabPaidAiEnabled, strategyLabPersistenceState, strategyLabPreviewEnabled } from "@/lib/strategy-lab/config";
import { formalizeStrategy } from "@/lib/strategy-lab/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = new FixedWindowLimiter({ limit: 6, windowMs: 10 * 60_000, maxKeys: 5_000 });
const aiBudget = new StrategyAiBudgetController({
  perUserLimit: 6,
  perUserWindowMs: 10 * 60_000,
  globalLimit: 120,
  globalWindowMs: 10 * 60_000,
  completedTtlMs: 60_000,
  maxCompletedEntries: 5_000,
  maxUserBuckets: 5_000,
  maxGlobalInFlight: 4,
  inFlightRetryAfterSeconds: 2,
});
const CanonicalUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const BodySchema = z.object({
  locale: z.string().max(16).optional(),
  brief: StrategyBriefSchema,
  requestId: CanonicalUuidSchema,
  confirmPaidAi: z.literal(true),
}).strict();

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...privateNoStoreHeaders(), ...extra } });
}

function aiFailureStatus(error: string): number {
  if (error === "ai-rate-limited") return 429;
  if (error === "ai-refused") return 422;
  if (error === "invalid-ai-output") return 502;
  if (error === "ai-timeout" || error === "ai-quota" || error === "ai-unavailable") return 503;
  return 400;
}

function localAiError(decision: "in-flight" | "global-in-flight" | "user-budget" | "global-budget"): string {
  if (decision === "in-flight") return "ai-in-flight";
  if (decision === "global-in-flight") return "ai-global-in-flight";
  if (decision === "user-budget") return "ai-local-user-budget";
  return "ai-local-global-budget";
}

export async function POST(req: NextRequest) {
  if (!strategyLabPreviewEnabled()) return json({ error: "not found" }, 404);
  if (!strategyLabPaidAiEnabled()) return json({ error: "not found" }, 404);
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return json({ error: "cross-site request blocked" }, 403);
  }
  const preSessionDecision = consumeStrategyLabPreSession(req.headers);
  if (!preSessionDecision.allowed) return json({ error: "rate limited" }, 429, rateLimitHeaders(preSessionDecision));
  const session = await getSession();
  if (!session) return json({ error: "unauthorized" }, 401);
  if (!canKeepPersonalData(session)) return json({ error: "not verified" }, 403);

  const decision = limiter.consume(subjectKey(subjectOf(session)));
  if (!decision.allowed) return json({ error: "rate limited" }, 429, rateLimitHeaders(decision));

  const body = await readBoundedJson(req, STRATEGY_FORMALIZE_MAX_BODY_BYTES);
  if (!body.ok) return json({ error: body.status === 413 ? "request too large" : "invalid request" }, body.status);
  const parsed = BodySchema.safeParse(body.value);
  if (!parsed.success) return json({ error: "invalid request" }, 400);
  const persistenceState = strategyLabPersistenceState();
  if (persistenceState !== "source-disabled") {
    const error = persistenceState === "misconfigured" ? "persistence unavailable" : "ai persistence deferred";
    return json({ error }, 503, rateLimitHeaders(decision));
  }

  const locale = normalizeLocale(parsed.data.locale ?? session.state.user.language);
  const payloadHash = createHash("sha256").update(canonicalJson({
    operation: "formalize",
    locale,
    brief: parsed.data.brief,
    confirmPaidAi: true,
  }), "utf8").digest("hex");

  const userKey = subjectKey(subjectOf(session));
  const controlled = await aiBudget.execute({
    userKey,
    operation: "formalize",
    requestId: parsed.data.requestId,
    payloadHash,
  }, () => formalizeStrategy({ userKey, locale, brief: parsed.data.brief }));

  if (controlled.decision === "idempotency-conflict") {
    return json({ error: "ai-idempotency-conflict" }, 409, rateLimitHeaders(decision));
  }
  if (controlled.decision !== "allowed" && controlled.decision !== "idempotent") {
    return json(
      { error: localAiError(controlled.decision) },
      429,
      { ...rateLimitHeaders(decision), "Retry-After": String(controlled.retryAfterSeconds) },
    );
  }
  if (!controlled.completion.ok) {
    after(() => recordProductEvent({ actor: { kind: "account", accountId: session.accountId, telegramId: session.telegramId }, name: "strategy_formalized", outcome: "error", errorClass: "provider_unavailable", surface: "app" }));
    return json({ error: "ai-unavailable" }, 503);
  }
  const result = controlled.completion.value;
  if (!result.ok) return json({ error: result.error }, aiFailureStatus(result.error));

  /* The brief and the strategy text never leave the Strategy Lab; the activity row is the fact alone. */
  if (controlled.decision === "allowed") {
    after(() => recordProductEvent({ actor: { kind: "account", accountId: session.accountId, telegramId: session.telegramId }, name: "strategy_formalized", outcome: "ok", surface: "app" }));
  }
  return json({
    strategy: result.strategy,
    proposal: {
      assumptionsAdded: result.envelope.assumptionsAdded,
      unsupported: result.envelope.unsupported,
      clarificationQuestions: result.envelope.clarificationQuestions,
    },
    audit: result.audit,
    aiControl: controlled.decision,
    persistence: "disabled",
    persistedAi: null,
  }, 200, rateLimitHeaders(decision));
}
