import { resolveRelayApiKey } from "@/lib/relay/api-key.server";
import { fetchRelayChains } from "@/lib/relay/chain-index";
import { RELAY_CHAIN_IDS } from "@/lib/relay/chains";
import { SWAP_NETWORK_META, SWAP_NETWORKS, type SwapNetwork } from "@/lib/swap/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Which networks Bridge may offer this minute.
 *
 * Two gates, and the answer is the intersection — never either one alone.
 *
 * **Relay must be carrying it.** Read live from Relay's own chain index, so a
 * chain it disables, turns deposits off for, or reports lagging blocks on stops
 * being offered without a release. This is the half that was missing: the
 * selector used to state four networks from a table and would have kept stating
 * them through an outage.
 *
 * **Ryntra must be able to finish the job.** A network is only offerable when
 * this product can sign on it, read a balance on it, reserve gas for its MAX
 * button, link its explorer and name it in both languages. Relay carries 60
 * chains and 53 are on a machine we have a signer for — but a signer is the
 * first of five things, not all five, so the offered set stays the ones this
 * product has actually integrated. Widening it is per-network work with a
 * measured gas reserve at the end of it, not a bigger list.
 *
 * **And neither gate is a route.** A pair can pass both and still have no
 * liquidity at this size, this minute. The live quote is the only thing that
 * ever says a route exists, which is why nothing here is called "available".
 */
export async function GET() {
  const index = await fetchRelayChains({ apiKey: resolveRelayApiKey() });

  /* Relay unreachable is not "no networks". The integrated set is what this
     product supports; the live index only ever removes from it, so a failed read
     degrades to the full set rather than to an empty selector — a person who
     cannot reach Relay's metadata can still be shown the form, and the quote
     will tell them the truth a moment later. */
  const live = index.ok ? new Map(index.chains.map((chain) => [chain.id, chain])) : null;

  const networks = SWAP_NETWORKS.map((network: SwapNetwork) => {
    const chain = live?.get(RELAY_CHAIN_IDS[network]) ?? null;
    return {
      id: network,
      label: SWAP_NETWORK_META[network].label,
      chainId: RELAY_CHAIN_IDS[network],
      /* Absent from a successful index means Relay has dropped the chain
         entirely, which is a stronger fact than any flag on it. */
      offerable: live === null ? true : chain !== null && chain.carrying,
      reason: live === null ? null : chain === null ? "NOT_IN_INDEX" : chain.notCarryingReason,
    };
  });

  return Response.json(
    {
      networks,
      /* Said out loud so a surface never reads a degraded answer as a live one. */
      source: index.ok ? "RELAY_LIVE" : "INTEGRATED_SET_ONLY",
      observedAt: index.ok ? index.observedAt : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
