import { AGENT_DRAFT_ID, type AgentDraftResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { readDraft } from "@/lib/agent/drafts";
import { getGuardRuntime } from "@/lib/guard/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/agent/drafts/{id}` — a draft a turn prepared, read back by the
 * wallet it was prepared for while it lives: the builder opens a plan draft
 * on exactly what the person saw; the ticket a trade draft. Another wallet's
 * id is not found; an expired one is gone.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const { id } = await context.params;
  if (!AGENT_DRAFT_ID.test(id)) return apiFailure("VALIDATION_ERROR", "id: not a draft id.");
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const record = await readDraft(getGuardRuntime().store, proof.address, id, Date.now());
  if (!record) return apiFailure("AGENT_DRAFT_NOT_FOUND", "No draft of this wallet has that id, or it has expired.");
  return apiJson({ draft: record.draft, sessionId: record.sessionId, turnId: record.turnId, createdAt: record.createdAt, expiresAt: record.expiresAt } satisfies AgentDraftResponse);
}
