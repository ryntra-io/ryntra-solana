import type { SeekerCheckResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { answerSeekerCheck } from "@/lib/api/v1/seeker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/auth/seeker` (contract 1.66.0, SKR-3) — «Перевірено Seeker»:
 * whether the wallet this session proved by signature holds a Seeker Genesis
 * Token, read by the server on mainnet. One route for the web (the cookie of a
 * wallet sign-in, or a wallet linked to the account) and the phone (the bearer,
 * M41.2); the address is the proof's, never a query parameter. A chain that
 * could not be read is 503, never «no Seeker». A mark, not a permission:
 * nothing is paid or unlocked by it.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const answer = await answerSeekerCheck(proof.address);
  if (!answer.ok) return apiFailure(answer.code, answer.message, { headers: answer.headers });
  return apiJson(answer.body satisfies SeekerCheckResponse);
}
