import { z } from "zod";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { BASE58, POPULAR_DEFAULT_LIMIT, POPULAR_MAX_LIMIT, PopularCompaniesResponseSchema, type PopularCompaniesResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { popularCompanies } from "@/lib/stocks/popular";
import { readStockUniverse } from "@/lib/stocks/universe.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* A cold read of the universe can take seconds; every warm one is memory. */
export const maxDuration = 30;

/**
 * `GET /api/v1/stocks/popular[?limit=][&exclude=<mint>]` (contract 1.20.0,
 * `RYN-BUY-FLOW-001` subtask 2): «Популярні компанії» as the server lists them
 * — the listed companies a beginner is shown, one card each, by the day's
 * trading across their representations, the same for everyone
 * (`lib/stocks/popular.ts`). Home, the column beside a company's page and the
 * phone read one list. `exclude` leaves out a company beside its own page.
 * Public, like the pages that draw it; the read budget of the Solana routes
 * bounds it per address, and the universe it is cut from is the server's warm
 * copy.
 */

const QuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(POPULAR_MAX_LIMIT).default(POPULAR_DEFAULT_LIMIT),
    exclude: z.string().regex(BASE58).optional(),
  })
  .strict();

export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many reads from this address; wait a minute.", { headers: rateLimitHeaders(rate) });
  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return apiFailure("VALIDATION_ERROR", `The request takes a limit of 1–${POPULAR_MAX_LIMIT} and a base58 mint to exclude.`, { headers: rateLimitHeaders(rate) });
  const read = await readStockUniverse();
  if (!read.ok) return apiFailure("UNAVAILABLE", "The companies could not be read right now; ask again in a minute.", { headers: rateLimitHeaders(rate) });
  const body: PopularCompaniesResponse = PopularCompaniesResponseSchema.parse({
    companies: popularCompanies(read.universe.rows, { limit: parsed.data.limit, exclude: parsed.data.exclude ?? null }),
    order: "volume-24h",
    fetchedAt: read.universe.fetchedAt,
  });
  return apiJson(body, 200, { ...rateLimitHeaders(rate), "cache-control": "private, no-store" });
}
