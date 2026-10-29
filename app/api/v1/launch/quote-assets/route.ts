import { type LaunchQuoteAssetsResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { launchConnection, launchNetwork } from "@/lib/launch/config.server";
import { readQuoteAssets } from "@/lib/launch/quote-asset.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/launch/quote-assets` (contract 1.83.0, SOL-L11) — the pair currencies this deployment checked, read from
 * the chain: Meteora's token badge for each (a pair without one is never offered, and only Meteora gives one), the
 * mint's program, extensions, fee and authorities against the register, the pair's price with the moment it was
 * observed, and the DBC version the fee needs. A pair whose every fact reads as it was checked is `OPEN`; a single
 * difference leaves it `CLOSED` with the reasons said.
 *
 * Public. Reads the chain and the price source, never a key; the answer may be a read of the last few seconds, and a
 * build takes its own.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const network = launchNetwork();
  if (!network) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const states = await readQuoteAssets({ cluster: network.cluster, connection: launchConnection(network), env: process.env }, { cache: true }).catch(() => null);
  if (!states) return apiFailure("UNAVAILABLE", "The pair currencies could not be read now; try again.");
  return apiJson({
    network: network.chain,
    assets: states.map((state) => ({
      mint: state.record.mint,
      symbol: state.record.symbol,
      decimals: state.record.decimals,
      state: state.state,
      configVersion: state.configVersion,
      feeNow: state.feeNow ? { epoch: state.feeNow.epoch, bps: state.feeNow.bps, maxRaw: state.feeNow.maxRaw } : null,
      priceUsd: state.priceUsd,
      priceAt: state.priceAt,
      reasons: [...state.problems],
    })),
    checkedAt: states[0]?.checkedAt ?? new Date().toISOString(),
  } satisfies LaunchQuoteAssetsResponse);
}
