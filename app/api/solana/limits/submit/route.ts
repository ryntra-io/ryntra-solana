import { z } from "zod";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { LIMIT_SIDES, LIMIT_VENUES } from "@/lib/solana/limits/model";
import { BASE58_ADDRESS, BASE64, limitFailure, limitHeaders, openLimitGate } from "@/lib/solana/limits/http.server";
import { submitLimit } from "@/lib/solana/limits/submit.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The wallet's signed limit order or cancellation: read again against the
 * reviewed terms, written down, relayed once (Jupiter's `/execute`, or the
 * network for DLMM), and settled from the chain. A refusal before the relay
 * says so (`submitBoundary: "NOT_CROSSED"`): the network never saw the bytes.
 */
const Raw = z.string().regex(/^\d{1,30}$/);
const TermsSchema = z
  .object({
    side: z.enum(LIMIT_SIDES),
    baseMint: z.string().regex(BASE58_ADDRESS),
    quoteMint: z.string().regex(BASE58_ADDRESS),
    inputMint: z.string().regex(BASE58_ADDRESS),
    outputMint: z.string().regex(BASE58_ADDRESS),
    makingRaw: Raw,
    takingRaw: Raw,
    price: z.string().max(40),
    fillPrice: z.number().finite(),
    pool: z.string().regex(BASE58_ADDRESS).nullable(),
    fee: z.object({ ryntraBps: z.number().int().min(0).max(255), venueBps: z.number().int().min(0).max(255), account: z.string().regex(BASE58_ADDRESS).nullable() }).strict(),
  })
  .strict();

const RequestSchema = z
  .object({
    kind: z.enum(["place", "cancel"]),
    venue: z.enum(LIMIT_VENUES),
    owner: z.string().regex(BASE58_ADDRESS),
    order: z.string().regex(BASE58_ADDRESS),
    requestId: z.string().max(80).nullable(),
    signedTransactionBase64: z.string().regex(BASE64).max(6_000),
    terms: TermsSchema.nullable(),
  })
  .strict();

export async function POST(request: Request) {
  /* A placement waits on the lane's stop; a cancellation never does. */
  const peek = request.clone();
  const kind = await peek.json().then((body: { kind?: unknown }) => body?.kind).catch(() => null);
  const gate = await openLimitGate(request, RequestSchema, { acts: kind !== "cancel", owner: (body) => body.owner });
  if (!gate.ok) return gate.response;
  const result = await submitLimit(getGuardRuntime().store, gate.body);
  if (!result.ok) {
    return limitFailure(result.status, result.code, result.reason, gate.rate, {
      submitBoundary: result.beforeSubmit ? "NOT_CROSSED" : "CROSSED",
      ...(result.signature ? { signature: result.signature } : {}),
    });
  }
  return Response.json({ state: result.state, signature: result.signature, settled: result.settled }, { headers: limitHeaders(gate.rate) });
}
