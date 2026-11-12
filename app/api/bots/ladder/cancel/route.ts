import { z } from "zod";

import { buildLadderCancel } from "@/lib/bots/ladder/build.server";
import { ladderFailure, ladderHeaders, openLadderPost } from "@/lib/bots/ladder/http.server";
import { LADDER_NETWORKS } from "@/lib/bots/ladder/network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The cancellations that take a ladder's money back: `POST` the network, the owner and the ladder's order accounts.
 * Answers one unsigned transaction per order — take back every bin, close the account, everything back to the
 * wallet — each simulated and judged, for the wallet to sign in one prompt. Never limited to listed pools, never
 * stopped by the trading stop, and still served while mainnet's switch is `CLOSING`: a person can always take back
 * what is theirs.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const BodySchema = z.object({ network: z.enum(LADDER_NETWORKS).optional(), owner: Base58, orders: z.array(Base58).min(1).max(8) }).strict();

export async function POST(request: Request) {
  const opened = await openLadderPost(request, "cancel", BodySchema, { acts: () => false, owner: (body) => body.owner, takeBack: () => true });
  if (opened instanceof Response) return opened;
  const { gate, body } = opened;
  const built = await buildLadderCancel({ owner: body.owner, orders: [...new Set(body.orders)], network: gate.network });
  if (!built.ok) return ladderFailure(built.code === "BUILD_FAILED" ? 503 : 422, built.code, built.reason, gate.rate);
  return Response.json({ network: gate.network, transactions: built.transactions }, { headers: ladderHeaders(gate.rate) });
}
