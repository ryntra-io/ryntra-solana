import { chainTerms, ladderConnection, ladderPoolOf } from "@/lib/bots/ladder/build.server";
import { ladderFailure, ladderHeaders, mainnetDoors, openLadder, requestedNetwork } from "@/lib/bots/ladder/http.server";
import { chooseVenue } from "@/lib/bots/ladder/venue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * The ladder composer (CITY-135; mainnet CITY-219): is it open on a network, and where would a ladder of this coin
 * sit — `GET ?mint=<base mint>&network=devnet|mainnet` (devnet when none is named). With the network's switch closed
 * the route does not exist for it (404). Answers the coin's pool on that network — devnet's listed pool, mainnet's
 * deepest USDC pool that takes limit orders — with what the window needs to show the exact cost line before the
 * signature: its bins, its decimals, which of its bin arrays exist, the chain's rent and priority, and on mainnet
 * the most one ladder may place. Or no pool, with the fallback's verdict.
 *
 * Read-only: nothing is built, signed or sent.
 */

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const gate = openLadder(request, "status", requestedNetwork(params.get("network")));
  if (gate instanceof Response) return gate;
  const doors = await mainnetDoors(request, gate, { acts: false, owner: null });
  if (doors) return doors;
  const mint = params.get("mint") ?? "";
  if (!MINT.test(mint)) return ladderFailure(400, "VALIDATION_ERROR", "A coin is asked for by its mint.", gate.rate);
  const connection = ladderConnection(gate.network);
  const pool = await ladderPoolOf(mint, gate, { connection });
  const terms = pool ? await chainTerms(connection, gate.network).catch(() => null) : null;
  const venue = chooseVenue({ pool: pool !== null, takesLimitOrders: pool?.takesLimitOrders ?? false, network: gate.network, stepUsd: [] });
  return Response.json(
    {
      open: true,
      network: gate.network,
      venue,
      pool:
        pool && terms
          ? { facts: pool.facts, activePrice: pool.activePrice, takesLimitOrders: pool.takesLimitOrders, existingArrays: pool.existingArrays, bitmapExtension: pool.bitmapExtension }
          : null,
      terms,
      maxUsd: gate.maxUsd,
      at: Date.now(),
    },
    { headers: ladderHeaders(gate.rate) },
  );
}
