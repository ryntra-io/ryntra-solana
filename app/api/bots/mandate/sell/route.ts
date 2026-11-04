import { z } from "zod";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { mandateFailure, mandateHeaders, openMandate, readMandateBody } from "@/lib/mandate/http.server";
import { SALE_SHARES } from "@/lib/mandate/sale";
import { reviewSale } from "@/lib/mandate/sale.server";
import { mandateConnection } from "@/lib/mandate/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * CITY-187 — sell what the agent bought: `POST` the person's wallet, her agent's mandate and a share (25, 50, 100 %); the
 * answer is the figures — the coin sold, Ryntra's fee, the venue's quote and her floor — and her one unsigned transaction:
 * the coin into her vault under a sale's mandate, her sold sales' mandates removed. On devnet through the gate's pool, on
 * mainnet through Jupiter (CITY-195). This route never signs: it has no key.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const BodySchema = z.object({ owner: Base58, policy: Base58, share: z.union(SALE_SHARES.map((share) => z.literal(share)) as [z.ZodLiteral<25>, z.ZodLiteral<50>, z.ZodLiteral<100>]) }).strict();

export async function POST(request: Request) {
  const gate = openMandate(request, "sell");
  if (gate instanceof Response) return gate;
  const body = await readMandateBody(request, BodySchema, gate.rate);
  if (body instanceof Response) return body;
  const store = getGuardRuntime().store;
  if (!storeSurvivesColdStart(store)) return mandateFailure(503, "UNAVAILABLE", "The agent's book is not kept here.", gate.rate);
  const review = await reviewSale(body, gate, { store, connection: mandateConnection(gate.network) }).catch(() => null);
  if (!review) return mandateFailure(503, "UNAVAILABLE", "The network did not answer.", gate.rate);
  if (!review.ok) return mandateFailure(review.code === "UNAVAILABLE" ? 503 : 422, review.code, review.reason, gate.rate);
  return Response.json({ network: gate.network, record: review.record, transactions: review.transactions, figures: review.figures }, { headers: mandateHeaders(gate.rate) });
}
