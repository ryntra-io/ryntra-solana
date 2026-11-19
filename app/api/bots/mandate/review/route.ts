import { z } from "zod";

import { mandateFailure, mandateHeaders, openMandate, readMandateBody } from "@/lib/mandate/http.server";
import { DAYS_MAX } from "@/lib/mandate/budget";
import { reviewEnable } from "@/lib/mandate/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Turn the agent on, on the gate's network: `POST` the person's wallet, her budget — the day's cap and the
 * trade's in lamports, the term in days, any numbers she wrote — and, on mainnet, the coin the
 * agent buys; the answer is her unsigned transactions (one wallet approval), the mandate's public addresses, and what the
 * signature moves into her vault and gives the agent for its fees. This route never signs: it has no key.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Lamports = z.string().regex(/^\d{1,20}$/);
const BodySchema = z.object({ owner: Base58, perDay: Lamports, perTrade: Lamports, days: z.number().int().min(1).max(DAYS_MAX), smartAccount: Base58.nullish(), coin: Base58.nullish() }).strict();

export async function POST(request: Request) {
  const gate = openMandate(request, "review");
  if (gate instanceof Response) return gate;
  const body = await readMandateBody(request, BodySchema, gate.rate);
  if (body instanceof Response) return body;
  const budget = { perDay: BigInt(body.perDay), perTrade: BigInt(body.perTrade), days: body.days };
  const review = await reviewEnable({ owner: body.owner, budget, smartAccount: body.smartAccount ?? null, coin: body.coin ?? null }, gate);
  if (!review.ok) return mandateFailure(review.code === "VALIDATION_ERROR" ? 400 : 422, review.code, review.reason, gate.rate);
  return Response.json({ network: gate.network, record: review.record, transactions: review.transactions, fundLamports: review.fundLamports, networkLamports: review.networkLamports }, { headers: mandateHeaders(gate.rate) });
}
