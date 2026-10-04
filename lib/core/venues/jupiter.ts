/**
 * Jupiter as a trade venue of the core — the first adapter on the pipeline.
 *
 * It wraps the swap lane that runs on production (`lib/solana/quotes.ts`) and
 * changes none of it: the same taker order from Swap API v2 `/order`, the same
 * Ryntra fee through the referral account, the same single ask more after a
 * refusal for rate, the same one-shot managed `/execute`. Jupiter's `/order`
 * answers with the price and the built transaction at once, so `build` hands
 * back the bytes the quote already carries — nothing is fetched twice.
 *
 * A refusal is not a quote: `quote` throws `JupiterOrderRefusal` carrying the
 * venue's own answer untouched, and the pipeline step decides what the person
 * is told.
 */

import { askOnceMoreAfterRate } from "../../solana/jupiter-ask-again.ts";
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
}>): JupiterSwapVenue {
  const { endpoint, referral, config } = args;
  return {
    venue: "jupiter",
    async quote(intent: TradeIntent): Promise<JupiterQuote> {
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
      return executeJupiterOrder({ signedTransactionBase64, requestId }, endpoint);
    },
    identity(product: Product): FeeIdentity {
      const row = findCapability("solana", "jupiter", "swap");
      const identity = row ? resolveFeeIdentity(row, product, config) : null;
      return identity ?? { product, kind: "JUPITER_REFERRAL_ACCOUNT", address: null };
    },
  };
}
