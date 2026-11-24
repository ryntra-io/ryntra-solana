import { type LaunchStockPairResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { stockPairOpen } from "@/lib/core/launch/stock-pair";
import { launchConnection, launchNetwork } from "@/lib/launch/config.server";
import { STOCK_PAIR_PRESET_VIEW, offerPlain, readStockPairOffers } from "@/lib/launch/stock-pair.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/launch/stock-pair` — «У парі з акцією»: the stocks of the register a coin
 * may be launched against, each read now from the chain, the price and the shelf of checked stocks — open or closed with
 * the reasons, the curve's threshold in the stock's own units, its market caps, and the facts of the line before the
 * signature. Served only where `RYNTRA_LAUNCH_STOCK_PAIR=open`; elsewhere CAPABILITY_UNAVAILABLE. Public, reads only.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!stockPairOpen(process.env)) return apiFailure("CAPABILITY_UNAVAILABLE", "A launch paired with a stock is not offered here.");
  const network = launchNetwork();
  if (!network) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const offers = await readStockPairOffers({ cluster: network.cluster, connection: launchConnection(network), env: process.env }).catch(() => undefined);
  if (offers === undefined) return apiFailure("UNAVAILABLE", "The stocks could not be read now; try again.");
  if (offers === null) return apiFailure("CAPABILITY_UNAVAILABLE", "A launch paired with a stock is not offered here.");
  return apiJson({
    network: network.chain,
    preset: STOCK_PAIR_PRESET_VIEW,
    stocks: offers.map(offerPlain),
    checkedAt: new Date().toISOString(),
  } satisfies LaunchStockPairResponse);
}
