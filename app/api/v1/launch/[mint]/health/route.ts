import { after } from "next/server";

import { BASE58, type LaunchMarketHealthResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { marketForAnswer, marketHealth } from "@/lib/launch/health.server";
import { launchHealthDeps, launchViewDeps } from "@/lib/launch/runtime.server";
import { readLaunchView } from "@/lib/launch/view.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `GET /api/v1/launch/{mint}/health` (contract 1.36.0) — a market's health by
 * fixed definitions: its state of the cycle, executable depth at −2, −5 and
 * −10 %, its budget, survival, holders, the creator, concentration, Ryntra's
 * executor, and the rules and policies that keep it now. A figure not read is
 * null, never zero. Public. A read a while old answers at once with its own
 * time and is read again behind the answer.
 */
export async function GET(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchHealthDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  try {
    const viewDeps = launchViewDeps();
    const [{ read, behind }, view] = await Promise.all([marketForAnswer(deps, mint), viewDeps ? readLaunchView(viewDeps, mint).catch(() => null) : Promise.resolve(null)]);
    if (behind) after(() => behind().catch(() => null));
    if (!read) return apiFailure("LAUNCH_NOT_FOUND", "No Ryntra launch of this token here, or its creation is not confirmed yet.");
    const health = marketHealth(read, deps.network, view);
    if (!health) return apiFailure("UNAVAILABLE", "The chain could not be read now; try again.");
    return apiJson(health satisfies LaunchMarketHealthResponse);
  } catch {
    return apiFailure("UNAVAILABLE", "The chain could not be read now; try again.");
  }
}
