/**
 * The bridge route matrix: which networks and assets a person may actually
 * move between, and why the others are not offered.
 *
 * `RYN-SOL-MONEY-FLOWS-001E` (2026-09-05) researched three candidate pairs and
 * three assets across LI.FI, Relay and Circle CCTP and found, on the live
 * provider endpoints of that day, exactly this:
 *
 * - **Solana ↔ Base, USDC** — Circle CCTP V2. Four founder-signed mainnet
 *   transfers settled and reconciled MATCHED. Open to people.
 * - **Solana ↔ Ethereum, USDC** — the same rail. Circle lists Ethereum as
 *   domain 0 with the identical V2 contracts, the whole lane is built through
 *   the same code as Base, and it has moved no money yet. It opens only after
 *   the first founder-signed transfer is read back from both chains and its
 *   own variable is set (`lane-state.ts`).
 * - **Solana ↔ Robinhood Chain, USDC** — no route exists. Circle has no
 *   domain for Robinhood Chain; LI.FI lists 295 tokens there and none of them
 *   is USDC; Relay lists USDG alone; Robinhood's own bridging page names a
 *   canonical bridge to Ethereum and partner routes and never mentions Solana.
 *   The one thing a provider *will* do is turn Solana USDC into Robinhood USDG
 *   through Layerswap, which is a different asset and therefore a cross-chain
 *   swap — `RYN-SOL-MONEY-FLOWS-001F`'s territory, never quietly offered here
 *   as if it were the same money on another chain. Since 2026-09-09 that swap
 *   exists: `RYN-SOL-MONEY-FLOWS-001H` opened six Solana ↔ Robinhood Chain
 *   pairs through Relay in the cross-swap lane. Nothing about this row changed
 *   — there is still no USDC on chain 4663 and still no Circle domain for it —
 *   only where a person is sent to find the thing that does work.
 * - **ETH and SOL** — on Solana, "ETH" is Wormhole-wrapped Ether with eight
 *   decimals; on Ethereum and Base, "SOL" is a wrapped or bridged token. CCTP
 *   is a USDC rail. Moving native SOL to native ETH is a swap, and the product
 *   says so instead of listing the tickers as if they were bridgeable.
 *
 * This module is the one place that knowledge lives. The card reads it through
 * `/api/solana/bridge/routes`; the plan and burn routes refuse a network it
 * says is not open. A provider listing a chain never makes it appear here.
 */

import { CCTP_EVM_CHAINS, cctpChainLabel, type CctpEvmChain } from "./cctp-direction.ts";
import { resolveSolanaBridgeNetworkState, resolveSolanaLaneState } from "./lane-state.ts";

export type BridgeNetworkId = CctpEvmChain | "robinhood-chain";

/**
 * - `AVAILABLE` — a person can compose, review and sign on it now.
 * - `NOT_OPEN` — built and gated; nothing can be composed until the operator
 *   opens it after the first verified transfer.
 * - `UNAVAILABLE` — no route exists for this asset; named so nobody looks for
 *   it under a different button.
 */
export type BridgeNetworkState = "AVAILABLE" | "NOT_OPEN" | "UNAVAILABLE";

export type BridgeNetworkReason =
  | "LANE_PAUSED"
  | "AWAITING_FIRST_VERIFIED_TRANSFER"
  | "NO_NATIVE_USDC_ROUTE";

export type BridgeNetworkRoute = Readonly<{
  id: BridgeNetworkId;
  label: string;
  state: BridgeNetworkState;
  /** Null when the network is available. */
  reason: BridgeNetworkReason | null;
  provider: "CIRCLE_CCTP_V2" | null;
  /** Both lane names, when the rail exists. Empty for a network with no route. */
  directions: readonly string[];
}>;

export type BridgeAssetNote = Readonly<{
  symbol: "ETH" | "SOL";
  /** Why the asset is not on the bridge. It moves as a swap, not as itself. */
  reason: "CROSS_CHAIN_SWAP_NOT_A_BRIDGE";
}>;

export type BridgeRouteMatrix = Readonly<{
  schema: "ryntra.solana.bridge-routes";
  schemaVersion: "1.0.0";
  asset: "USDC";
  networks: readonly BridgeNetworkRoute[];
  otherAssets: readonly BridgeAssetNote[];
  observedAt: string;
}>;

const ROBINHOOD_CHAIN_LABEL = "Robinhood Chain";

function cctpNetwork(chain: CctpEvmChain, env: Record<string, string | undefined>): BridgeNetworkRoute {
  const lane = resolveSolanaLaneState("BRIDGE", env);
  const network = resolveSolanaBridgeNetworkState(chain, env);
  const state: BridgeNetworkState = network === "OPEN" ? "AVAILABLE" : "NOT_OPEN";
  const reason: BridgeNetworkReason | null =
    state === "AVAILABLE" ? null : lane !== "OPEN" ? "LANE_PAUSED" : "AWAITING_FIRST_VERIFIED_TRANSFER";
  return {
    id: chain,
    label: cctpChainLabel(chain),
    state,
    reason,
    provider: "CIRCLE_CCTP_V2",
    directions: chain === "base" ? ["SOLANA_TO_BASE", "BASE_TO_SOLANA"] : ["SOLANA_TO_ETHEREUM", "ETHEREUM_TO_SOLANA"],
  };
}

/**
 * The matrix for this deployment, right now.
 *
 * Pure over its inputs: the environment decides the two gated states and
 * nothing else moves. A provider is never consulted here — the day's provider
 * research is the reason each row says what it says, and it is written above
 * rather than re-fetched on every page load.
 */
export function resolveBridgeRouteMatrix(
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): BridgeRouteMatrix {
  return {
    schema: "ryntra.solana.bridge-routes",
    schemaVersion: "1.0.0",
    asset: "USDC",
    networks: [
      ...CCTP_EVM_CHAINS.map((chain) => cctpNetwork(chain, env)),
      {
        id: "robinhood-chain",
        label: ROBINHOOD_CHAIN_LABEL,
        state: "UNAVAILABLE",
        reason: "NO_NATIVE_USDC_ROUTE",
        provider: null,
        directions: [],
      },
    ],
    otherAssets: [
      { symbol: "ETH", reason: "CROSS_CHAIN_SWAP_NOT_A_BRIDGE" },
      { symbol: "SOL", reason: "CROSS_CHAIN_SWAP_NOT_A_BRIDGE" },
    ],
    observedAt: now.toISOString(),
  };
}

/** Whether a person may compose on this network right now. */
export function bridgeNetworkAvailable(matrix: BridgeRouteMatrix, id: BridgeNetworkId): boolean {
  return matrix.networks.some((network) => network.id === id && network.state === "AVAILABLE");
}
