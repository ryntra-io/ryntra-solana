import { API_VERSION_HEADER } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { launchNetwork } from "@/lib/launch/config.server";
import { launchPresetsView } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/launch/presets` (contract 1.25.0) — the presets this network
 * launches on, each with the numbers its config carries for ever; the lock
 * schedules; the form's limits. Public; reads no chain and no store.
 *
 * 1.38.0: a preset whose first purchase must go under the creator's lock (Micro) is listed only to a client that names
 * contract 1.38.0 or later in `X-Ryntra-API-Version` — a client before it cannot keep the lock and would be refused.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const network = launchNetwork();
  if (!network) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const view = launchPresetsView(network);
  if (knowsRequiredLock(request.headers.get(API_VERSION_HEADER))) return apiJson(view);
  return apiJson({ ...view, presets: view.presets.filter((preset) => preset.creatorLockMinDays === null) });
}

/** Whether a client's named contract is 1.38.0 or later. */
function knowsRequiredLock(version: string | null): boolean {
  const [major = 0, minor = 0] = (version ?? "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  return major > 1 || (major === 1 && minor >= 38);
}
