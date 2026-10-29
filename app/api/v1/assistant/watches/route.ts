import { AssistantWatchCreateSchema, type AssistantWatchesResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { explainPrice, lookupToken } from "@/lib/assistant/watch/runtime.server";
import { createWatch, readWatchSurface } from "@/lib/assistant/watch/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { FixedWindowLimiter, rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Twelve new watches a minute per wallet on a warm instance: a person sets three, a script would set hundreds. */
const limiter = new FixedWindowLimiter({ limit: 12, windowMs: 60_000, maxKeys: 5_000 });

const localeOf = (request: Request): "en" | "uk" => (new URL(request.url).searchParams.get("locale") === "uk" ? "uk" : "en");
const NO_STORE = { "cache-control": "private, no-store" } as const;

/**
 * `GET /api/v1/assistant/watches` (contract 1.57.0) — the proven wallet's
 * token watches, what each reads now and its latest note, the presets and
 * how many of the three free watches are left. Reads only.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const guard = getGuardRuntime();
  if (!storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "Token watches need a durable store; this deployment does not have one.");
  return apiJson((await readWatchSurface(guard.store, proof.address, Date.now(), localeOf(request), explainPrice())) satisfies AssistantWatchesResponse, 200, NO_STORE);
}

/**
 * `POST /api/v1/assistant/watches` — start a watch on a token, by mint, from
 * a preset or a rule. Writes only the wallet's own watch; signs, sends and
 * trades nothing. The answer is the same read as `GET`.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const read = await readApiBody(request, AssistantWatchCreateSchema, 1_024);
  if (!read.ok) return read.response;
  const rate = limiter.consume(proof.address);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many watches in a minute; try again shortly.", { headers: rateLimitHeaders(rate) });
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "Token watches need a durable store; this deployment does not have one.");
  const nowMs = Date.now();
  const made = await createWatch(guard.store, proof.address, read.body, nowMs, lookupToken);
  if (!made.ok) return apiFailure(made.code, made.reason, { headers: rateLimitHeaders(rate) });
  return apiJson((await readWatchSurface(guard.store, proof.address, nowMs, localeOf(request), explainPrice())) satisfies AssistantWatchesResponse, 200, { ...rateLimitHeaders(rate), ...NO_STORE });
}
