import { z } from "zod";

import { LIMIT_SIDES, LIMIT_VENUES } from "@/lib/solana/limits/model";
import { BASE58_ADDRESS, limitFailure, limitHeaders, openLimitGate } from "@/lib/solana/limits/http.server";
import { reviewLimitOrder } from "@/lib/solana/limits/review.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The Review of a spot limit order (B3): the venue builds the transaction, the
 * lane reads every instruction and simulates it, and the answer is what the
 * Review shows — the amounts, the price it fills at, Ryntra's fee and the
 * venue's on their own lines, the network fee and the refundable rent. Nothing
 * is signed or sent here.
 */
const RequestSchema = z
  .object({
    owner: z.string().regex(BASE58_ADDRESS),
    venue: z.enum(LIMIT_VENUES),
    side: z.enum(LIMIT_SIDES),
    baseMint: z.string().regex(BASE58_ADDRESS),
    quoteMint: z.string().regex(BASE58_ADDRESS),
    amount: z.string().regex(/^\d{1,18}(?:\.\d{1,18})?$/),
    price: z.string().regex(/^\d{1,18}(?:\.\d{1,18})?$/),
    quoteUsd: z.number().positive().finite().nullable().optional(),
  })
  .strict();

export async function POST(request: Request) {
  const gate = await openLimitGate(request, RequestSchema, { acts: true, owner: (body) => body.owner });
  if (!gate.ok) return gate.response;
  if (gate.body.baseMint === gate.body.quoteMint) return limitFailure(400, "SAME_TOKEN", "A pair needs two different tokens.", gate.rate);
  const reviewed = await reviewLimitOrder(gate.body);
  if (!reviewed.ok) return limitFailure(reviewed.status, reviewed.code, reviewed.reason, gate.rate);
  return Response.json({ review: reviewed.review }, { headers: limitHeaders(gate.rate) });
}
