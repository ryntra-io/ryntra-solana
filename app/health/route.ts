import { publicKernelResponse } from "../../lib/guard/response.ts";
import { getGuardRuntime } from "../../lib/guard/runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The health answer of the Solana product.
 *
 * Persistence is reported from the adapter that is actually configured, not
 * from a constant: a release check opening /health must be able to tell
 * whether the operations it is about to record survive the next request
 * (`DURABLE_MULTI_WRITER` on production). Until 2026-09-14 this route still
 * named the testnet proving ground it was written for — a service name and an
 * environment the product left in August — and a health endpoint that
 * describes a different product is worse than one that says nothing.
 */
export async function GET(request: Request) {
  const guard = getGuardRuntime();
  return publicKernelResponse(request, {
    ok: true,
    service: "ryntra",
    network: "SOLANA_MAINNET",
    persistence: guard.store.durability,
    persistenceDetail: guard.store.description,
    deployment: guard.deployment,
    stateChangesAccepted: guard.writes.allowed,
  });
}
