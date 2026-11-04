import { z } from "zod";

import { ladderFailure, ladderHeaders, openLadder, readLadderBody } from "@/lib/bots/ladder/http.server";
import { relayLadder } from "@/lib/bots/ladder/relay.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * Forward a ladder's signed transactions to devnet: `POST` the owner, the kind
 * (`place` or `cancel`) and each signed transaction with its order account.
 * Every transaction is checked before any is sent — the wallet pays, every
 * signature is present and real, only the order's own instructions, a listed
 * pool for a placement, the money back to the wallet for a cancellation — and
 * the answer says which landed.
 *
 * This route never signs: it has no key to sign with.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(4_000);

const BodySchema = z
  .object({
    owner: Base58,
    kind: z.enum(["place", "cancel"]),
    items: z.array(z.object({ wireBase64: Base64, limitOrder: Base58 }).strict()).min(1).max(8),
  })
  .strict();

export async function POST(request: Request) {
  const gate = openLadder(request, "submit");
  if (gate instanceof Response) return gate;
  const body = await readLadderBody(request, BodySchema, gate.rate);
  if (body instanceof Response) return body;
  const relayed = await relayLadder({ ...body, pools: gate.pools });
  if (!relayed.ok) return ladderFailure(422, relayed.code, relayed.reason, gate.rate);
  return Response.json({ network: gate.network, legs: relayed.legs }, { headers: ladderHeaders(gate.rate) });
}
