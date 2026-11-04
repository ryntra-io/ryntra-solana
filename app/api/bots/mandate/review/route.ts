import { z } from "zod";

import { mandateFailure, mandateHeaders, openMandate, readMandateBody } from "@/lib/mandate/http.server";
import { BUDGET_PRESET_IDS } from "@/lib/mandate/presets";
import { reviewEnable } from "@/lib/mandate/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * CITY-174 — turn the agent on, on the gate's network: `POST` the person's wallet, a budget preset and — on mainnet — the
 * coin the agent buys; the answer is her unsigned
 * transactions (one wallet approval) and the mandate's public addresses. This route never signs: it has no key.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const BodySchema = z.object({ owner: Base58, preset: z.enum(BUDGET_PRESET_IDS), smartAccount: Base58.nullish(), coin: Base58.nullish() }).strict();

export async function POST(request: Request) {
  const gate = openMandate(request, "review");
  if (gate instanceof Response) return gate;
  const body = await readMandateBody(request, BodySchema, gate.rate);
  if (body instanceof Response) return body;
  const review = await reviewEnable(body, gate);
  if (!review.ok) return mandateFailure(review.code === "VALIDATION_ERROR" ? 400 : 422, review.code, review.reason, gate.rate);
  return Response.json({ network: gate.network, record: review.record, transactions: review.transactions, fundLamports: review.fundLamports }, { headers: mandateHeaders(gate.rate) });
}
