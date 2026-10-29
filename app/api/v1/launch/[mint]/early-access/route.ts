import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import type { LaunchEarlyAccessViewResponse } from "@/lib/api/v1/contract";
import { earlyAccessReadDeps } from "@/lib/launch/early-access-runtime.server";
import { earlyAccessView } from "@/lib/launch/early-access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/launch/{mint}/early-access[?wallet=<address>]` (SOL-L5) — an early-access launch as the chain shows it
 * now: its rules and the plain lines a buyer reads, what is deposited against the cap, the phase (UPCOMING · DEPOSITS ·
 * FILLING · VESTING · DONE), the pool and the vault; with `wallet`, that wallet's deposit, what it may claim and take
 * back. A figure not read now is null, never zero. Public.
 */
export async function GET(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = earlyAccessReadDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const wallet = new URL(request.url).searchParams.get("wallet");
  if (wallet !== null && !BASE58.test(wallet)) return apiFailure("VALIDATION_ERROR", "wallet: not an address");
  const view = await earlyAccessView(deps, mint, wallet).catch(() => undefined);
  if (view === undefined) return apiFailure("UNAVAILABLE", "The launch could not be read now. Try again.");
  if (!view) return apiFailure("LAUNCH_NOT_FOUND", "No early-access launch of this token here.");
  return apiJson({
    network: deps.network.chain,
    ...view,
    rules: { ...view.rules },
    lines: { uk: [...view.lines.uk], en: [...view.lines.en] },
    creation: { state: view.creation.state, steps: { MINT: { ...view.creation.steps.MINT }, POOL: { ...view.creation.steps.POOL }, VAULT: { ...view.creation.steps.VAULT } } },
    chainProblems: [...view.chainProblems],
  } satisfies LaunchEarlyAccessViewResponse);
}
