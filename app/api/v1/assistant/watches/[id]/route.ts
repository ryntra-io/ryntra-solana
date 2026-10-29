import { AssistantWatchUpdateSchema, type AssistantWatchesResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { explainPrice } from "@/lib/assistant/watch/runtime.server";
import { readWatchSurface, removeWatch, updateWatch } from "@/lib/assistant/watch/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const localeOf = (request: Request): "en" | "uk" => (new URL(request.url).searchParams.get("locale") === "uk" ? "uk" : "en");
const ID = /^wch_[0-9a-f]{24}$/;
const NO_STORE = { "cache-control": "private, no-store" } as const;

/**
 * `PATCH /api/v1/assistant/watches/{id}` (contract 1.57.0) — pause, resume
 * or change the proven wallet's watch; a changed rule starts afresh. The
 * answer is the wallet's watches as `GET /api/v1/assistant/watches` reads them.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const { id } = await params;
  if (!ID.test(id)) return apiFailure("WATCH_NOT_FOUND", "No watch of this wallet has that id.");
  const read = await readApiBody(request, AssistantWatchUpdateSchema, 1_024);
  if (!read.ok) return read.response;
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "Token watches need a durable store; this deployment does not have one.");
  const nowMs = Date.now();
  const written = await updateWatch(guard.store, proof.address, id, read.body, nowMs);
  if (!written.ok) return apiFailure(written.code, written.reason);
  return apiJson((await readWatchSurface(guard.store, proof.address, nowMs, localeOf(request), explainPrice())) satisfies AssistantWatchesResponse, 200, NO_STORE);
}

/** `DELETE /api/v1/assistant/watches/{id}` — remove the watch; its notes stay in the inbox. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const { id } = await params;
  if (!ID.test(id)) return apiFailure("WATCH_NOT_FOUND", "No watch of this wallet has that id.");
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "Token watches need a durable store; this deployment does not have one.");
  const removed = await removeWatch(guard.store, proof.address, id);
  if (!removed.ok) return apiFailure(removed.code, removed.reason);
  return apiJson((await readWatchSurface(guard.store, proof.address, Date.now(), localeOf(request), explainPrice())) satisfies AssistantWatchesResponse, 200, NO_STORE);
}
