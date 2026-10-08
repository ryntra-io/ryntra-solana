/**
 * Meteora registry definitions for Ryntra Launch's trades.
 *
 * The adapter names Meteora's Dynamic Bonding Curve swap on a Ryntra launch's
 * curve and the DAMM v2 swap in the pool it graduated into, so a launch trade's
 * Outcome Receipt can pin the exact registry entries it settled under.
 * Registering the adapter grants nothing: the person's wallet signs the bytes
 * the launch's trade route built, and the route sends them once. A verifier
 * that has never heard of Meteora still reads the closed class — this action
 * moves value.
 */

import { SOLANA_CAIP2 } from "./solana-token-2022.ts";

export const METEORA_LAUNCH_ADAPTER_REF = "adapter:meteora-launch@1";
/** A buy or a sale of a launch, built by Ryntra, wallet-signed, sent once through Ryntra's own RPC. */
export const METEORA_LAUNCH_TRADE_ACTION_REF = "action:meteora-launch/trade-own-rpc-submit@1";

export const METEORA_LAUNCH_DEFINITIONS = [
  {
    kind: "ADAPTER",
    ref: METEORA_LAUNCH_ADAPTER_REF,
    displayName: "Meteora Dynamic Bonding Curve and DAMM v2",
    capability: "READ_ONLY",
    chainRefs: [SOLANA_CAIP2.mainnet, SOLANA_CAIP2.devnet],
    status: "ALLOWED",
  },
  {
    kind: "ACTION_SCHEMA",
    ref: METEORA_LAUNCH_TRADE_ACTION_REF,
    displayName: "Launch trade, wallet-signed, own-RPC submit",
    adapterRef: METEORA_LAUNCH_ADAPTER_REF,
    canonicalClass: "VALUE_TRANSFER",
    budget: "OPTIONAL",
    status: "ALLOWED",
  },
] as const;
