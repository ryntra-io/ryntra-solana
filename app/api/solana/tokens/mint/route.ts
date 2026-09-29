import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { readMintAccount } from "@/lib/solana/mint";
import { SOLANA_NETWORKS, createSolanaRpcHandle } from "@/lib/solana/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The two structural facts about a mint, read from the chain.
 *
 * `/api/solana/tokens/search` answers from Jupiter's catalogue, and the
 * catalogue's `decimals` is `number | null` — it is allowed not to know. When
 * it does not, the Swap card had nowhere else to ask: it marked the mint
 * attempted so it would not loop, and the pair then sat on *Reading both
 * assets…* for as long as anyone cared to wait. A person could pick a real
 * token that a real route exists for and never be offered a quote, because a
 * third-party list had a gap in it.
 *
 * The chain does not have that gap. `decimals` is a byte in the mint account
 * and the owning program is the account's owner, so both are one read away and
 * neither is anybody's opinion. This route is that read, and it is deliberately
 * the smallest one: no supply, no authorities, no extensions. The Asset
 * Passport is where a mint is *examined*; this is only what a swap cannot be
 * built without.
 *
 * Reading, so it sits on the read budget with the catalogue search and the
 * quote — not on the twelve-per-minute action window, which exists for things
 * that move money.
 */

const RequestSchema = z
  .object({
    mint: z.string().min(32).max(44),
    network: z.enum(SOLANA_NETWORKS).default("mainnet"),
  })
  .strict();

function responseHeaders(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: responseHeaders(rate) });
}

export async function POST(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const body = await readAgentControlJson(request);
  if (!body.ok) return failure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return failure(400, "VALIDATION_ERROR", "That is not a mint address this route will read.", rate);
  }

  const handle = createSolanaRpcHandle({ network: parsed.data.network });
  const result = await readMintAccount(handle, parsed.data.mint);
  if (!result.ok) {
    /* `NOT_A_MINT` and `ACCOUNT_ABSENT` are answers about the address, not
       faults of this deployment; an RPC that would not answer is. Keeping them
       apart is what lets the surface say "that is not a token" instead of
       "something went wrong". */
    const status = result.code === "RPC_FAILED" ? 503 : 422;
    return failure(status, `MINT_${result.code}`, result.reason, rate);
  }

  return Response.json(
    {
      mint: parsed.data.mint,
      decimals: result.decoded.decimals,
      tokenProgram: result.raw.owner,
      observedAt: result.raw.observedAt,
      endpointHost: result.raw.endpointHost,
    },
    { headers: responseHeaders(rate) },
  );
}
