import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FixedWindowLimiter, privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { canKeepPersonalData, getSession, subjectOf } from "@/lib/session";
import { subjectKey } from "@/lib/account/subject";
import { strategyLabPersistenceState, strategyLabPreviewEnabled } from "@/lib/strategy-lab/config";
import { STRATEGY_COMPILE_MAX_BODY_BYTES, consumeStrategyLabPreSession, readBoundedJson } from "@/lib/strategy-lab/http";
import {
  StrategyLabCanonicalUuidSchema as CanonicalUuidSchema,
  StrategyLabCursorTimestampSchema as CursorTimestampSchema,
  StrategyLabDetailResultSchema as DetailResultSchema,
  StrategyLabListResultSchema as StrategyListResultSchema,
} from "@/lib/strategy-lab/persistence-schemas";
import { strategyLabGet, strategyLabList } from "@/lib/strategy-lab/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const readLimiter = new FixedWindowLimiter({ limit: 120, windowMs: 60_000, maxKeys: 5_000 });
const writeLimiter = new FixedWindowLimiter({ limit: 20, windowMs: 10 * 60_000, maxKeys: 5_000 });
const BoundedLimitSchema = z.coerce.number().int().min(1).max(100).default(50);
const QuerySchema = z.object({
  id: CanonicalUuidSchema.optional(),
  limit: BoundedLimitSchema,
  beforeUpdatedAt: CursorTimestampSchema.optional(),
  beforeId: CanonicalUuidSchema.optional(),
  versionLimit: BoundedLimitSchema,
  versionsBeforeRecordedAt: CursorTimestampSchema.optional(),
  versionsBeforeId: CanonicalUuidSchema.optional(),
  runLimit: BoundedLimitSchema,
  runsBeforeCreatedAt: CursorTimestampSchema.optional(),
  runsBeforeId: CanonicalUuidSchema.optional(),
  proposalLimit: BoundedLimitSchema,
  proposalsBeforeCreatedAt: CursorTimestampSchema.optional(),
  proposalsBeforeId: CanonicalUuidSchema.optional(),
}).strict().superRefine((query, context) => {
  const cursorPairs = [
    ["beforeUpdatedAt", query.beforeUpdatedAt, "beforeId", query.beforeId],
    ["versionsBeforeRecordedAt", query.versionsBeforeRecordedAt, "versionsBeforeId", query.versionsBeforeId],
    ["runsBeforeCreatedAt", query.runsBeforeCreatedAt, "runsBeforeId", query.runsBeforeId],
    ["proposalsBeforeCreatedAt", query.proposalsBeforeCreatedAt, "proposalsBeforeId", query.proposalsBeforeId],
  ] as const;
  for (const [timestampName, timestamp, idName, id] of cursorPairs) {
    if ((timestamp === undefined) !== (id === undefined)) {
      context.addIssue({
        code: "custom",
        path: [timestamp === undefined ? timestampName : idName],
        message: "Pagination cursor fields must be supplied together.",
      });
    }
  }
  const hasListCursor = query.beforeUpdatedAt !== undefined || query.beforeId !== undefined;
  const hasDetailCursor = query.versionsBeforeRecordedAt !== undefined
    || query.versionsBeforeId !== undefined
    || query.runsBeforeCreatedAt !== undefined
    || query.runsBeforeId !== undefined
    || query.proposalsBeforeCreatedAt !== undefined
    || query.proposalsBeforeId !== undefined;
  if (query.id !== undefined && hasListCursor) {
    context.addIssue({ code: "custom", message: "Detail reads do not accept a list cursor." });
  }
  if (query.id === undefined && hasDetailCursor) {
    context.addIssue({ code: "custom", message: "Collection cursors require a strategy id." });
  }
});
const DeprecatedMutationSchema = z.object({}).strict();

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...privateNoStoreHeaders(), ...extra } });
}

function parseQuery(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const allowed = new Set([
    "id",
    "limit",
    "beforeUpdatedAt",
    "beforeId",
    "versionLimit",
    "versionsBeforeRecordedAt",
    "versionsBeforeId",
    "runLimit",
    "runsBeforeCreatedAt",
    "runsBeforeId",
    "proposalLimit",
    "proposalsBeforeCreatedAt",
    "proposalsBeforeId",
  ]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) return { success: false } as const;
  }
  return QuerySchema.safeParse(Object.fromEntries(params.entries()));
}

