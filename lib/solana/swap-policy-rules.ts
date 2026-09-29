/**
 * The swap policy's vocabulary, with nothing else in it.
 *
 * The browser repeats the pre-sign predicate before opening a wallet, so it
 * needs the rule names — and a client module that reaches a Node built-in
 * through a value import breaks the bundle, which is exactly what importing
 * them from `swap-policy.ts` would do: that module hashes its policy and
 * intent with `node:crypto`. The names live here, the evaluation lives there,
 * and both sides read one list.
 */

export const SWAP_POLICY_ID = "ryntra-solana-swap-v1";

/**
 * Every rule a swap is judged by, in the order a person checks them: what the
 * transaction is, who it pays, what the bytes do, and what it costs.
 */
export const SWAP_POLICY_RULES = [
  "NETWORK_MAINNET",
  "PAIR_DISTINCT",
  "OUTPUT_ASSET_REVIEWED",
  "PAYOUT_TO_SIGNER",
  "FEE_PAYER_IS_SIGNER",
  "BYTES_INSPECTED",
  "SIMULATION_OK",
  "OWNER_EFFECTS_PROVEN",
  "SLIPPAGE_BOUNDED",
  "PRICE_IMPACT_DISCLOSED",
  "VALUE_DISCLOSED",
  "REVIEW_FRESH",
] as const;
export type SwapPolicyRule = (typeof SWAP_POLICY_RULES)[number];

export const SWAP_POLICY_OUTCOMES = ["PASS", "REVIEW", "BLOCK"] as const;
export const SWAP_POLICY_DECISIONS = ["ALLOW", "REVIEW", "BLOCK"] as const;
export type SwapPolicyDecision = (typeof SWAP_POLICY_DECISIONS)[number];

/**
 * The only numeric limits the product keeps, and what each one is for.
 *
 * Slippage is the one number that can silently cost the signer half the
 * trade: `minReceivedRaw` is derived from it, and the effect firewall proves
 * only that the floor is met. A floor set that low is not a trade any more,
 * so it is the single economic BLOCK. Price impact is disclosed and reviewed,
 * never blocked — a large trade into a thin pool is the signer's call to
 * make, and the wallet shows them the amounts before they make it.
 */
export const SWAP_POLICY_LIMITS = {
  slippageReviewBps: 300,
  slippageBlockBps: 5_000,
  priceImpactReviewPct: 1,
} as const;
