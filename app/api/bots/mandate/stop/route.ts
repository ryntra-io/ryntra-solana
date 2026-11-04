import { z } from "zod";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { mandateFailure, mandateHeaders, openMandate, readMandateBody } from "@/lib/mandate/http.server";
import { stopTidy } from "@/lib/mandate/sale.server";
import { mandateConnection, reviewStop } from "@/lib/mandate/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * CITY-174 — stop the agent and take the rest back: `POST` the person's wallet, her smart account and the policy; the
 * answer is one unsigned transaction of hers. With CITY-195 the same transaction tidies up: her sold sales' mandates
 * removed, the vault's empty account of the coin closed, her wSOL unwrapped — every rent back to her. This route never signs.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const BodySchema = z.object({ owner: Base58, settings: Base58, policy: Base58 }).strict();

export async function POST(request: Request) {
  const gate = openMandate(request, "stop");
  if (gate instanceof Response) return gate;
  const body = await readMandateBody(request, BodySchema, gate.rate);
  if (body instanceof Response) return body;
  const store = getGuardRuntime().store;
  const connection = mandateConnection(gate.network);
  const review = await reviewStop(body, gate.network, connection, storeSurvivesColdStart(store) ? { tidy: stopTidy({ store, connection, network: gate.network }) } : {});
  if (!review.ok) return mandateFailure(review.code === "VALIDATION_ERROR" ? 400 : 422, review.code, review.reason, gate.rate);
  return Response.json({ network: gate.network, transactions: review.transactions, returnLamports: review.fundLamports }, { headers: mandateHeaders(gate.rate) });
}
