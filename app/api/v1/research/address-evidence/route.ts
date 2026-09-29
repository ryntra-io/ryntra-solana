import { z } from "zod";

import { consumeEvidenceReadRequest } from "@/lib/agent-control/http";
import { AddressEvidenceReadSchema, BASE58, type AddressEvidenceReadDto } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { readAddressEvidence } from "@/lib/evidence/service.server";
import { rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/research/address-evidence?address=` — the recipient check
 * (`RYN-DDXYZ-RISK-001`, contract 1.6.0): what the security provider says
 * about one plain address before a person sends to it — sanctions in the
 * source's own words, findings as counts by severity with the source's own
 * figure and band, `unsupported` for a kind of address the source does not
 * read.
 *
 * Public and bounded like the token read: a per-address window here, the
 * governor behind the service, never cached at the edge. The state is always
 * answered — a program-owned recipient is a 200 with `UNKNOWN`, a provider
 * fault a 200 with `UNAVAILABLE` and the reason — because the Send page must
 * say what it knows, not spin; and nothing here blocks a transfer.
 */

const QuerySchema = z.object({ address: z.string().regex(BASE58) }).strict();

export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeEvidenceReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many evidence reads from this address; wait a minute.", { headers: rateLimitHeaders(rate) });
  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return apiFailure("VALIDATION_ERROR", "The request needs a base58 Solana address.", { headers: rateLimitHeaders(rate) });
  const read = await readAddressEvidence({ address: parsed.data.address });
  const body: AddressEvidenceReadDto = AddressEvidenceReadSchema.parse(read);
  return apiJson(body, 200, rateLimitHeaders(rate));
}
