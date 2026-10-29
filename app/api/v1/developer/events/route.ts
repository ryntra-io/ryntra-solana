import type { DevEventsResponse } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { DEV_KEY_HEADER, consumeDevKeyRead, devDepsOrRefusal, devFailure, quotaHeaders } from "@/lib/developer/http.server";
import { authenticateKey, deliveriesForKey } from "@/lib/developer/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/developer/events` (1.83.0, DEV-2) — the key's own project's delivery log, newest first: what Ryntra
 * sent, how many attempts it took and what came back. Scope `read:events`; a key without it is refused
 * `DEV_SCOPE_REFUSED` rather than served a shorter list.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = devDepsOrRefusal();
  if (!served.ok) return served.response;
  const rate = consumeDevKeyRead(request.headers);
  if (!rate.ok) return rate.response;
  const authenticated = await authenticateKey(served.deps, { token: request.headers.get(DEV_KEY_HEADER), scope: "read:events", origin: request.headers.get("origin") });
  if (!authenticated.ok) return devFailure(authenticated, { ...rate.headers, ...quotaHeaders(authenticated.quota ?? []) });
  const { project, quota } = authenticated.principal;
  const log = await deliveriesForKey(served.deps, project.id);
  if (!log.ok) return devFailure(log, { ...rate.headers, ...quotaHeaders(quota) });
  return apiJson(
    { deliveries: log.deliveries.map(({ projectId: _project, ...row }) => row) } satisfies DevEventsResponse,
    200,
    { ...rate.headers, ...quotaHeaders(quota) },
  );
}
