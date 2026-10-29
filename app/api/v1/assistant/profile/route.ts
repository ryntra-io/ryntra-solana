import { AssistantProfileUpdateSchema, type AssistantProfileResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { readProfileSurface, updateProfile } from "@/lib/assistant/profile/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" } as const;

/**
 * `GET /api/v1/assistant/profile` (contract 1.58.0) — «Знайомство»: the
 * proven wallet's five answers, or null before the person answered or
 * skipped, and where notes go (Нагляд's preferences). Reads only.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const guard = getGuardRuntime();
  if (!storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "The assistant's answers need a durable store; this deployment does not have one.");
  return apiJson((await readProfileSurface(guard.store, proof.address)) satisfies AssistantProfileResponse, 200, NO_STORE);
}

/**
 * `PUT /api/v1/assistant/profile` — the four answers or `{ "skipped": true }`;
 * with `delivery`, where notes go. Writes only the wallet's own record and
 * preferences; signs, sends and trades nothing. The answer is the same read
 * as `GET`.
 */
export async function PUT(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const read = await readApiBody(request, AssistantProfileUpdateSchema, 1_024);
  if (!read.ok) return read.response;
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "The assistant's answers need a durable store; this deployment does not have one.");
  const written = await updateProfile(guard.store, proof.address, read.body, Date.now());
  if (!written.ok) return apiFailure(written.code, written.reason);
  return apiJson((await readProfileSurface(guard.store, proof.address)) satisfies AssistantProfileResponse, 200, NO_STORE);
}
