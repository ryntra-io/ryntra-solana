import { readLadderPool } from "@/lib/bots/ladder/build.server";
import { ladderFailure, ladderHeaders, openLadder } from "@/lib/bots/ladder/http.server";
import { chooseVenue } from "@/lib/bots/ladder/venue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * The ladder composer (CITY-135): is it open, and where would a ladder of this
 * coin sit — `GET ?mint=<base mint>`. Devnet only: with the switch closed the
 * route does not exist (404). Answers the listed devnet pool of the coin with
 * what the window needs to show the exact cost line before the signature —
 * its bins, its decimals, which of its bin arrays exist — or no pool, with the
 * fallback's verdict (Jupiter Trigger V1 is mainnet-only, so not here).
 *
 * Read-only: nothing is built, signed or sent.
 */

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(request: Request) {
  const gate = openLadder(request, "status");
  if (gate instanceof Response) return gate;
  const mint = new URL(request.url).searchParams.get("mint") ?? "";
  if (!MINT.test(mint)) return ladderFailure(400, "VALIDATION_ERROR", "A coin is asked for by its mint.", gate.rate);
  for (const address of gate.pools) {
    const pool = await readLadderPool(address, gate.quotes);
    if (!pool.ok || pool.facts.baseMint !== mint) continue;
    const venue = chooseVenue({ pool: true, takesLimitOrders: pool.takesLimitOrders, network: gate.network, stepUsd: [] });
    return Response.json(
      {
        open: true,
        network: gate.network,
        venue,
        pool: {
          facts: pool.facts,
          activePrice: pool.activePrice,
          takesLimitOrders: pool.takesLimitOrders,
          existingArrays: pool.existingArrays,
          bitmapExtension: pool.bitmapExtension,
        },
        at: Date.now(),
      },
      { headers: ladderHeaders(gate.rate) },
    );
  }
  const venue = chooseVenue({ pool: false, takesLimitOrders: false, network: gate.network, stepUsd: [] });
  return Response.json({ open: true, network: gate.network, venue, pool: null, at: Date.now() }, { headers: ladderHeaders(gate.rate) });
}
