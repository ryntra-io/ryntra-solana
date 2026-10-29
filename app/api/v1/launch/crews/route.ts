import { LaunchCrewCreateRequestSchema, type LaunchCrewResponse, type LaunchCrewsResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { crewOpenOn } from "@/lib/core/launch/crew";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { CREW_FAILURE_CODES, createCrew, crewView, readFlyingCrews } from "@/lib/launch/crew.server";
import { consumeSharedLaunchWrite, launchDeps, launchMarketDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/launch/crews` (contract 1.74.0, MC-2) — the crews in flight on this network: each launch whose Dynamic
 * Fee Sharing vault holds the curve's creator role, with the members whose wallets are the vault's rows. Public.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const deps = launchMarketDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  try {
    const crews = await readFlyingCrews({ store: deps.store, cluster: deps.network.cluster });
    return apiJson({ network: deps.network.chain, crews: crews.slice(0, 500).map((crew) => ({ ...crew, members: [...crew.members] })), observedAt: new Date().toISOString() } satisfies LaunchCrewsResponse, 200, rateLimitHeaders(rate));
  } catch {
    return apiFailure("UNAVAILABLE", "The crews could not be read now; try again.");
  }
}

/**
 * `POST /api/v1/launch/crews` (contract 1.74.0, MC-2) — the creator's proven wallet invites one to four people by X
 * handle, each with a part of the creator's fees. Fixed once made. CAPABILITY_UNAVAILABLE where crews are not open.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launching is paused; no crew was made.");
  if (!crewOpenOn(deps.network.cluster)) return apiFailure("CAPABILITY_UNAVAILABLE", "Crews are not open on mainnet yet.");
  const rate = await consumeSharedLaunchWrite("metadata", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, LaunchCrewCreateRequestSchema);
  if (!read.ok) return read.response;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  if (proof.address !== read.body.creator) return apiFailure("WALLET_MISMATCH", "The crew is made by the creator's own proven wallet.");
  const made = await createCrew({ store: deps.store, cluster: deps.network.cluster, now: deps.now }, read.body).catch(() => null);
  if (!made) return apiFailure("UNAVAILABLE", "The crew could not be stored; try again.");
  if (!made.ok) return apiFailure(CREW_FAILURE_CODES[made.code], made.message);
  return apiJson({ network: deps.network.chain, crew: crewView(made.crew, deps.now().getTime()), open: true } satisfies LaunchCrewResponse);
}
