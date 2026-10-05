import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { launchNetwork } from "@/lib/launch/config.server";
import { launchPresetsView } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/launch/presets` (contract 1.25.0) — the presets this network
 * launches on, each with the numbers its config carries for ever; the lock
 * schedules; the form's limits. Public; reads no chain and no store.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const network = launchNetwork();
  if (!network) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  return apiJson(launchPresetsView(network));
}
