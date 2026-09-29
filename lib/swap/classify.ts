/**
 * Which kind of action a FROM/TO pair is, and which engine carries it.
 *
 * The person never chooses between Swap, Bridge and Cross-chain; this function
 * does, from the two sides alone (Unified Swap V1, `RYN-SOL-MONEY-FLOWS-001F`):
 *
 * - same network, different asset → `SWAP`, the accepted Jupiter path;
 * - different network, same economic asset → `TRANSFER`, the accepted Circle
 *   CCTP V2 path (USDC only, one side Solana);
 * - different network, different asset → `CROSS_SWAP`, any token against any
 *   other, through the provider that carries those two chains.
 *
 * Everything else is `UNAVAILABLE` with a reason the card can turn into one
 * sentence. Pure, total, client-safe: no clock, no network, no env.
 *
 * ## The engine is the pair's, and it is never a fallback
 *
 * Until Robinhood Chain there was one cross-asset provider, so `CROSS_SWAP`
 * and "Mayan" were the same statement and the code could say either. They are
 * not the same statement any more: Mayan cannot reach chain 4663, and a pair
 * that ends there is carried by Relay. `crossSwapProviderFor` answers which
 * rail reaches which chains, once, and nothing downstream may swap rails after
 * it — the two have different custody shapes and different failure modes, so a
 * swap that changed rails between the quote and the signature would not be the
 * swap that was reviewed.
 *
 * ## The product rule, in the Owner's words (2026-09-09)
 *
 * > **Supported assets between supported networks, where a real executable
 * > route exists and it passes our checks.**
 *
 * That sentence is the one to quote, and it is deliberately not "any token to
 * any token" — which is both wider than the truth and a promise this product
 * cannot keep. Three things narrow it, each answered somewhere different and
 * none of them by a written list of pairs:
 *
 * 1. **Supported networks** — the four in `SWAP_NETWORKS`, and no others.
 * 2. **Supported assets** — an asset the network's router will actually take.
 *    Robinhood Chain is the case that makes this real: its index lists the
 *    Stock Tokens and its router refuses every one of them, so they are not
 *    supported there however well known their names are
 *    (`NETWORK_ROUTABLE_ASSETS`).
 * 3. **A real executable route that passes our checks** — answered by a live
 *    quote and by the price-impact policy, not here. A pair with no route
 *    today is an honest `Unavailable`; a price nobody should accept is a
 *    price, not a classification.
 *
 * ## What "not available" means since 2026-09-09
 *
 * It used to mean "this pair is not one of the ten written down". It now means
 * one of four specific things, and the reason says which: the asset is not an
 * asset (`UNKNOWN_ASSET`), the network will not carry it
 * (`ASSET_NOT_ROUTABLE_ON_NETWORK`), the two sides are the same thing in the
 * same place (`SAME_ASSET_SAME_NETWORK`), or this product has no same-chain
 * engine off Solana (`EVM_SAME_NETWORK`). Every one is a fact about the
 * request rather than a policy about which pairs somebody wrote down.
 */

import {
  assetRoutableOnNetwork,
  crossSwapPairFor,
  resolveSwapAsset,
  type CrossSwapProvider,
  type CrossSwapTuple,
  type ResolvedSwapAsset,
  type SwapSideRef,
} from "./catalog.ts";

export type SwapRouteKind = "SWAP" | "TRANSFER" | "CROSS_SWAP";
export type SwapEngine = "JUPITER" | "CCTP" | CrossSwapProvider;

export type CctpDirection = "SOLANA_TO_BASE" | "BASE_TO_SOLANA" | "SOLANA_TO_ETHEREUM" | "ETHEREUM_TO_SOLANA";

export type SwapRouteUnavailableReason =
  | "UNKNOWN_ASSET"
  | "SAME_ASSET_SAME_NETWORK"
  /**
   * Two Solana assets: a real, routable pair — and Swap's, not Bridge's.
   *
   * Unavailable *here* is the honest answer and a link to Swap is the useful
   * one. What it must never become is Bridge quietly carrying it: Relay's own
   * Solana same-chain route is Jupiter with a 6 bps toll in front of it, so
   * absorbing this case would charge somebody more for the same liquidity while
   * telling them nothing.
   */
  | "SAME_NETWORK_IS_SWAP"
  | "EVM_SAME_NETWORK"
  | "TRANSFER_WITHOUT_SOLANA"
  | "TRANSFER_ASSET_NOT_USDC"
  /** The network will not carry this asset at all — see `NETWORK_ROUTABLE_ASSETS`. */
  | "ASSET_NOT_ROUTABLE_ON_NETWORK"
  | "PAIR_NOT_SUPPORTED";

