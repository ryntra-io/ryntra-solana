import type { DevProjectResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { devDepsOrRefusal, devFailure } from "@/lib/developer/http.server";
import { readProject } from "@/lib/developer/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/developer/projects/{id}` (1.83.0, DEV-2) — the project as the proven wallet may read it: its
 * credentials without a secret among them, its endpoints without their signing secrets, what each environment has
 * spent of each window, and what this wallet's role lets it do. A wallet outside the project's team gets
 * `DEV_NOT_FOUND`, the same as a project that is not there.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = devDepsOrRefusal();
  if (!served.ok) return served.response;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const { id } = await context.params;
  const project = await readProject(served.deps, { id, wallet: proof.address });
  if (!project.ok) return devFailure(project, rateLimitHeaders(rate));
  return apiJson({ project: project.project } satisfies DevProjectResponse, 200, rateLimitHeaders(rate));
}
