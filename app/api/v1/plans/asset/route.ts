import { z } from "zod";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { BASE58, PlanAssetReadSchema, type PlanAssetRead } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { planFailure } from "@/lib/plans/http";
import { readPlanAsset } from "@/lib/plans/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/plans/asset?mint=` (contract 1.7.0): any mint resolved the way
 * `POST /api/v1/plans` will resolve it — a confirmed stock representation, or
 * a verified, tradable crypto or meme token of the Spot catalogue — as the
 * asset the plan would carry, with the planning price read now (or null: no
 * indication, the person writes their own figure) and the venue's liquidity.
 * An unconfirmed or untradable mint is `ASSET_UNCONFIRMED` with the reason; a
 * source that did not answer is `UNAVAILABLE`. Public, like the asset pages:
 * nothing here is the wallet's; the read budget of the Solana routes bounds it
 * per address.
 */

const QuerySchema = z.object({ mint: z.string().regex(BASE58) }).strict();

export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many reads from this address; wait a minute.", { headers: rateLimitHeaders(rate) });
  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return apiFailure("VALIDATION_ERROR", "The request needs a base58 mint.", { headers: rateLimitHeaders(rate) });
  const read = await readPlanAsset(parsed.data.mint);
  if (!read.ok) return planFailure(read);
  const body: PlanAssetRead = PlanAssetReadSchema.parse(read.read);
  return apiJson(body, 200, { ...rateLimitHeaders(rate), "cache-control": "private, no-store" });
}
