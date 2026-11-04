import { z } from "zod";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { mandateFailure, mandateHeaders, openMandate, readMandateBody } from "@/lib/mandate/http.server";
import { reviewSaleBack } from "@/lib/mandate/sale.server";
import { mandateConnection } from "@/lib/mandate/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * CITY-187 — a sale that did not go, taken back: `POST` the person's wallet and the sale's mandate; the answer is one
 * unsigned transaction of hers — the mandate removed and the coin back to her wallet, her sold sales' mandates removed and
 * her wSOL unwrapped with it (CITY-195). On devnet and on mainnet. This route never signs.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const BodySchema = z.object({ owner: Base58, policy: Base58 }).strict();

export async function POST(request: Request) {
  const gate = openMandate(request, "sell-back");
  if (gate instanceof Response) return gate;
  const body = await readMandateBody(request, BodySchema, gate.rate);
  if (body instanceof Response) return body;
  const back = await reviewSaleBack(body, gate, { store: getGuardRuntime().store, connection: mandateConnection(gate.network) }).catch(() => null);
  if (!back) return mandateFailure(503, "UNAVAILABLE", "The network did not answer.", gate.rate);
  if (!back.ok) return mandateFailure(back.code === "NOT_FOUND" ? 404 : 422, back.code, back.reason, gate.rate);
  return Response.json({ network: gate.network, transactions: back.transactions, coinRaw: back.figures.amountRaw }, { headers: mandateHeaders(gate.rate) });
}
