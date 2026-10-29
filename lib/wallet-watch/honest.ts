/**
 * «Стеження за гаманцями» (SOL-R4) by the honest standard (DSC-2, `lib/core/pnl/honest.ts`): the wallet's trades read
 * from the chain, in SOL, with the network's fee of each transaction; what it holds valued at the price it would leave
 * at now — the pool's depth (half the token's liquidity, Jupiter's) against the sale, Ryntra's fee by fee policy v2
 * and the network's fee on the way out.
 *
 * A dollar leg is in SOL at SOL's price now (`approx`). A trade read before the standard has no fee on record: the
 * network's fee is estimated there (`feesEstimated`). Tokens another wallet paid for have no price: a part not known.
 *
 * Pure and client-safe.
 */

import { ESTIMATED_NETWORK_FEE_SOL, honestPnl, type ExitMark, type HonestPnl, type PnlLeg } from "../core/pnl/honest.ts";
import { ryntraFeeBps } from "./reality.ts";
import type { WalletTrade } from "./trades.ts";

export type WalletHonest = Readonly<{
  pnl: HonestPnl;
  /** A dollar leg was turned into SOL at SOL's price now. */
  approx: boolean;
  /** Some trades were read before fees were kept: their network fee is the standard's estimate. */
  feesEstimated: boolean;
}>;

/** What is known of a token now: its price and its liquidity, dollars (Jupiter). */
export type TokenMarket = Readonly<{ priceUsd: number | null; liquidityUsd: number | null }>;

export function walletHonest(input: Readonly<{
  trades: readonly WalletTrade[];
  solUsd: number | null;
  market: ReadonlyMap<string, TokenMarket>;
  /** What the wallet holds by mint; null — traded since the accounts were read. */
  held?: ReadonlyMap<string, number | null>;
  nowS: number;
}>): WalletHonest {
  const solUsd = input.solUsd && input.solUsd > 0 ? input.solUsd : null;
  let approx = false;
  let feesEstimated = false;
  const legs: PnlLeg[] = [...input.trades]
    .sort((a, b) => a.slot - b.slot)
    .map((trade) => {
      let value: number | null = null;
      if (trade.paidBy === null && trade.quote !== null && trade.quoteAmount !== null) {
        if (trade.quote === "SOL") value = trade.quoteAmount;
        else if (solUsd !== null) {
          value = trade.quoteAmount / solUsd;
          approx = true;
        }
      }
      if (trade.feeSol === undefined) feesEstimated = true;
      return {
        id: `${trade.signature}:${trade.mint}:${trade.side}`,
        asset: trade.mint,
        at: trade.at,
        side: trade.side,
        amount: Number(trade.tokensRaw) / 10 ** trade.decimals,
        value,
        fee: trade.feeSol ?? ESTIMATED_NETWORK_FEE_SOL,
      };
    });
  const marks = new Map<string, ExitMark>();
  if (solUsd !== null) {
    for (const mint of new Set(input.trades.map((trade) => trade.mint))) {
      const known = input.market.get(mint);
      if (!known) continue;
      const liquidity = known.liquidityUsd;
      marks.set(mint, {
        price: known.priceUsd !== null && known.priceUsd >= 0 ? known.priceUsd / solUsd : null,
        /* A constant-product pool holds half its liquidity on each side. */
        depth: liquidity !== null && liquidity > 0 ? liquidity / 2 / solUsd : null,
        feeShare: ryntraFeeBps(mint) / 10_000,
        feeFixed: ESTIMATED_NETWORK_FEE_SOL,
      });
    }
  }
  return { pnl: honestPnl({ unit: "SOL", nowS: input.nowS, legs, held: input.held, marks }), approx, feesEstimated };
}
