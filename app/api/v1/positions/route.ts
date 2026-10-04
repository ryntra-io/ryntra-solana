import type { PositionsResponse } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { productionPositionsDeps } from "@/lib/monitoring/positions.deps.server";
import { readPositions } from "@/lib/monitoring/positions.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Нагляд over the proven wallet's positions (contract 1.21.0): every company
 * the chain says the wallet holds, with its exit, the state it is in and its
 * one action — decided here, by the same rules for the web and the phone. A
 * position that could not be read is not listed and never called unprotected;
 * `read` says what answered.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const store = getGuardRuntime().store;
  const read = await readPositions(store, proof.address, Date.now(), productionPositionsDeps(store));
  return apiJson({
    address: proof.address,
    positions: [...read.positions],
    channel: { telegram: read.telegram },
    read: { holdings: read.holdings, market: read.market, at: read.at },
  } satisfies PositionsResponse);
}
