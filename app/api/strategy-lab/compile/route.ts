import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FixedWindowLimiter, privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { canKeepPersonalData, getSession, subjectOf } from "@/lib/session";
import { subjectKey } from "@/lib/account/subject";
import { parseStrategyApprovalArtifact, verifyStrategyApproval } from "@/lib/strategy-lab/approval";
import { strategyLabPreviewEnabled } from "@/lib/strategy-lab/config";
import { STRATEGY_COMPILE_MAX_BODY_BYTES, consumeStrategyLabPreSession, readBoundedJson } from "@/lib/strategy-lab/http";
import { compilePineV6 } from "@/lib/strategy-lab/pine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = new FixedWindowLimiter({ limit: 30, windowMs: 10 * 60_000, maxKeys: 5_000 });
const BodySchema = z.object({
  approval: z.unknown(),
  window: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).strict(),
  initialCapital: z.number().finite().positive().max(1_000_000_000_000),
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

  const approval = parseStrategyApprovalArtifact(parsed.data.approval);
  if (!approval.success) return json({ error: "invalid approval" }, 422);
  const approvalDecision = verifyStrategyApproval({
    ...subjectOf(session),
    spec: approval.data.spec,
    approval: approval.data,
  });
  if (approvalDecision === "unconfigured") return json({ error: "approval unavailable" }, 503);
  if (approvalDecision !== "valid") return json({ error: "invalid approval" }, 422);

  const compiled = compilePineV6(approval.data.spec, parsed.data.window, { initialCapital: parsed.data.initialCapital });
  if (!compiled.ok) return json({ error: "invalid strategy", issues: compiled.issues }, 422);
  const pineHash = createHash("sha256").update(compiled.code, "utf8").digest("hex");
  return json({
    code: compiled.code,
    compilerVersion: compiled.compilerVersion,
    pineHash,
    warnings: compiled.warnings,
  }, 200, rateLimitHeaders(decision));
}
