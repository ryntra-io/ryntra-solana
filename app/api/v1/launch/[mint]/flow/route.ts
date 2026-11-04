import { BASE58, type LaunchFlowResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { launchFlowDeps, readLaunchFlow } from "@/lib/launch/flow/flow.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `GET /api/v1/launch/{mint}/flow` (contract 1.89.0, Launch strategy L3) — who bought a launch and how, as facts of
 * the chain: the buys in its launch slot, the same-slot bundles, the creator's strip, the independent buyers with each
 * funding cluster counted once, how many filled the curve, the survival proofs checked against the creator's party, and
 * the creator's earlier coins. Read only; never a verdict. Public.
 */
export async function GET(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchFlowDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  try {
    const flow = await readLaunchFlow(deps, mint);
    if (!flow) return apiFailure("LAUNCH_NOT_FOUND", "No Ryntra launch of this token here, or its creation is not confirmed yet.");
    return apiJson(flow satisfies LaunchFlowResponse);
  } catch {
    return apiFailure("UNAVAILABLE", "The chain could not be read now; try again.");
  }
}
