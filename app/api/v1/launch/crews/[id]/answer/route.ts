import { LaunchCrewAnswerRequestSchema, type LaunchCrewResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { crewOpenOn } from "@/lib/core/launch/crew";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { CREW_FAILURE_CODES, answerCrew, crewView, isCrewId } from "@/lib/launch/crew.server";
import { consumeSharedLaunchWrite, launchDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `POST /api/v1/launch/crews/{id}/answer` (contract 1.74.0, MC-2) — an invitee's own yes or no for the handle they were
 * invited by, with their proven wallet (a mutation: the wallet's own signature). The creator never answers for their
 * crew; a yes is taken back until liftoff. CAPABILITY_UNAVAILABLE where crews are not open.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launching is paused; nothing was answered.");
  if (!crewOpenOn(deps.network.cluster)) return apiFailure("CAPABILITY_UNAVAILABLE", "Crews are not open on mainnet yet.");
  const rate = await consumeSharedLaunchWrite("claimBuild", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { id } = await context.params;
  if (!isCrewId(id)) return apiFailure("LAUNCH_NOT_FOUND", "No such crew.");
  const read = await readApiBody(request, LaunchCrewAnswerRequestSchema);
  if (!read.ok) return read.response;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const answered = await answerCrew({ store: deps.store, cluster: deps.network.cluster, now: deps.now }, { id, handle: read.body.handle, wallet: proof.address, answer: read.body.answer }).catch(() => null);
  if (!answered) return apiFailure("UNAVAILABLE", "The answer could not be stored; try again.");
  if (!answered.ok) return apiFailure(CREW_FAILURE_CODES[answered.code], answered.message);
  return apiJson({ network: deps.network.chain, crew: crewView(answered.crew, deps.now().getTime()), open: true } satisfies LaunchCrewResponse);
}
