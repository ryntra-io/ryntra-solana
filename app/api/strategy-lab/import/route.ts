import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FixedWindowLimiter, privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { canKeepPersonalData, getSession, subjectOf } from "@/lib/session";
import { subjectKey } from "@/lib/account/subject";
import { canonicalJson, parseStrategyApprovalArtifact, verifyStrategyApproval } from "@/lib/strategy-lab/approval";
import { applyCostModel, evaluateEvidence } from "@/lib/strategy-lab/evidence";
import {
  createEvidenceProofIdentity,
  evidenceProofSigningAvailable,
  evidenceReportHash,
  issueEvidenceProof,
} from "@/lib/strategy-lab/evidence-proof";
import { ExperimentLineageSchema } from "@/lib/strategy-lab/lineage";
import {
  STRATEGY_LAB_EVIDENCE_ENGINE_VERSION,
  strategyLabPersistenceState,
  strategyLabPreviewEnabled,
} from "@/lib/strategy-lab/config";
import { STRATEGY_IMPORT_MAX_BODY_BYTES, consumeStrategyLabPreSession, readBoundedJson } from "@/lib/strategy-lab/http";
import { compilePineV6 } from "@/lib/strategy-lab/pine";
import { isStrategyLabIdempotencyConflict, strategyLabAppendRun } from "@/lib/strategy-lab/rpc";
import {
  TRADINGVIEW_FILE_MAX_BYTES,
  deriveBenchmarkReturnPercent,
  parseTradingViewImport,
} from "@/lib/strategy-lab/tradingview-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = new FixedWindowLimiter({ limit: 10, windowMs: 10 * 60_000, maxKeys: 5_000 });
const CanonicalUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const PersistedRunSchema = z.object({
  experimentId: CanonicalUuidSchema,
  importId: CanonicalUuidSchema,
  evidenceReportId: CanonicalUuidSchema,
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  iterationNumber: z.number().int().min(1).refine(Number.isSafeInteger),
  replay: z.boolean(),
}).strict();
const BodySchema = z.object({
  approval: z.unknown(),
  manifest: z.unknown(),
  tradesCsv: z.string().min(1).max(TRADINGVIEW_FILE_MAX_BYTES),
  performanceCsv: z.string().min(1).max(TRADINGVIEW_FILE_MAX_BYTES),
  oos: z.enum(["none", "self-attested"]),
  usesSyntheticPrices: z.boolean(),
  persistence: z.object({
    requestId: CanonicalUuidSchema,
    lineage: ExperimentLineageSchema,
  }).strict().optional(),
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

  const body = await readBoundedJson(req, STRATEGY_IMPORT_MAX_BODY_BYTES);
  if (!body.ok) return json({ error: body.status === 413 ? "request too large" : "invalid request" }, body.status);
  const parsed = BodySchema.safeParse(body.value);
  if (!parsed.success) return json({ error: "invalid request" }, 400);

  const persistenceState = strategyLabPersistenceState();
  if (persistenceState === "misconfigured") {
    return json({ error: "persistence unavailable" }, 503, rateLimitHeaders(decision));
  }
  const persistenceEnabled = persistenceState === "enabled";
  if (persistenceEnabled && !parsed.data.persistence) {
    return json({ error: "persistence request required" }, 400, rateLimitHeaders(decision));
  }
  if (persistenceState === "source-disabled" && parsed.data.persistence) {
    return json({ error: "persistence disabled" }, 503, rateLimitHeaders(decision));
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

  const imported = await parseTradingViewImport({
    manifest: parsed.data.manifest,
    tradesCsv: parsed.data.tradesCsv,
    performanceCsv: parsed.data.performanceCsv,
  });
  if (!imported.ok) return json({ error: imported.error }, 422);

  const manifest = imported.run.manifest;
  const compiled = compilePineV6(approval.data.spec, manifest.compileWindow, {
    initialCapital: manifest.initialCapital,
  });
  if (!compiled.ok) return json({ error: "manifest-strategy-mismatch" }, 422);
  const serverPineHash = createHash("sha256").update(compiled.code, "utf8").digest("hex");
  if (manifest.compilerVersion !== compiled.compilerVersion
    || manifest.pineHash !== serverPineHash
    || manifest.symbol !== approval.data.spec.universe.symbol
    || manifest.timeframe !== approval.data.spec.timeframe
    || manifest.strategyVersionId !== approval.data.versionId) {
    return json({ error: "manifest-strategy-mismatch" }, 422);
  }

  let adjusted;
  try {
    adjusted = applyCostModel(imported.run.trades, approval.data.spec.costModel);
  } catch {
    return json({ error: "invalid trade data" }, 422);
  }

  const protocol = {
    oos: parsed.data.oos,
    costsIncluded: true as const,
    regimesCovered: 0,
    parameterSensitivity: "not-tested" as const,
    forwardEvidence: false,
  };
  const benchmarkReturnPercent = deriveBenchmarkReturnPercent(imported.run.metrics, manifest.initialCapital);
  let evidence;
  try {
    evidence = evaluateEvidence({
      trades: adjusted,
      initialCapital: manifest.initialCapital,
      maxAllowedClosedTradeDrawdownPercent: approval.data.spec.riskPolicy.maxDrawdownPercent,
      benchmarkReturnPercent,
      protocol,
      leakage: {
        repaintRisk: "low",
        usesSyntheticPrices: parsed.data.usesSyntheticPrices,
        usesLookahead: false,
        usesIntrabarAssumptions: true,
      },
      reproducible: true,
      executionRealism: "low",
    });
  } catch {
    return json({ error: "invalid trade data" }, 422);
  }

  if (persistenceEnabled && !evidenceProofSigningAvailable()) {
    return json({ error: "evidence proof unavailable" }, 503, rateLimitHeaders(decision));
  }
  const localEvidenceHash = evidenceReportHash(evidence);
  const proofStrategy = { spec: approval.data.spec, versionId: approval.data.versionId };

  let persistence: "disabled" | "stored" = "disabled";
  let persistedRun: z.infer<typeof PersistedRunSchema> | null = null;
  if (persistenceEnabled && parsed.data.persistence) {
    const payloadHash = createHash("sha256").update(canonicalJson({
      operation: "append-run",
      versionId: approval.data.versionId,
      protocol,
      lineage: parsed.data.persistence.lineage,
      manifest,
      providerMetrics: imported.run.metrics,
      trades: adjusted,
      evidence,
      evidenceHash: localEvidenceHash,
      engineVersion: STRATEGY_LAB_EVIDENCE_ENGINE_VERSION,
    }), "utf8").digest("hex");
    const stored = await strategyLabAppendRun({
      subject: subjectOf(session),
      requestId: parsed.data.persistence.requestId,
      payloadHash,
      versionId: approval.data.versionId,
      protocol,
      lineage: parsed.data.persistence.lineage,
      manifest: { ...manifest },
      providerMetrics: imported.run.metrics,
      trades: adjusted,
      evidence,
      evidenceHash: localEvidenceHash,
      engineVersion: STRATEGY_LAB_EVIDENCE_ENGINE_VERSION,
    });
    if (!stored.ok) {
      return isStrategyLabIdempotencyConflict(stored.error)
        ? json({ error: "idempotency conflict" }, 409, rateLimitHeaders(decision))
        : json({ error: "persistence unavailable" }, 503, rateLimitHeaders(decision));
    }
    const checked = PersistedRunSchema.safeParse(stored.data);
    if (!checked.success
      || checked.data.evidenceHash !== localEvidenceHash
      || checked.data.iterationNumber !== parsed.data.persistence.lineage.iterationNumber) {
      return json({ error: "persistence integrity failure" }, 503, rateLimitHeaders(decision));
    }
    persistence = "stored";
    persistedRun = checked.data;
  }

  const evidenceIdentity = createEvidenceProofIdentity(
    evidence,
    persistedRun
      ? { experimentId: persistedRun.experimentId, evidenceReportId: persistedRun.evidenceReportId }
      : null,
  );
  const evidenceProof = issueEvidenceProof({
    ...subjectOf(session),
    strategy: proofStrategy,
    evidence,
    evidenceIdentity,
  });
  if (persistenceEnabled && evidenceProof === null) {
    return json({ error: "evidence proof unavailable" }, 503, rateLimitHeaders(decision));
  }

  return json({
    manifest,
    providerMetrics: imported.run.metrics,
    rawFilesStored: false,
    evidence,
    evidenceIdentity,
    evidenceProof,
    tradeCount: adjusted.length,
    tradesPreview: adjusted.slice(0, 200),
    persistence,
    persistedRun,
  }, persistedRun && !persistedRun.replay ? 201 : 200, rateLimitHeaders(decision));
}
