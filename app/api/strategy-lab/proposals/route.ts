import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FixedWindowLimiter, privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { canKeepPersonalData, getSession, subjectOf } from "@/lib/session";
import { subjectKey } from "@/lib/account/subject";
import { canonicalJson, parseStrategyApprovalArtifact, verifyStrategyApproval } from "@/lib/strategy-lab/approval";
import {
  EvidenceBundleSchema,
  StrategyChangeProposalSchema,
  applyReviewChanges,
} from "@/lib/strategy-lab/ai-schemas";
import { createEvidenceProofIdentity } from "@/lib/strategy-lab/evidence-proof";
import { strategyLabPersistenceState, strategyLabPreviewEnabled } from "@/lib/strategy-lab/config";
import { STRATEGY_REVIEW_MAX_BODY_BYTES, consumeStrategyLabPreSession, readBoundedJson } from "@/lib/strategy-lab/http";
import { isStrategyLabIdempotencyConflict, strategyLabAppendProposal } from "@/lib/strategy-lab/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = new FixedWindowLimiter({ limit: 20, windowMs: 10 * 60_000, maxKeys: 5_000 });
const CanonicalUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const EvidenceIdentitySchema = z.object({
  experimentId: CanonicalUuidSchema,
  evidenceReportId: CanonicalUuidSchema,
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const PersistedProposalSchema = z.object({
  proposalId: CanonicalUuidSchema,
  replay: z.boolean(),
}).strict();
const BodySchema = z.object({
  requestId: CanonicalUuidSchema,
  approval: z.unknown(),
  evidence: EvidenceBundleSchema,
  evidenceIdentity: EvidenceIdentitySchema,
  proposal: StrategyChangeProposalSchema,
  confirmHumanProposal: z.literal(true),
}).strict();

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...privateNoStoreHeaders(), ...extra } });
}

export async function POST(req: NextRequest) {
  if (!strategyLabPreviewEnabled()) return json({ error: "not found" }, 404);
  const persistenceState = strategyLabPersistenceState();
  if (persistenceState !== "enabled") {
    return json({ error: persistenceState === "misconfigured" ? "persistence unavailable" : "persistence disabled" }, 503);
  }
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

  const approval = parseStrategyApprovalArtifact(parsed.data.approval);
  if (!approval.success) return json({ error: "invalid approval" }, 422);
  const approvalDecision = verifyStrategyApproval({
    ...subjectOf(session),
    spec: approval.data.spec,
    approval: approval.data,
  });
  if (approvalDecision === "unconfigured") return json({ error: "approval unavailable" }, 503);
  if (approvalDecision !== "valid") return json({ error: "invalid approval" }, 422);

  const evidenceIdentity = createEvidenceProofIdentity(parsed.data.evidence, {
    experimentId: parsed.data.evidenceIdentity.experimentId,
    evidenceReportId: parsed.data.evidenceIdentity.evidenceReportId,
  });
  if (evidenceIdentity.evidenceHash !== parsed.data.evidenceIdentity.evidenceHash) {
    return json({ error: "invalid evidence identity" }, 422);
  }
  const applied = applyReviewChanges(approval.data.spec, parsed.data.proposal);
  if (!applied.ok) return json({ error: applied.error }, 422);

  const payloadHash = createHash("sha256").update(canonicalJson({
    operation: "append-proposal",
    versionId: approval.data.versionId,
    evidenceIdentity,
    source: "manual",
    proposal: parsed.data.proposal,
    confirmHumanProposal: true,
  }), "utf8").digest("hex");
  const stored = await strategyLabAppendProposal({
    subject: subjectOf(session),
    requestId: parsed.data.requestId,
    payloadHash,
    versionId: approval.data.versionId,
    experimentId: evidenceIdentity.experimentId!,
    evidenceReportId: evidenceIdentity.evidenceReportId!,
    evidenceHash: evidenceIdentity.evidenceHash,
    source: "manual",
    proposal: { ...parsed.data.proposal },
    audit: null,
  });
  if (!stored.ok) {
    return isStrategyLabIdempotencyConflict(stored.error)
      ? json({ error: "idempotency conflict" }, 409, rateLimitHeaders(decision))
      : json({ error: "persistence unavailable" }, 503, rateLimitHeaders(decision));
  }
  const checked = PersistedProposalSchema.safeParse(stored.data);
  if (!checked.success) return json({ error: "persistence integrity failure" }, 503, rateLimitHeaders(decision));

  return json({
    proposal: parsed.data.proposal,
    proposedStrategy: applied.strategy,
    changedFields: applied.changedFields,
    persistence: "stored",
    persistedProposal: { proposalId: checked.data.proposalId },
    replay: checked.data.replay,
  }, checked.data.replay ? 200 : 201, rateLimitHeaders(decision));
}
