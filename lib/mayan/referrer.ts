/**
 * Where a Mayan referrer fee is actually paid, per method.
 *
 * This module exists because of a correction. The first pass assumed one Solana
 * address answers every route, which happens to be true for the two methods this
 * product uses and is **not** true in general — and an assumption that holds by
 * luck is one that breaks the first time the lane gains a method. Mayan pays on
 * a different chain, in a different asset, under different conditions, for each
 * of its four; a fee configured against the wrong one is quoted, shown, and
 * collected by nobody.
 *
 * The table below is Mayan's own, from `docs.mayan.finance/build/fees-earning`,
 * and every row states four separate things that are easy to blur together: the
 * chain the fee lands on, the asset it lands in, the rate the method will accept,
 * and the condition under which it is paid at all. Two rows earn nothing on some
 * routes even with a rate set, which is why "the rate was requested" is never the
 * same claim as "the fee was earned".
 *
 * ## What this product uses, and why one address is enough *here*
 *
 * - **Swift with a Solana source** — paid on the **source** chain, in the locked
 *   source asset. Solana, therefore, because the source is Solana.
 * - **Fast MCTP into Solana** — paid on the **destination** chain, in the
 *   stablecoin minted while bridging. Solana, therefore, because the destination
 *   is Solana.
 *
 * Both land on Solana for different reasons, and the reasons are recorded so that
 * a third method cannot inherit the conclusion without inheriting the argument.
 * `mayanReferrerRoute` answers per quote rather than per product.
 */

export type MayanReferrerChain = "SOURCE" | "DESTINATION" | "SOLANA_ALWAYS";

export type MayanReferrerRule = Readonly<{
  /** Which side of the swap the fee is paid on. */
  paidOn: MayanReferrerChain;
  /** What it is paid in, in Mayan's own words. */
  asset: string;
  /** The most this method will accept, in basis points. */
  maximumBps: number;
  /** The condition beyond completion, when there is one. */
  paidOnlyIf: string | null;
  /** `false` where the rate is set on chain rather than on the quote. */
  rateSetOnQuote: boolean;
}>;

export const MAYAN_REFERRER_RULES: Readonly<Record<string, MayanReferrerRule>> = {
  SWIFT: {
    paidOn: "SOURCE",
    asset: "the locked source asset",
    maximumBps: 200,
    paidOnlyIf: null,
    rateSetOnQuote: true,
  },
  MCTP: {
    paidOn: "DESTINATION",
    asset: "the stablecoin minted during bridging",
    /* 100 from a Solana origin, 50 from anywhere else. The lower of the two is
       taken as the rule, because a rate a method may refuse is a rate that
       silently earns nothing. */
    maximumBps: 50,
    paidOnlyIf: "the order includes a swap on the destination chain — a plain USDC-to-USDC transfer earns nothing",
    rateSetOnQuote: true,
  },
  FAST_MCTP: {
    paidOn: "DESTINATION",
    asset: "the stablecoin minted during bridging",
    maximumBps: 100,
    paidOnlyIf: null,
    rateSetOnQuote: true,
  },
  WH: {
    paidOn: "SOLANA_ALWAYS",
    asset: "the output token",
    maximumBps: 50,
    paidOnlyIf: "the transfer includes a swap — a plain bridge earns nothing",
    /* Wormhole Swap takes its rate from an on-chain setting against the Solana
       address, not from `referrerBps`. Sending a rate on the quote does nothing. */
    rateSetOnQuote: false,
  },
};

export type MayanQuoteShape = Readonly<{ type: string; fromChain: string; toChain: string; swiftVersion?: string }>;

export type MayanReferrerRoute =
  | Readonly<{ collectable: true; chain: string; asset: string; maximumBps: number; note: string | null }>
  | Readonly<{ collectable: false; reason: string }>;

/**
 * Which chain this exact quote would pay a referrer fee on, and in what.
 *
 * Answers `collectable: false` rather than guessing whenever the fee would land
 * somewhere this product has no configured address — because the failure mode is
 * silent, and a surface that knows in advance can say `NOT_APPLIED` before a
 * signature instead of a receipt discovering it afterwards.
 *
 * The SDK's own `getQuoteSuitableReferrerAddress` picks the key it will encode,
 * and it agrees with the table: `referrerAddresses.solana` for a Swift V2 order
 * out of Solana and for MCTP or Fast MCTP into Solana, `evm` otherwise, `null`
 * for Wormhole Swap and for Swift V1. Read from `@mayanfinance/swap-sdk` on
 * 2026-09-10 rather than assumed.
 */
export function mayanReferrerRoute(quote: MayanQuoteShape, configured: Readonly<{ solana: string | null }>): MayanReferrerRoute {
  const rule = MAYAN_REFERRER_RULES[quote.type];
  if (!rule) return { collectable: false, reason: `Mayan method ${quote.type} has no recorded referrer rule.` };
  if (!rule.rateSetOnQuote) {
    return { collectable: false, reason: `${quote.type} takes its referrer rate from an on-chain setting, not from the quote.` };
  }
  if (quote.type === "SWIFT" && quote.swiftVersion !== "V2") {
    return { collectable: false, reason: "Swift V1 pays no referrer fee through this path." };
  }
  const chain = rule.paidOn === "SOURCE" ? quote.fromChain : rule.paidOn === "DESTINATION" ? quote.toChain : "solana";
  if (chain !== "solana") {
    return { collectable: false, reason: `This ${quote.type} route pays its referrer fee on ${chain}, and only a Solana receiving address is configured.` };
  }
  if (!configured.solana) return { collectable: false, reason: "No Mayan referrer address is configured." };
  return { collectable: true, chain, asset: rule.asset, maximumBps: rule.maximumBps, note: rule.paidOnlyIf };
}
