import { z } from "zod";

import { consumeEvidenceReadRequest } from "@/lib/agent-control/http";
import { BASE58, MarketEvidenceReadSchema, type MarketEvidenceReadDto } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { EVIDENCE_PROVIDERS, EVIDENCE_WINDOWS } from "@/lib/evidence/metrics";
import { readMarketEvidence } from "@/lib/evidence/service.server";
import { rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/research/evidence?mint=&window=[&provider=]` — the observation
 * for one mint over one window (contract 1.5.0; the point-in-time window `now`
 * and the second provider since 1.6.0).
 *
 * Public, like the asset page it serves: no wallet is needed to read what
 * the market did or how the token is built. Bounded twice — a per-address
 * window here, the credit governor behind the service — and never cached at
 * the edge: the answer says where it was served from, and an edge copy would
 * make that a lie. The state is always answered (a refused budget or a
 * provider fault is a 200 with `UNAVAILABLE` and the reason), because the
 * card must show the truth, not a spinner; only a malformed request or a
 * tripped window is an error. The provider follows from the window (`now` is
 * the security provider's, the rolling windows the market provider's) unless
 * named.
 */

const QuerySchema = z
  .object({
    mint: z.string().regex(BASE58),
    window: z.enum(EVIDENCE_WINDOWS).default("24h"),
    provider: z.enum(EVIDENCE_PROVIDERS).optional(),
  })
  .strict();

export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeEvidenceReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many evidence reads from this address; wait a minute.", { headers: rateLimitHeaders(rate) });
  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return apiFailure("VALIDATION_ERROR", "The request needs a base58 mint and, optionally, a window of 24h, 7d or now and a provider.", { headers: rateLimitHeaders(rate) });
  const read = await readMarketEvidence({ mint: parsed.data.mint, window: parsed.data.window, provider: parsed.data.provider });
  const body: MarketEvidenceReadDto = MarketEvidenceReadSchema.parse(read);
  return apiJson(body, 200, rateLimitHeaders(rate));
}
