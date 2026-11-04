import { z } from "zod";

import { buildLadder } from "@/lib/bots/ladder/build.server";
import { ladderFailure, ladderHeaders, openLadder, readLadderBody } from "@/lib/bots/ladder/http.server";
import { LADDER_MAX_STEPS, LADDER_MIN_STEPS, LADDER_SHAPES, LADDER_SIDES } from "@/lib/bots/ladder/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Build a ladder for the person's wallet to sign (devnet only): `POST` the
 * owner, the listed pool, one or two legs and the order accounts' public
 * addresses the browser made. Answers the unsigned transactions, each
 * simulated, the plan's rungs, the exact cost line and «what this bot can do»
 * read from the transactions themselves.
 *
 * Nothing is signed here and no key is received: the order accounts' keys stay
 * in the browser, the wallet's stay in the wallet.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

const LegSchema = z
  .object({
    side: z.enum(LADDER_SIDES),
    steps: z.number().int().min(LADDER_MIN_STEPS).max(LADDER_MAX_STEPS),
    firstPct: z.number().finite().positive(),
    lastPct: z.number().finite().positive(),
    shape: z.enum(LADDER_SHAPES),
    amountRaw: z.string().regex(/^\d{1,30}$/),
  })
  .strict();

const BodySchema = z
  .object({
    owner: Base58,
    pool: Base58,
    legs: z.array(LegSchema).min(1).max(2),
    orderKeys: z.array(Base58).min(1).max(8),
  })
  .strict();

export async function POST(request: Request) {
  const gate = openLadder(request, "review");
  if (gate instanceof Response) return gate;
  const body = await readLadderBody(request, BodySchema, gate.rate);
  if (body instanceof Response) return body;
  const built = await buildLadder({ ...body, pools: gate.pools, quotes: gate.quotes });
  if (!built.ok) return ladderFailure(built.code === "UNREACHABLE" || built.code === "SIMULATION_UNAVAILABLE" ? 503 : 422, built.code, built.reason, gate.rate);
  return Response.json(
    {
      network: gate.network,
      pool: built.pool.facts,
      activePrice: built.pool.activePrice,
      plans: built.plans,
      transactions: built.transactions,
      costs: built.costs,
      canDo: built.canDo,
    },
    { headers: ladderHeaders(gate.rate) },
  );
}
