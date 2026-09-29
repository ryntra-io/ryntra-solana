/**
 * The four x402 payment adapters, entering Agent Control the way the registry
 * promised a provider would: one module plus registry definitions, with zero
 * edits to `contracts.ts` or `registry.ts`.
 *
 * This file owns the registry **definitions** and nothing else. What each
 * implementation actually declares — facilitators, networks, per-asset methods,
 * wire values, trust ceiling, limitations — lives in
 * `../payments/implementations.ts`, and the one decision that reads all of it
 * lives in `../payments/x402-engine.ts`.
 *
 * Two properties are worth stating because they are easy to get wrong here.
 *
 * **Every adapter is `READ_ONLY`, and that is not a placeholder.** Ryntra
 * observes a payment somebody else made and reconciles it. Nothing in this
 * repository signs an authorization, holds a facilitator credential, or reaches
 * any of these four hosts. The day one of them observes-and-reconciles for
 * real, the entry says so and the artifact records which one.
 *
 * **Four adapters, not one `B402` adapter with a variant field.** Binance B402
 * and Vistara Labs B402 are unrelated systems that happen to share a name on
 * the same chain. A shared adapter with a discriminator would put the two
 * behind one content hash and one ref, which is exactly the collapse the
 * separate axes exist to prevent.
 */

export const BINANCE_B402_ADAPTER_REF = "adapter:binance-b402@1";
export const VISTARA_B402_ADAPTER_REF = "adapter:vistara-b402@1";
export const COINBASE_X402_ADAPTER_REF = "adapter:coinbase-x402@1";
export const SELF_HOSTED_X402_ADAPTER_REF = "adapter:self-hosted-x402@1";

export const BINANCE_B402_PAY_ACTION_REF = "action:binance-b402/pay-service-request@1";
export const VISTARA_B402_PAY_ACTION_REF = "action:vistara-b402/pay-service-request@1";
export const COINBASE_X402_PAY_ACTION_REF = "action:coinbase-x402/pay-service-request@1";
export const SELF_HOSTED_X402_PAY_ACTION_REF = "action:self-hosted-x402/pay-service-request@1";

const BSC_MAINNET = "eip155:56";
const BSC_TESTNET = "eip155:97";

/**
 * Registry definitions, as plain literals. The registry's own schema validates
 * them at build time; importing the registry here would create the central
 * coupling this module exists to avoid.
 *
 * A paid HTTP request moves value from the buyer's address to the seller's, so
 * the canonical class is `VALUE_TRANSFER` and the budget rule is `REQUIRED` — a
 * verifier that has never heard of x402 still reads that this action moves
 * value and must be paid for out of a declared budget.
 */
export const X402_PAYMENT_DEFINITIONS = [
  {
    kind: "ADAPTER",
    ref: BINANCE_B402_ADAPTER_REF,
    displayName: "Binance B402",
    capability: "READ_ONLY",
    chainRefs: [BSC_MAINNET, BSC_TESTNET],
    status: "ALLOWED",
  },
  {
    kind: "ACTION_SCHEMA",
    ref: BINANCE_B402_PAY_ACTION_REF,
    displayName: "Pay service request",
    adapterRef: BINANCE_B402_ADAPTER_REF,
    canonicalClass: "VALUE_TRANSFER",
    budget: "REQUIRED",
    status: "ALLOWED",
  },
  {
    kind: "ADAPTER",
    ref: VISTARA_B402_ADAPTER_REF,
    displayName: "Vistara Labs B402",
    capability: "READ_ONLY",
    chainRefs: [BSC_MAINNET, BSC_TESTNET],
    status: "ALLOWED",
  },
  {
    kind: "ACTION_SCHEMA",
    ref: VISTARA_B402_PAY_ACTION_REF,
    displayName: "Pay service request",
    adapterRef: VISTARA_B402_ADAPTER_REF,
    canonicalClass: "VALUE_TRANSFER",
    budget: "REQUIRED",
    status: "ALLOWED",
  },
  {
    kind: "ADAPTER",
    ref: COINBASE_X402_ADAPTER_REF,
    displayName: "Coinbase x402",
    capability: "READ_ONLY",
    chainRefs: [
      "eip155:8453",
      "eip155:84532",
      "eip155:43114",
      "eip155:43113",
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    ],
    status: "ALLOWED",
  },
  {
    kind: "ACTION_SCHEMA",
    ref: COINBASE_X402_PAY_ACTION_REF,
    displayName: "Pay service request",
    adapterRef: COINBASE_X402_ADAPTER_REF,
    canonicalClass: "VALUE_TRANSFER",
    budget: "REQUIRED",
    status: "ALLOWED",
  },
  {
    /* No chain references, because a self-hosted facilitator has no deployment
       until its operator declares one. An empty list is the honest value and it
       makes every route through this adapter refuse at the network. */
    kind: "ADAPTER",
    ref: SELF_HOSTED_X402_ADAPTER_REF,
    displayName: "Self-hosted x402",
    capability: "READ_ONLY",
    chainRefs: [],
    status: "ALLOWED",
  },
  {
    kind: "ACTION_SCHEMA",
    ref: SELF_HOSTED_X402_PAY_ACTION_REF,
    displayName: "Pay service request",
    adapterRef: SELF_HOSTED_X402_ADAPTER_REF,
    canonicalClass: "VALUE_TRANSFER",
    budget: "REQUIRED",
    status: "ALLOWED",
  },
] as const;
