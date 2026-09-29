import { createHash } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordProductEvent } from "@/lib/admin/activity";
import { FixedWindowLimiter, privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { canKeepPersonalData, getSession, subjectOf } from "@/lib/session";
import { subjectKey } from "@/lib/account/subject";
import {
  canonicalJson,
  issueStrategyApproval,
  parseStrategyApprovalArtifact,
  verifyStrategyApproval,
} from "@/lib/strategy-lab/approval";
import { strategyLabPersistenceState, strategyLabPreviewEnabled } from "@/lib/strategy-lab/config";
import { STRATEGY_COMPILE_MAX_BODY_BYTES, consumeStrategyLabPreSession, readBoundedJson } from "@/lib/strategy-lab/http";
import { isStrategyLabIdempotencyConflict, strategyLabAppendVersion } from "@/lib/strategy-lab/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = new FixedWindowLimiter({ limit: 20, windowMs: 10 * 60_000, maxKeys: 5_000 });
const CanonicalUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const AppendVersionResultSchema = z.object({
  strategyId: CanonicalUuidSchema,
  versionId: CanonicalUuidSchema,
  versionNumber: z.number().int().min(1).refine(Number.isSafeInteger),
  approval: z.unknown(),
  replay: z.boolean(),
}).strict();
const BodySchema = z.object({
  requestId: CanonicalUuidSchema,
  strategy: z.unknown(),
  parentApproval: z.unknown().optional(),
  confirmImmutableVersion: z.literal(true),
  acknowledgeProposalWarnings: z.literal(true),
}).strict();

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...privateNoStoreHeaders(), ...extra } });
}

export async function POST(req: NextRequest) {
  if (!strategyLabPreviewEnabled()) return json({ error: "not found" }, 404);
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

  const body = await readBoundedJson(req, STRATEGY_COMPILE_MAX_BODY_BYTES);
  if (!body.ok) return json({ error: body.status === 413 ? "request too large" : "invalid request" }, body.status);
  const parsed = BodySchema.safeParse(body.value);
  if (!parsed.success) return json({ error: "invalid request" }, 400);
  const persistenceState = strategyLabPersistenceState();
  if (persistenceState === "misconfigured") {
    return json({ error: "persistence unavailable" }, 503, rateLimitHeaders(decision));
  }

  let parentVersionId: string | null = null;
  if (parsed.data.parentApproval !== undefined) {
    const parentApproval = parseStrategyApprovalArtifact(parsed.data.parentApproval);
    if (!parentApproval.success) return json({ error: "invalid parent approval" }, 422);
    const parentDecision = verifyStrategyApproval({
      ...subjectOf(session),
      spec: parentApproval.data.spec,
      approval: parentApproval.data,
    });
    if (parentDecision === "unconfigured") return json({ error: "approval unavailable" }, 503);
    if (parentDecision !== "valid") return json({ error: "invalid parent approval" }, 422);
    parentVersionId = parentApproval.data.versionId;
  }

  const issued = issueStrategyApproval({
    ...subjectOf(session),
    spec: parsed.data.strategy,
    parentVersionId,
  });
  if (!issued.ok) {
    return issued.error === "unconfigured"
      ? json({ error: "approval unavailable" }, 503)
      : json({ error: "invalid strategy" }, 422);
  }

  if (persistenceState === "source-disabled") {
    after(() => recordProductEvent({ actor: { kind: "account", accountId: session.accountId, telegramId: session.telegramId }, name: "strategy_approved", outcome: "ok", surface: "app", props: { persisted: false } }));
    return json({
      approval: issued.approval,
      persistence: "disabled",
      persistedVersion: null,
      replay: false,
    }, 201, rateLimitHeaders(decision));
  }

  const payloadHash = createHash("sha256").update(canonicalJson({
    operation: "append-version",
    strategy: issued.approval.spec,
    parentVersionId,
    confirmImmutableVersion: true,
    acknowledgeProposalWarnings: true,
  }), "utf8").digest("hex");
  const stored = await strategyLabAppendVersion({
    subject: subjectOf(session),
    requestId: parsed.data.requestId,
    payloadHash,
    approval: issued.approval,
  });
  if (!stored.ok) {
    if (!isStrategyLabIdempotencyConflict(stored.error)) {
      after(() => recordProductEvent({ actor: { kind: "account", accountId: session.accountId, telegramId: session.telegramId }, name: "strategy_approved", outcome: "error", errorClass: "store_unavailable", surface: "app" }));
    }
    return isStrategyLabIdempotencyConflict(stored.error)
      ? json({ error: "idempotency conflict" }, 409, rateLimitHeaders(decision))
      : json({ error: "persistence unavailable" }, 503, rateLimitHeaders(decision));
  }

  const checked = AppendVersionResultSchema.safeParse(stored.data);
  if (!checked.success) {
    return json({ error: "persistence integrity failure" }, 503, rateLimitHeaders(decision));
  }
  const storedApproval = parseStrategyApprovalArtifact(checked.data.approval);
  if (!storedApproval.success
    || checked.data.versionId !== storedApproval.data.versionId
    || canonicalJson(storedApproval.data.spec) !== canonicalJson(issued.approval.spec)
    || storedApproval.data.parentVersionId !== parentVersionId
    || (!checked.data.replay && canonicalJson(storedApproval.data) !== canonicalJson(issued.approval))
    || verifyStrategyApproval({
      ...subjectOf(session),
      spec: storedApproval.data.spec,
      approval: storedApproval.data,
    }) !== "valid") {
    return json({ error: "persistence integrity failure" }, 503, rateLimitHeaders(decision));
  }

  if (!checked.data.replay) {
    after(() => recordProductEvent({ actor: { kind: "account", accountId: session.accountId, telegramId: session.telegramId }, name: "strategy_approved", outcome: "ok", surface: "app", props: { persisted: true } }));
  }
  return json({
    approval: storedApproval.data,
    persistence: "stored",
    persistedVersion: {
      strategyId: checked.data.strategyId,
      versionId: checked.data.versionId,
      versionNumber: checked.data.versionNumber,
    },
    replay: checked.data.replay,
  }, checked.data.replay ? 200 : 201, rateLimitHeaders(decision));
}
