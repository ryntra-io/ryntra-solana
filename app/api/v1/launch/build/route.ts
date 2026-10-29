import { LaunchBuildRequestSchema, type LaunchBuildResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { carriedCodeFrom } from "@/lib/growth/partner";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { prepareLaunch } from "@/lib/launch/flow.server";
import { consumeSharedLaunchWrite, launchDeps, launchFailureCode } from "@/lib/launch/runtime.server";
import { readWalletProofFrom } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/build` (contract 1.25.0) — the creation the creator
 * signs: the token on the preset's config, the first purchase under its cap,
 * and first of all the creator paying Ryntra's pool payer back the rent and
 * fee the network simulated; with the lock of the purchase as a second
 * transaction when chosen; and — «Спільнота» sharing the creator's fees
 * (1.29.0) — the vault with the shares written for ever and the curve's
 * creator role handed to it, as another transaction. The bytes carry no
 * signature: the creator's wallet signs first, and the new mint's and the
 * lock's fresh keys stay on the server, sealed, until `submit` brings the same
 * messages back signed by the creator.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launching is paused; nothing was built.");
  const rate = await consumeSharedLaunchWrite("build", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, LaunchBuildRequestSchema);
  if (!read.ok) return read.response;
  /* The creator's partner: the code this browser carries from `/r/<code>`, and — only for the creator's own proven
     wallet — their earlier launches and their inviter (the Growth line's `resolvePartner`). */
  const carried = carriedCodeFrom(request.headers.get("cookie"));
  const proof = await readWalletProofFrom(request.headers).catch(() => ({ status: "unavailable" }) as const);
  const proven = proof.status === "ok" && proof.proof.chain === "solana" && proof.proof.address === read.body.creator;
  /* A node that refuses mid-build (a public RPC's 429) is an answer the client can read, never an empty 500. */
  const prepared = await prepareLaunch(deps, read.body, { carriedCode: carried, proven }).catch(() => null);
  if (!prepared) return apiFailure("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  if (!prepared.ok) return apiFailure(launchFailureCode(prepared.code, request.headers), prepared.message);
  return apiJson({
    buildId: prepared.buildId,
    network: deps.network.chain,
    unsignedWireBase64: prepared.wireBase64,
    lockUnsignedWireBase64: prepared.lockWireBase64,
    token: prepared.token,
    firstBuyOutRaw: prepared.firstBuyOutRaw,
    payerCoveredLamports: prepared.payerCoveredLamports,
    creatorCostLamports: prepared.creatorCostLamports,
    expiresAt: prepared.expiresAt,
    signableMs: prepared.signableMs,
    splitUnsignedWireBase64: prepared.splitWireBase64,
    feeVault: prepared.feeVault,
    partner: prepared.partner,
  } satisfies LaunchBuildResponse);
}
