import { z } from "zod";

import { readFreshBuildWindowMs, web3ChainReader } from "@/lib/solana/blockhash-life";
import { limitsConnection } from "@/lib/solana/limits/chain.server";
import { LIMIT_VENUES } from "@/lib/solana/limits/model";
import { BASE58_ADDRESS, limitFailure, limitHeaders, openLimitGate } from "@/lib/solana/limits/http.server";
import { buildLimitCancel } from "@/lib/solana/limits/review.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The unsigned cancellation of a limit order — on Jupiter its program's
 * cancel, on DLMM the cancel of every open bin and the close of the account,
 * which also takes back what already converted. Open even when trading is
 * stopped: taking one's own order back is never paused.
 */
const RequestSchema = z
  .object({
    owner: z.string().regex(BASE58_ADDRESS),
    venue: z.enum(LIMIT_VENUES),
    order: z.string().regex(BASE58_ADDRESS),
  })
  .strict();

export async function POST(request: Request) {
  const gate = await openLimitGate(request, RequestSchema, { acts: false, owner: (body) => body.owner });
  if (!gate.ok) return gate.response;
  const startedAtMs = Date.now();
  const built = await buildLimitCancel(gate.body);
  if (!built.ok) return limitFailure(built.status, built.code, built.reason, gate.rate);
  /* AG-1: the cancellation's bytes live ~30 s; the page signs inside that or builds again. */
  const signableMs = await readFreshBuildWindowMs(web3ChainReader(limitsConnection()), { startedAtMs });
  return Response.json({ transactionBase64: built.transactionBase64, requestId: built.requestId, signableMs }, { headers: limitHeaders(gate.rate) });
}
