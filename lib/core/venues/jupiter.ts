/**
 * Jupiter as a trade venue of the core — the first adapter on the pipeline.
 *
 * It carries both Jupiter lanes of fee policy v2 (`../fee-policy.ts`): Swap
 * API v2 `/order` with the referral fee and the one-shot managed `/execute`,
 * and `/build`, whose bytes this deployment assembles with Ryntra's fee paid
 * into its own fee wallet and sends once through its own RPC. Which lane, and
 * which fee, is decided per flow in `../solana-swap/fee-route.server.ts`; the
 * venue answers with the price and the built transaction at once, so `build`
 * hands back the bytes the quote already carries — nothing is fetched twice.
 *
 * A refusal is not a quote: `quote` throws `JupiterOrderRefusal` carrying the
 * venue's own answer untouched, and the pipeline step decides what the person
 * is told.
 */

import { askOnceMoreAfterRate } from "../../solana/jupiter-ask-again.ts";
import type { SolanaRpcHandle } from "../../solana/rpc.ts";
import { JUPITER_ORDER_RETRY_WAIT_MAX_MS } from "../../solana/jupiter-budget.ts";
import {
  executeJupiterOrder,
  fetchJupiterExecutableOrder,
  type JupiterExecutableOrder,
  type JupiterExecutableOrderFailure,
  type JupiterExecuteResult,
  type JupiterReferral,
  type JupiterSwapEndpoint,
} from "../../solana/quotes.ts";
import type { ServiceFeeConfig } from "../../swap/service-fee.ts";
import { findCapability, resolveFeeIdentity } from "../capabilities.ts";
import type { FeeFlow } from "../fee-policy.ts";
import { chooseExecutableOrder, type FeePolicyCarrier } from "../solana-swap/fee-route.server.ts";
import type { Attribution, FeeIdentity, Product, Quote, TradeIntent, TradeVenue, TradingAccount, UnsignedTx } from "../contracts.ts";

/** The venue refused to price or build; its answer is carried as it came. */
export class JupiterOrderRefusal extends Error {
  readonly failure: JupiterExecutableOrderFailure;

  constructor(failure: JupiterExecutableOrderFailure) {
    super(failure.reason);
    this.name = "JupiterOrderRefusal";
    this.failure = failure;
  }
}

export type JupiterQuote = Quote<JupiterExecutableOrder>;

export type JupiterSwapVenue = TradeVenue<JupiterExecutableOrder> &
  Attribution &
  Readonly<{
    /**
     * The venue's managed lane for bytes it built and the wallet signed
     * unchanged: one POST, never retried. An unknown answer is recovered by
     * reading the signature, never by asking again.
     */
    execute(signedTransactionBase64: string, requestId: string): Promise<JupiterExecuteResult>;
  }>;

/** The core's view of an order: the price, the fee, the review window. */
export function quoteFromJupiterOrder(intent: TradeIntent, order: JupiterExecutableOrder): JupiterQuote {
  return {
    venue: "jupiter",
    intent,
    inputRaw: order.inAmountRaw,
    quotedOutputRaw: order.outAmountRaw,
    minimumOutputRaw: order.minReceivedRaw,
    priceImpactPct: order.priceImpactPct,
    ryntraFeeBps: order.ryntraFee.basisPoints,
    requestId: order.requestId,
    reviewExpiresAt: order.reviewExpiresAt,
    native: order,
  };
}

export function createJupiterSwapVenue(args: Readonly<{
  /** The keyed production endpoint: a swap that will be signed never goes keyless. */
  endpoint: JupiterSwapEndpoint;
  /** Ryntra's fee identity on this venue, verified on chain; null asks for no fee. */
  referral: JupiterReferral | null;
  /** The configured addresses, for `identity`. */
  config: ServiceFeeConfig;
  /**
   * Fee policy v2's lane choice for the person's own order: who carries the
   * request and the RPC that sizes and checks `/build`'s bytes. Absent, the
   * venue asks `/order` with `referral` as production did before the policy.
   */
  lanes?: Readonly<{ carrier: FeePolicyCarrier; handle: SolanaRpcHandle; onChoice?: (choice: Readonly<{ flow: FeeFlow; lane: "BUILD" | "ORDER" }>) => void }>;
}>): JupiterSwapVenue {
  const { endpoint, referral, config, lanes } = args;
  return {
    venue: "jupiter",
    async quote(intent: TradeIntent): Promise<JupiterQuote> {
      if (lanes) {
        const choice = await chooseExecutableOrder({
          inputMint: intent.inputAsset,
          outputMint: intent.outputAsset,
          amountRaw: intent.amountRaw,
          taker: intent.account.address,
          ...(intent.slippageBps !== undefined ? { slippageBps: intent.slippageBps } : {}),
          carrier: lanes.carrier,
          endpoint,
          handle: lanes.handle,
          config,
        });
        if (!choice.ok) throw new JupiterOrderRefusal(choice.failure);
        lanes.onChoice?.({ flow: choice.flow, lane: choice.lane });
        return quoteFromJupiterOrder(intent, choice.order);
      }
      const result = await askOnceMoreAfterRate(
        () =>
          fetchJupiterExecutableOrder(
            {
              inputMint: intent.inputAsset,
              outputMint: intent.outputAsset,
              amountRaw: intent.amountRaw,
              taker: intent.account.address,
              referral,
              ...(intent.slippageBps !== undefined ? { slippageBps: intent.slippageBps } : {}),
            },
            endpoint,
          ),
        { maxWaitMs: JUPITER_ORDER_RETRY_WAIT_MAX_MS },
      );
      if (!result.ok) throw new JupiterOrderRefusal(result);
      return quoteFromJupiterOrder(intent, result.order);
    },
    async build(quote: JupiterQuote, account: TradingAccount): Promise<UnsignedTx> {
      if (account.address !== quote.native.taker) throw new Error("The order was built for another wallet.");
      return { network: "solana", wireBase64: quote.native.transactionBase64, validUntil: quote.native.lastValidBlockHeight };
    },
    execute(signedTransactionBase64: string, requestId: string): Promise<JupiterExecuteResult> {
      /* `/build`'s bytes were assembled here and are not `/order`'s: `/execute` would refuse them, and they go out through the deployment's own RPC. */
      if (requestId.startsWith("build:")) throw new Error("A /build order is sent through the deployment's own RPC, never through /execute.");
      return executeJupiterOrder({ signedTransactionBase64, requestId }, endpoint);
    },
    identity(product: Product): FeeIdentity {
      const row = findCapability("solana", "jupiter", "swap");
      const identity = row ? resolveFeeIdentity(row, product, config) : null;
      return identity ?? { product, kind: "JUPITER_REFERRAL_ACCOUNT", address: null };
    },
  };
}
