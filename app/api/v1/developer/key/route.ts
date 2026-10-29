import type { DevKeyResponse } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { DEV_KEY_HEADER, consumeDevKeyRead, devDepsOrRefusal, devFailure, quotaHeaders } from "@/lib/developer/http.server";
import { authenticateKey } from "@/lib/developer/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/developer/key` (1.83.0, DEV-2) — the credential as the server reads it, for the credential itself.
 *
 * Read by `X-Ryntra-Key` rather than a wallet: a secret key whole (`id.secret`), a public key as its id alone. The
 * answer carries no secret — the server holds only a hash of one — and the call is counted against the project's
 * quota like any other, with `X-Ryntra-Quota-*` saying where it stands.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = devDepsOrRefusal();
  if (!served.ok) return served.response;
  const rate = consumeDevKeyRead(request.headers);
  if (!rate.ok) return rate.response;
  const authenticated = await authenticateKey(served.deps, { token: request.headers.get(DEV_KEY_HEADER), scope: "read:key", origin: request.headers.get("origin") });
  if (!authenticated.ok) return devFailure(authenticated, { ...rate.headers, ...quotaHeaders(authenticated.quota ?? []) });
  const { key, project, quota } = authenticated.principal;
  return apiJson(
    { key: { id: key.id, environment: key.environment, kind: key.kind, name: key.name, scopes: key.scopes, origins: key.origins, state: key.state }, project: { id: project.id, name: project.name }, quota } satisfies DevKeyResponse,
    200,
    { ...rate.headers, ...quotaHeaders(quota) },
  );
}
