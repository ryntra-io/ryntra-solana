import { z } from "zod";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { BASE58, RuleAssetResponseSchema, type RuleAssetResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { readRuleAsset } from "@/lib/autoinvest/asset";
import { rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/rules/asset?mint=` (contract 1.31.0): what a recurring-buy
 * rule on this mint would stand on, resolved the way `POST /api/v1/rules`
 * resolves it — a company the issuer confirms, or a token of the venue's
 * list — with the price now, the reference a price condition would stand
 * against, and on a token of the venue's list the floor and the facts of its
 * risk. A token no rule can name is answered with its facts and `refusal`
 * (the code and the sentence the create would answer); a mint nothing knows
 * is `ASSET_UNCONFIRMED`, a source that did not answer `UNAVAILABLE`. Public,
 * like the asset pages: nothing here is the wallet's; the read budget of the
 * Solana routes bounds it per address.
 */

const QuerySchema = z.object({ mint: z.string().regex(BASE58) }).strict();

export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many reads from this address; wait a minute.", { headers: rateLimitHeaders(rate) });
  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return apiFailure("VALIDATION_ERROR", "The request needs a base58 mint.", { headers: rateLimitHeaders(rate) });
  const read = await readRuleAsset(parsed.data.mint);
  if (!read.ok) return apiFailure(read.code, read.message, { headers: rateLimitHeaders(rate) });
  const body: RuleAssetResponse = RuleAssetResponseSchema.parse({ read: read.read });
  return apiJson(body, 200, { ...rateLimitHeaders(rate), "cache-control": "private, no-store" });
}