export async function GET(req: NextRequest) {
  if (!strategyLabPreviewEnabled()) return json({ error: "not found" }, 404);
  const persistenceState = strategyLabPersistenceState();
  if (persistenceState !== "enabled") {
    return json({ error: persistenceState === "misconfigured" ? "persistence unavailable" : "persistence disabled" }, 503);
  }
  const preSessionDecision = consumeStrategyLabPreSession(req.headers);
  if (!preSessionDecision.allowed) return json({ error: "rate limited" }, 429, rateLimitHeaders(preSessionDecision));
  const session = await getSession();
  if (!session) return json({ error: "unauthorized" }, 401);
  if (!canKeepPersonalData(session)) return json({ error: "not verified" }, 403);
  const decision = readLimiter.consume(subjectKey(subjectOf(session)));
  if (!decision.allowed) return json({ error: "rate limited" }, 429, rateLimitHeaders(decision));

  const query = parseQuery(req);
  if (!query.success) return json({ error: "invalid query" }, 400, rateLimitHeaders(decision));
  if (query.data.id !== undefined) {
    const result = await strategyLabGet({
      subject: subjectOf(session),
      strategyId: query.data.id,
      versionLimit: query.data.versionLimit,
      versionsBeforeRecordedAt: query.data.versionsBeforeRecordedAt ?? null,
      versionsBeforeId: query.data.versionsBeforeId ?? null,
      runLimit: query.data.runLimit,
      runsBeforeCreatedAt: query.data.runsBeforeCreatedAt ?? null,
      runsBeforeId: query.data.runsBeforeId ?? null,
      proposalLimit: query.data.proposalLimit,
      proposalsBeforeCreatedAt: query.data.proposalsBeforeCreatedAt ?? null,
      proposalsBeforeId: query.data.proposalsBeforeId ?? null,
    });
    if (!result.ok) return json({ error: "persistence unavailable" }, 503, rateLimitHeaders(decision));
    if (!result.data) return json({ error: "not found" }, 404, rateLimitHeaders(decision));
    const detail = DetailResultSchema.safeParse(result.data);
    if (!detail.success) return json({ error: "persistence integrity failure" }, 503, rateLimitHeaders(decision));
    const lastVersion = detail.data.versions.length === query.data.versionLimit
      ? detail.data.versions.at(-1)
      : undefined;
    const lastRun = detail.data.runs.length === query.data.runLimit
      ? detail.data.runs.at(-1)
      : undefined;
    const lastProposal = detail.data.proposals.length === query.data.proposalLimit
      ? detail.data.proposals.at(-1)
      : undefined;
    return json({
      ...detail.data,
      nextCursors: {
        versions: lastVersion
          ? { versionsBeforeRecordedAt: lastVersion.recordedAt, versionsBeforeId: lastVersion.versionId }
          : null,
        runs: lastRun
          ? { runsBeforeCreatedAt: lastRun.createdAt, runsBeforeId: lastRun.experimentId }
          : null,
        proposals: lastProposal
          ? { proposalsBeforeCreatedAt: lastProposal.createdAt, proposalsBeforeId: lastProposal.proposalId }
          : null,
      },
    }, 200, rateLimitHeaders(decision));
  }

  const result = await strategyLabList({
    subject: subjectOf(session),
    limit: query.data.limit,
    beforeUpdatedAt: query.data.beforeUpdatedAt ?? null,
    beforeId: query.data.beforeId ?? null,
  });
  if (!result.ok) return json({ error: "persistence unavailable" }, 503, rateLimitHeaders(decision));
  const strategies = StrategyListResultSchema.safeParse(result.data);
  if (!strategies.success) return json({ error: "persistence integrity failure" }, 503, rateLimitHeaders(decision));
  const last = strategies.data.length === query.data.limit ? strategies.data.at(-1) : undefined;
  return json({
    strategies: strategies.data,
    nextCursor: last ? { beforeUpdatedAt: last.updatedAt, beforeId: last.strategyId } : null,
  }, 200, rateLimitHeaders(decision));
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
  const decision = writeLimiter.consume(subjectKey(subjectOf(session)));
  if (!decision.allowed) return json({ error: "rate limited" }, 429, rateLimitHeaders(decision));
  const body = await readBoundedJson(req, STRATEGY_COMPILE_MAX_BODY_BYTES);
  if (!body.ok) return json({ error: body.status === 413 ? "request too large" : "invalid request" }, body.status);
  if (!DeprecatedMutationSchema.safeParse(body.value).success) {
    return json({ error: "raw strategy persistence is not accepted" }, 400);
  }
  return json({ error: "use the approval endpoint" }, 410, rateLimitHeaders(decision));
}
