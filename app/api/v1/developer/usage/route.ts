import type { DevUsageResponse } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { DEV_KEY_HEADER, consumeDevKeyRead, devDepsOrRefusal, devFailure, quotaHeaders } from "@/lib/developer/http.server";
import { authenticateKey } from "@/lib/developer/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/developer/usage` (1.83.0, DEV-2) — what the key's own project has spent of its environment's windows
 * and what is left. Scope `read:usage`. A window whose number this deployment does not state reads `limit: null` and
 * `left: null`: the calls are counted, and nothing is refused on a figure nobody set.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = devDepsOrRefusal();
  if (!served.ok) return served.response;
  const rate = consumeDevKeyRead(request.headers);
  if (!rate.ok) return rate.response;
  const authenticated = await authenticateKey(served.deps, { token: request.headers.get(DEV_KEY_HEADER), scope: "read:usage", origin: request.headers.get("origin") });
  if (!authenticated.ok) return devFailure(authenticated, { ...rate.headers, ...quotaHeaders(authenticated.quota ?? []) });
  const { project, environment, quota } = authenticated.principal;
  return apiJson({ project: { id: project.id, name: project.name }, environment, windows: quota } satisfies DevUsageResponse, 200, { ...rate.headers, ...quotaHeaders(quota) });
}
