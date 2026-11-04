import { z } from "zod";

import { buildLadderCancel } from "@/lib/bots/ladder/build.server";
import { ladderFailure, ladderHeaders, openLadder, readLadderBody } from "@/lib/bots/ladder/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The cancellations that take a ladder's money back (devnet only): `POST` the
 * owner and the ladder's order accounts. Answers one unsigned transaction per
 * order — cancel every open bin, close the account, everything back to the
 * wallet — for the wallet to sign in one prompt. Never limited to listed pools:
 * a person can always take back what is theirs.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const BodySchema = z.object({ owner: Base58, orders: z.array(Base58).min(1).max(8) }).strict();

export async function POST(request: Request) {
  const gate = openLadder(request, "cancel");
  if (gate instanceof Response) return gate;
  const body = await readLadderBody(request, BodySchema, gate.rate);
  if (body instanceof Response) return body;
  const built = await buildLadderCancel({ owner: body.owner, orders: [...new Set(body.orders)] });
  if (!built.ok) return ladderFailure(built.code === "BUILD_FAILED" ? 503 : 422, built.code, built.reason, gate.rate);
  return Response.json({ network: gate.network, transactions: built.transactions }, { headers: ladderHeaders(gate.rate) });
}
