/**
 * Jupiter Swap registry definitions.
 *
 * The adapter names the Jupiter Swap API V2 order→execute surface so that a
 * Swap Outcome Receipt can pin the exact registry entries it settled under.
 * Registering the adapter grants nothing: execution stays behind the owner
 * canary policy, the founder's wallet signature and the durable submit-once
 * boundary. A verifier that has never heard of Jupiter still reads the closed
 * class — this action moves value.
 */

import { SOLANA_CAIP2 } from "./solana-token-2022.ts";

export const JUPITER_SWAP_ADAPTER_REF = "adapter:jupiter-swap@1";
export const JUPITER_SWAP_ACTION_REF = "action:jupiter-swap/order-execute@1";
export const JUPITER_SWAP_ADOPTED_RPC_ACTION_REF = "action:jupiter-swap/order-own-rpc-submit@1";
export const JUPITER_SWAP_UNKNOWN_SUBMISSION_ACTION_REF = "action:jupiter-swap/order-submission-unresolved@1";

export const JUPITER_SWAP_DEFINITIONS = [
  {
    kind: "ADAPTER",
    ref: JUPITER_SWAP_ADAPTER_REF,
    displayName: "Jupiter Swap API V2",
    capability: "READ_ONLY",
    chainRefs: [SOLANA_CAIP2.mainnet],
    status: "ALLOWED",
  },
  {
    kind: "ACTION_SCHEMA",
    ref: JUPITER_SWAP_ACTION_REF,
    displayName: "Jupiter order + execute swap",
    adapterRef: JUPITER_SWAP_ADAPTER_REF,
    canonicalClass: "VALUE_TRANSFER",
    budget: "OPTIONAL",
    status: "ALLOWED",
  },
  {
    kind: "ACTION_SCHEMA",
    ref: JUPITER_SWAP_ADOPTED_RPC_ACTION_REF,
    displayName: "Jupiter order + wallet-signed own-RPC submit",
    adapterRef: JUPITER_SWAP_ADAPTER_REF,
    canonicalClass: "VALUE_TRANSFER",
    budget: "OPTIONAL",
    status: "ALLOWED",
  },
  {
    kind: "ACTION_SCHEMA",
    ref: JUPITER_SWAP_UNKNOWN_SUBMISSION_ACTION_REF,
    displayName: "Jupiter order + unresolved historical submit lane",
    adapterRef: JUPITER_SWAP_ADAPTER_REF,
    canonicalClass: "VALUE_TRANSFER",
    budget: "OPTIONAL",
    status: "ALLOWED",
  },
] as const;
