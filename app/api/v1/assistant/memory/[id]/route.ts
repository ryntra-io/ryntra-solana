import type { AssistantMemoryResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { forgetNote, readMemoryView } from "@/lib/assistant/memory/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `DELETE /api/v1/assistant/memory/<id>` (contract 1.59.0) — «Забути»: one note of this wallet, gone for good. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const { id } = await params;
  if (!/^m_[0-9a-f]{12}$/.test(id)) return apiFailure("VALIDATION_ERROR", "Unknown note.");
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "The assistant's memory needs a durable store; this deployment does not have one.");
  const found = await forgetNote(guard.store, proof.address, id, Date.now()).catch(() => null);
  if (found === null) return apiFailure("UNAVAILABLE", "The memory could not be written now; try again.");
  if (!found) return apiFailure("MEMORY_NOTE_NOT_FOUND", "That note is not in this wallet's memory.");
  return apiJson((await readMemoryView(guard.store, proof.address, null)) satisfies AssistantMemoryResponse, 200, { "cache-control": "private, no-store" });
}
