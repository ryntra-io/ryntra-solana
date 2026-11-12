import { z } from "zod";

import { readLadderOrders } from "@/lib/bots/ladder/build.server";
import { ladderFailure, ladderHeaders, openLadderPost } from "@/lib/bots/ladder/http.server";
import { LADDER_NETWORKS } from "@/lib/bots/ladder/network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * A ladder's order accounts as the network holds them now: `POST` the network, the owner and the order accounts.
 * Each is open, partly filled, filled, or closed (cancelled — or never landed); the pools' prices come along for the
 * exit policy. With `signatures` — the transactions the window sent and still waits for — the chain's word on each
 * comes back too (`landed`): the relay answers as soon as it sends, and this is the confirmation. Read-only.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
const BodySchema = z.object({ network: z.enum(LADDER_NETWORKS).optional(), owner: Base58, orders: z.array(Base58).min(1).max(24), signatures: z.array(Signature).max(24).optional() }).strict();

export async function POST(request: Request) {
  const opened = await openLadderPost(request, "orders", BodySchema, { acts: () => false, owner: (body) => body.owner, takeBack: () => true });
  if (opened instanceof Response) return opened;
  const { gate, body } = opened;
  const read = await readLadderOrders({ owner: body.owner, orders: [...new Set(body.orders)], network: gate.network, signatures: [...new Set(body.signatures ?? [])] });
  if (!read.ok) return ladderFailure(read.code === "UNREACHABLE" ? 503 : 422, read.code, read.reason, gate.rate);
  return Response.json({ network: gate.network, orders: read.orders, prices: read.prices, landed: read.landed, at: Date.now() }, { headers: ladderHeaders(gate.rate) });
}