export type SwapRouteClassification =
  | Readonly<{ ok: true; kind: "SWAP"; engine: "JUPITER"; from: ResolvedSwapAsset; to: ResolvedSwapAsset }>
  | Readonly<{ ok: true; kind: "TRANSFER"; engine: "CCTP"; direction: CctpDirection; from: ResolvedSwapAsset; to: ResolvedSwapAsset }>
  | Readonly<{ ok: true; kind: "CROSS_SWAP"; engine: CrossSwapProvider; tuple: CrossSwapTuple; from: ResolvedSwapAsset; to: ResolvedSwapAsset }>
  | Readonly<{ ok: false; reason: SwapRouteUnavailableReason; from: ResolvedSwapAsset | null; to: ResolvedSwapAsset | null }>;

/**
 * Which CCTP lane a USDC pair would use — **rollback only, and not called here.**
 *
 * Circle CCTP left default routing on 2026-09-10 with the Owner's instruction to
 * keep the code rather than delete it. This is the piece that decides the lane,
 * exported so the classifier can reach for it again in one edit, and kept beside
 * the classification it used to produce so a restore is not archaeology.
 */
export function cctpDirection(from: ResolvedSwapAsset, to: ResolvedSwapAsset): CctpDirection | null {
  if (from.network === "solana" && to.network === "base") return "SOLANA_TO_BASE";
  if (from.network === "base" && to.network === "solana") return "BASE_TO_SOLANA";
  if (from.network === "solana" && to.network === "ethereum") return "SOLANA_TO_ETHEREUM";
  if (from.network === "ethereum" && to.network === "solana") return "ETHEREUM_TO_SOLANA";
  return null;
}

export function classifySwapRoute(fromRef: SwapSideRef, toRef: SwapSideRef): SwapRouteClassification {
  const from = resolveSwapAsset(fromRef);
  const to = resolveSwapAsset(toRef);
  if (!from || !to) return { ok: false, reason: "UNKNOWN_ASSET", from, to };

  /* An asset its own network will not carry is refused here, before any quote.
     Robinhood Chain's Stock Tokens are the case this exists for: the token
     index knows TSLA and NVDA by name and the router answers
     `UNSUPPORTED_CURRENCY` to every one of them, so offering them would
     promise something no signature could produce. This is a different question
     from "is there a route today", which only a live quote can answer. */
  for (const side of [from, to]) {
    if (!assetRoutableOnNetwork(side.network, side.catalog ? side.catalog.code : side.asset)) {
      return { ok: false, reason: "ASSET_NOT_ROUTABLE_ON_NETWORK", from, to };
    }
  }

  if (from.network === to.network) {
    if (from.economicAsset === to.economicAsset) return { ok: false, reason: "SAME_ASSET_SAME_NETWORK", from, to };
    /* One network on both sides is not this page's work. Solana belongs to Swap
       and its Jupiter path; anything else has no same-network surface in this
       product. Refused with the reason that says which, so Bridge can offer the
       way to Swap instead of a dead end — and, crucially, so it can never carry
       a Solana pair itself. That is the whole point of the split: a person who
       came to swap must not have a cross-chain operation started for them. */
    return { ok: false, reason: from.network === "solana" ? "SAME_NETWORK_IS_SWAP" : "EVM_SAME_NETWORK", from, to };
  }

  /* Every cross-network pair is one question — can Relay fill it — and the live
     quote is what answers it. The same asset on two chains is not a special case
     any more: Relay bridges USDC to USDC as readily as it swaps ETH to SOL, and
     routing the matching-name case through Circle CCTP instead is the second
     rail this split exists to remove. `crossSwapPairFor` returns null only for
     the same asset on the same network, which cannot reach here. */
  const pair = crossSwapPairFor(from, to);
  if (!pair) return { ok: false, reason: "PAIR_NOT_SUPPORTED", from, to };
  return { ok: true, kind: "CROSS_SWAP", engine: pair.provider, tuple: pair, from, to };
}
