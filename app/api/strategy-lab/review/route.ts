import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeLocale } from "@/app/i18n/locales";
import { FixedWindowLimiter, privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { canKeepPersonalData, getSession, subjectOf } from "@/lib/session";
import { subjectKey } from "@/lib/account/subject";
import { canonicalJson, parseStrategyApprovalArtifact, verifyStrategyApproval } from "@/lib/strategy-lab/approval";
import { StrategyAiBudgetController } from "@/lib/strategy-lab/ai-budget";
import { EvidenceBundleSchema } from "@/lib/strategy-lab/ai-schemas";
import { createEvidenceProofIdentity, verifyEvidenceProof } from "@/lib/strategy-lab/evidence-proof";
import { strategyLabPaidAiEnabled, strategyLabPersistenceState, strategyLabPreviewEnabled } from "@/lib/strategy-lab/config";
import { STRATEGY_REVIEW_MAX_BODY_BYTES, consumeStrategyLabPreSession, readBoundedJson } from "@/lib/strategy-lab/http";
import { reviewEvidence } from "@/lib/strategy-lab/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = new FixedWindowLimiter({ limit: 2, windowMs: 60 * 60_000, maxKeys: 5_000 });
const aiBudget = new StrategyAiBudgetController({
  perUserLimit: 2,
  perUserWindowMs: 60 * 60_000,
  globalLimit: 40,
  globalWindowMs: 60 * 60_000,
  completedTtlMs: 60_000,
  maxCompletedEntries: 5_000,
  maxUserBuckets: 5_000,
  maxGlobalInFlight: 4,
  inFlightRetryAfterSeconds: 2,
});
const CanonicalUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const BodySchema = z.object({
  locale: z.string().max(16).optional(),
  approval: z.unknown(),
  evidence: EvidenceBundleSchema,
  evidenceProof: z.string().regex(/^v2\.[a-f0-9]{64}$/),
  requestId: CanonicalUuidSchema,
  confirmAdversarialReview: z.literal(true),
  persistence: z.object({
    experimentId: CanonicalUuidSchema,
    evidenceReportId: CanonicalUuidSchema,
  }).strict().optional(),
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

  const body = await readBoundedJson(req, STRATEGY_REVIEW_MAX_BODY_BYTES);
  if (!body.ok) return json({ error: body.status === 413 ? "request too large" : "invalid request" }, body.status);
  const parsed = BodySchema.safeParse(body.value);
  if (!parsed.success) return json({ error: "invalid request" }, 400);
  const persistenceState = strategyLabPersistenceState();
  if (persistenceState !== "source-disabled" || parsed.data.persistence !== undefined) {
    const error = persistenceState === "misconfigured" ? "persistence unavailable" : "ai persistence deferred";
    return json({ error }, 503, rateLimitHeaders(decision));
  }

  const approval = parseStrategyApprovalArtifact(parsed.data.approval);
  if (!approval.success) return json({ error: "invalid approval" }, 422);
  const approvalDecision = verifyStrategyApproval({
    ...subjectOf(session),
    spec: approval.data.spec,
    approval: approval.data,
  });
  if (approvalDecision === "unconfigured") return json({ error: "approval unavailable" }, 503);
  if (approvalDecision !== "valid") return json({ error: "invalid approval" }, 422);

  const proofStrategy = { spec: approval.data.spec, versionId: approval.data.versionId };
  const evidenceIdentity = createEvidenceProofIdentity(parsed.data.evidence);
  const proofDecision = verifyEvidenceProof({
    ...subjectOf(session),
    strategy: proofStrategy,
    evidence: parsed.data.evidence,
    evidenceIdentity,
  }, parsed.data.evidenceProof);
  if (proofDecision === "unconfigured") return json({ error: "evidence proof unavailable" }, 503);
  if (proofDecision !== "valid") return json({ error: "invalid evidence proof" }, 422);

  const locale = normalizeLocale(parsed.data.locale ?? session.state.user.language);
  const payloadHash = createHash("sha256").update(canonicalJson({
    operation: "review",
    locale,
    approval: approval.data,
    evidence: parsed.data.evidence,
    evidenceIdentity,
    evidenceProof: parsed.data.evidenceProof,
    confirmAdversarialReview: true,
  }), "utf8").digest("hex");

  const userKey = subjectKey(subjectOf(session));
  const controlled = await aiBudget.execute({
    userKey,
    operation: "review",
    requestId: parsed.data.requestId,
    payloadHash,
  }, () => reviewEvidence({
    userKey,
    locale,
    strategy: proofStrategy,
    evidence: parsed.data.evidence,
  }));

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
  if (!controlled.completion.ok) return json({ error: "ai-unavailable" }, 503);
  const result = controlled.completion.value;
  if (!result.ok) return json({ error: result.error }, aiFailureStatus(result.error));

  return json({
    proposal: result.proposal,
    audit: result.audit,
    aiControl: controlled.decision,
    persistence: "disabled",
    persistedProposal: null,
  }, 200, rateLimitHeaders(decision));
}
