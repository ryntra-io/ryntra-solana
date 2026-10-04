import type { PlanMemoryResponse } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { readMonitoringSurface } from "@/lib/monitoring/service.server";
import { monitorNotes } from "@/lib/monitoring/store";
import { listPlanMemory } from "@/lib/plans/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Strategy memory for the proven wallet (1.9.0): what the product remembers
 * about how this person decides, as facts over the records they already own —
 * the plans written on an asset, the Reviews judged, the rule that refused
 * every one of them, how an actual entry stood against the planned one, a
 * position still open, an exit against the rules that existed before it, and
 * what Monitoring wrote.
 *
 * Every fact is derived at read time and cites the plan, the version, the
 * Review, the signature or the note it stands on, so nothing here can drift
 * from the record it describes and no model can write to it. The server
 * states the figures; the client composes the sentence in the reader's
 * language.
 *
 * The monitoring notes are read through the monitoring surface for this same
 * wallet — one owner-checked read, never a second store.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const store = getGuardRuntime().store;
  /* A monitoring surface that cannot be read leaves memory the plans' own facts, which is smaller and never wrong. */
  const surface = await readMonitoringSurface(store, proof.address, Date.now(), "en").catch(() => null);
  const read = await listPlanMemory(store, proof.address, monitorNotes(surface?.recent ?? []));
  return apiJson({ address: proof.address, facts: [...read.facts], sync: read.sync } satisfies PlanMemoryResponse);
}
