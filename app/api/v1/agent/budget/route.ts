import { readBudgetState, resolveAgentBudgetConfig } from "@/lib/agent/budget";
import type { AgentBudgetState } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `GET /api/v1/agent/budget` — the proven wallet's allowance and what is spent of it, from the durable meter; whether a model composes here at all. */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const state = await readBudgetState(getGuardRuntime().store, proof.address, resolveAgentBudgetConfig(process.env), Date.now());
  return apiJson(state satisfies AgentBudgetState);
}
