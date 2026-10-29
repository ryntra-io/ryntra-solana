import type { DevDeliveriesResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { devDepsOrRefusal, devFailure } from "@/lib/developer/http.server";
import { readDeliveries } from "@/lib/developer/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** `GET /api/v1/developer/projects/{id}/deliveries` (1.83.0, DEV-2) — what was sent and what came back, newest first. The right it needs is `receipts`. */
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
  const log = await readDeliveries(served.deps, { projectId: id, wallet: proof.address });
  if (!log.ok) return devFailure(log, rateLimitHeaders(rate));
  return apiJson(
    { deliveries: log.deliveries.map(({ projectId: _project, ...row }) => row) } satisfies DevDeliveriesResponse,
    200,
    rateLimitHeaders(rate),
  );
}
