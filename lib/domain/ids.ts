/* Chain / venue / route separation (STEP 3). A CHAIN is settlement infrastructure
   (Robinhood Chain is NOT an exchange); a VENUE is an operated trading facility (Arcus,
   Hyperliquid); a ROUTE is one concrete way to execute one instrument — a (chain, executor,
   market-structure) triple. Two routes can quote the same instrument on the same chain
   (Arcus RFQ vs Uniswap AMM); today only Arcus executes in Ryntra — if/when a second route
   becomes executable, route selection is an explicit user action, never automatic. */

import type { MarketStructure, ExecutionMode } from "./capability.ts";
import type { VenueId } from "../venues/types.ts";

export type { VenueId };

export type ChainId = "robinhood-chain" | "hypercore";

export type ChainMeta = {
  id: ChainId;
  label: string;
  /** EVM chain id when the chain ITSELF is an EVM chain, else null. HyperCore (where
      Hyperliquid perps/orderbook settle) is NOT an EVM chain and must never carry a fake
      numeric id; the ASSOCIATED HyperEVM (chain id 999) is a SEPARATE environment, modeled
      only if/when actual EVM interaction ships (see hyperliquid docs: for-developers/hyperevm). */
  evmChainId: number | null;
  family: "evm" | "hypercore";
};

export const CHAINS: Record<ChainId, ChainMeta> = {
  "robinhood-chain": { id: "robinhood-chain", label: "Robinhood Chain", evmChainId: 4663, family: "evm" },
  hypercore: { id: "hypercore", label: "HyperCore (Hyperliquid)", evmChainId: null, family: "hypercore" },
};

/** Who actually executes on a route: an operated venue, or a permissionless on-chain protocol. */
export type RouteExecutor =
  | { kind: "venue"; venue: VenueId }
  | { kind: "onchain-protocol"; protocol: "uniswap" };

export type RouteId =
  | "arcus-spot-rfq"
  | "arcus-perps-clob"
  | "uniswap-rhchain-amm"
  | "hyperliquid-perps-clob";

export type RouteMeta = {
  id: RouteId;
  label: string;
  /** Compact display name for dense surfaces (order ticket rows). */
  shortLabel: string;
  chain: ChainId;
  executor: RouteExecutor;
  structure: MarketStructure;
  executionMode: ExecutionMode;
};

export const ROUTES: Record<RouteId, RouteMeta> = {
  "arcus-spot-rfq": {
    id: "arcus-spot-rfq",
    label: "Arcus Spot (RFQ)",
    shortLabel: "Arcus RFQ",
    chain: "robinhood-chain",
    executor: { kind: "venue", venue: "arcus" },
    structure: "rfq",
    executionMode: "wallet-signed",
  },
  "arcus-perps-clob": {
    id: "arcus-perps-clob",
    label: "Arcus Perps (CLOB)",
    shortLabel: "Arcus Perps",
    chain: "robinhood-chain",
    executor: { kind: "venue", venue: "arcus" },
    structure: "clob",
    executionMode: "wallet-signed",
  },
  "uniswap-rhchain-amm": {
    id: "uniswap-rhchain-amm",
    label: "Uniswap on Robinhood Chain (AMM)",
    shortLabel: "Uniswap v3",
    chain: "robinhood-chain",
    executor: { kind: "onchain-protocol", protocol: "uniswap" },
    structure: "amm",
    executionMode: "wallet-signed",
  },
  "hyperliquid-perps-clob": {
    id: "hyperliquid-perps-clob",
    label: "Hyperliquid Perps (CLOB)",
    shortLabel: "Hyperliquid",
    chain: "hypercore",
    executor: { kind: "venue", venue: "hyperliquid" },
    structure: "clob",
    executionMode: "wallet-signed",
  },
};

export function routeById(id: RouteId): RouteMeta {
  return ROUTES[id];
}

export function routesOnChain(chain: ChainId): RouteMeta[] {
  return Object.values(ROUTES).filter((r) => r.chain === chain);
}
