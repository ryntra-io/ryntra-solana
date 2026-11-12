import { z } from "zod";

import { ladderPoolOpen } from "@/lib/bots/ladder/build.server";
import { ladderFailure, ladderHeaders, openLadderPost } from "@/lib/bots/ladder/http.server";
import { LADDER_NETWORKS } from "@/lib/bots/ladder/network";
import { relayLadder } from "@/lib/bots/ladder/relay.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * Forward a ladder's signed transactions to the network: `POST` the network, the owner, the kind (`place` or
 * `cancel`) and each signed transaction with its order account. Every transaction is checked before any is sent —
 * the wallet pays, every signature is present and real, only the order's own instructions, a pool open to ladders
 * for a placement (and on mainnet the cap), the money back to the wallet for a cancellation — then simulated as
 * signed and judged by what the person gets against what was promised. The answer comes as soon as each is handed to
 * the node — `sent` with its signature, or `failed` — never after waiting for the confirmation (CITY-231): the window
 * has already kept the ladder, and its reading of the order accounts and the signatures says which landed.
 *
 * This route never signs: it has no key to sign with.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(4_000);

const BodySchema = z
  .object({
    network: z.enum(LADDER_NETWORKS).optional(),
    owner: Base58,
    kind: z.enum(["place", "cancel"]),
    items: z.array(z.object({ wireBase64: Base64, limitOrder: Base58 }).strict()).min(1).max(8),
  })
  .strict();

export async function POST(request: Request) {
  /* A placement waits on mainnet's trading stop; a cancellation never does. */
  const opened = await openLadderPost(request, "submit", BodySchema, { acts: (body) => body.kind === "place", owner: (body) => body.owner, takeBack: (body) => body.kind === "cancel" });
  if (opened instanceof Response) return opened;
  const { gate, body } = opened;
  const pool = async (address: string) => {
    const read = await ladderPoolOpen(address, gate);
    return read.ok ? { open: true, baseMint: read.facts.baseMint, quoteMint: read.facts.quoteMint, baseDecimals: read.facts.baseDecimals, quoteDecimals: read.facts.quoteDecimals, activePrice: read.activePrice } : null;
  };
  const relayed = await relayLadder({ owner: body.owner, kind: body.kind, items: body.items, pools: gate.pools, network: gate.network, maxUsd: gate.maxUsd }, { pool });
  if (!relayed.ok) return ladderFailure(relayed.code === "UNREACHABLE" ? 503 : 422, relayed.code, relayed.reason, gate.rate);
  return Response.json({ network: gate.network, legs: relayed.legs }, { headers: ladderHeaders(gate.rate) });
}
