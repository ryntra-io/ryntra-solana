import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import type { LaunchPoolView } from "@/lib/api/v1/contract";
import { dlmmProLaunchReadDeps } from "@/lib/launch-pool/runtime.server";
import { dlmmProLaunchView } from "@/lib/launch-pool/engine.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/launch/dlmm-pro/{mint}` — a launch into a pool as its tower reads it now: the opening time
 * and the phase, the fee a purchase would pay now and the fee the schedule really settles at, the price, the step its
 * creator still has to sign, the honest-launch check from the chain and the launch's own transactions. A figure not
 * read now is null, never zero. Public.
 */
export async function GET(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = dlmmProLaunchReadDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const view = await dlmmProLaunchView(deps, mint).catch(() => undefined);
  if (view === undefined) return apiFailure("UNAVAILABLE", "The launch could not be read now. Try again.");
  if (!view) return apiFailure("LAUNCH_NOT_FOUND", "No launch of this coin here.");
  return apiJson({
    network: deps.network.chain,
    ...view,
    fee: { ...view.fee },
    price: { ...view.price },
    split: view.split ? { ...view.split } : null,
    ladder: view.ladder ? { ...view.ladder } : null,
    problems: [...view.problems],
    receipt: { COIN: [...view.receipt.COIN], POOL: [...view.receipt.POOL], SUPPLY: [...view.receipt.SUPPLY] },
  } satisfies LaunchPoolView);
}
