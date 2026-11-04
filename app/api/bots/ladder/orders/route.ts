import { z } from "zod";

import { readLadderOrders } from "@/lib/bots/ladder/build.server";
import { ladderFailure, ladderHeaders, openLadder, readLadderBody } from "@/lib/bots/ladder/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * A ladder's order accounts as devnet holds them now (devnet only): `POST` the
 * owner and the order accounts. Each is open, partly filled, filled, or closed
 * (cancelled — or never landed); the pools' prices come along for the exit
 * policy. Read-only.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const BodySchema = z.object({ owner: Base58, orders: z.array(Base58).min(1).max(24) }).strict();

export async function POST(request: Request) {
  const gate = openLadder(request, "orders");
  if (gate instanceof Response) return gate;
  const body = await readLadderBody(request, BodySchema, gate.rate);
  if (body instanceof Response) return body;
  const read = await readLadderOrders({ owner: body.owner, orders: [...new Set(body.orders)] });
  if (!read.ok) return ladderFailure(read.code === "UNREACHABLE" ? 503 : 422, read.code, read.reason, gate.rate);
  return Response.json({ network: gate.network, orders: read.orders, prices: read.prices, at: Date.now() }, { headers: ladderHeaders(gate.rate) });
}
