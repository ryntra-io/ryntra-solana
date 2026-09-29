/**
 * The one controlled operation the cross-swap lane may perform under `CANARY`.
 *
 * Owner instruction, 2026-09-09. Proving a new rail needs exactly one real
 * signed transaction, and the only way to build one used to be setting the
 * route `OPEN` — opening it for everyone, to any amount, in order to move five
 * dollars once. `CANARY` exists so that is no longer the trade.
 *
 * Everything below is **pinned by the owner and compared literally**. Not "at
 * most", not "of this kind": these exact values. Any deviation is refused with
 * the field that differed, and the refusal is the same one `PAUSED` gives —
 * a controlled operation that quietly accepted a near-miss would be a lane
 * that is open, described as a lane that is closed.
 *
 * ## The two wallets are not here, on purpose
 *
 * The source and destination addresses are **runtime input**, read from the
 * environment at request time and compared character for character. They are
 * deliberately not constants in this file and are not written into any
 * document as canonical owner wallets: a personal address committed to a
 * repository is a fact about a person that outlives the reason it was needed.
 * A canary with no addresses configured is refused, never defaulted.
 */

import type { SwapNetwork } from "./catalog.ts";

export const CROSS_SWAP_CANARY_SOURCE_ENV = "RYNTRA_SOLANA_CROSS_SWAP_CANARY_SOURCE";
export const CROSS_SWAP_CANARY_DESTINATION_ENV = "RYNTRA_SOLANA_CROSS_SWAP_CANARY_DESTINATION";

/**
 * The pinned operation. Owner-set 2026-09-09; changing any line is an owner
 * decision, not a refactor.
 */
export const CROSS_SWAP_CANARY = {
  from: { network: "solana" as SwapNetwork, asset: "SOL", native: true },
  /** Exactly this, in lamports. Not a ceiling. */
  amountRaw: "50000000",
  to: {
    network: "robinhood" as SwapNetwork,
    chainId: 4663,
    asset: "USDG",
    contract: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  },
  provider: "RELAY" as const,
  /** The most slippage the operation may state. Lower is fine; higher is not. */
  maxSlippageBps: 50,
  /** This product takes nothing on this lane, and holds no key with which to. */
  maxAppFeeUsd: 0,
} as const;

export type CrossSwapCanaryRefusal =
  | "CANARY_WALLETS_NOT_CONFIGURED"
  | "CANARY_FROM_NETWORK"
  | "CANARY_FROM_ASSET"
  | "CANARY_AMOUNT"
  | "CANARY_TO_NETWORK"
  | "CANARY_TO_ASSET"
  | "CANARY_PROVIDER"
  | "CANARY_SLIPPAGE"
  | "CANARY_APP_FEE"
  | "CANARY_SOURCE_WALLET"
  | "CANARY_DESTINATION_WALLET";

export type CrossSwapCanaryAdmission =
  | Readonly<{ ok: true; sourceWallet: string; destinationWallet: string }>
  | Readonly<{ ok: false; code: CrossSwapCanaryRefusal; reason: string }>;

/** Case-insensitive for an EVM address, exact for a base58 one. */
function sameAddress(network: SwapNetwork, a: string, b: string): boolean {
  return network === "solana" ? a === b : a.toLowerCase() === b.toLowerCase();
}

/**
 * Whether a request is *the* controlled operation.
 *
 * Every field is checked and the first difference is named. Deliberately not a
 * boolean: an operator reading a refused canary needs to know which line did
 * not match, and a person seeing "not available" deserves better than a shrug.
 */
export function admitCrossSwapCanary(
  request: Readonly<{
    fromNetwork: string;
    fromAsset: string;
    amountRaw: string;
    toNetwork: string;
    toAsset: string;
    provider: string;
    slippageBps: number;
    appFeeUsd: number | null;
    sourceWallet: string;
    destinationWallet: string;
  }>,
  env: Record<string, string | undefined> = process.env,
): CrossSwapCanaryAdmission {
  const source = env[CROSS_SWAP_CANARY_SOURCE_ENV]?.trim();
  const destination = env[CROSS_SWAP_CANARY_DESTINATION_ENV]?.trim();
  if (!source || !destination) {
    return {
      ok: false,
      code: "CANARY_WALLETS_NOT_CONFIGURED",
      reason: "The controlled operation has no wallets configured, so there is nothing to compare against.",
    };
  }

  const c = CROSS_SWAP_CANARY;
  if (request.fromNetwork !== c.from.network) return { ok: false, code: "CANARY_FROM_NETWORK", reason: `The controlled operation starts on ${c.from.network}.` };
  /* The source asset may be named by code or by the wrapped-SOL mint; both are
     native SOL and the classifier has already resolved them to the same thing.
     Anything else is a different asset. */
  if (request.fromAsset !== c.from.asset) return { ok: false, code: "CANARY_FROM_ASSET", reason: `The controlled operation sends ${c.from.asset}.` };
  if (request.amountRaw !== c.amountRaw) return { ok: false, code: "CANARY_AMOUNT", reason: `The controlled operation is exactly ${c.amountRaw} lamports.` };
  if (request.toNetwork !== c.to.network) return { ok: false, code: "CANARY_TO_NETWORK", reason: `The controlled operation ends on ${c.to.network}.` };
  /* The destination may be named by catalog code or by contract; both must
     resolve to the pinned USDG contract and nothing else on that chain. */
  const toAsset = request.toAsset.trim();
  const toMatches = toAsset === c.to.asset || sameAddress(c.to.network, toAsset, c.to.contract);
  if (!toMatches) return { ok: false, code: "CANARY_TO_ASSET", reason: `The controlled operation receives ${c.to.asset} at ${c.to.contract}.` };
  if (request.provider !== c.provider) return { ok: false, code: "CANARY_PROVIDER", reason: `The controlled operation is carried by ${c.provider}.` };
  if (!Number.isFinite(request.slippageBps) || request.slippageBps > c.maxSlippageBps) {
    return { ok: false, code: "CANARY_SLIPPAGE", reason: `The controlled operation allows at most ${c.maxSlippageBps} bps of slippage.` };
  }
  /* Null is not zero. A provider that did not state an app fee has not stated
     that there is none, and this operation is defined by there being none. */
  if (request.appFeeUsd === null || request.appFeeUsd > c.maxAppFeeUsd) {
    return { ok: false, code: "CANARY_APP_FEE", reason: "The controlled operation carries no application fee." };
  }
  if (!sameAddress(c.from.network, request.sourceWallet, source)) {
    return { ok: false, code: "CANARY_SOURCE_WALLET", reason: "That is not the wallet the controlled operation signs from." };
  }
  if (!sameAddress(c.to.network, request.destinationWallet, destination)) {
    return { ok: false, code: "CANARY_DESTINATION_WALLET", reason: "That is not the wallet the controlled operation pays." };
  }
  return { ok: true, sourceWallet: source, destinationWallet: destination };
}
