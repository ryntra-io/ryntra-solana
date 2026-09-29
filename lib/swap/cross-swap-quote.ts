/**
 * The one shape every cross-chain swap surface speaks, whoever carries it.
 *
 * This type and `crossSwapQuoteMaterialChange` were born inside
 * `lib/mayan/price-api.ts`, where they were correct for exactly as long as
 * there was one provider. `RYN-SOL-MONEY-FLOWS-001H` added a second — Relay,
 * for Robinhood Chain, which Mayan cannot reach — and a shared shape that
 * lives inside one of the two providers is a shape the other one has to import
 * from its competitor. So it moved here, to the product's own vocabulary,
 * beside the catalog that names the networks and the classifier that picks the
 * engine. `price-api.ts` re-exports it, so nothing that already imported it
 * from there had to change.
 *
 * Amounts are raw integers as strings; USD figures are the provider's own
 * display aggregates and are labelled as such wherever they are shown.
 */

import type { CrossSwapProvider, CrossSwapRouteMechanism, CrossSwapTuple, SwapNetwork } from "./catalog.ts";
import type { RyntraServiceFee } from "./service-fee.ts";

export type CrossSwapQuote = Readonly<{
  schema: "ryntra.solana.cross-swap-quote";
  schemaVersion: "1.0.0";
  provider: CrossSwapProvider;
  route: CrossSwapRouteMechanism;
  routeLabel: string;
  tupleId: CrossSwapTuple["id"];
  from: Readonly<{ network: SwapNetwork; asset: string; symbol: string; decimals: number; amountRaw: string }>;
  to: Readonly<{
    network: SwapNetwork;
    asset: string;
    symbol: string;
    decimals: number;
    expectedRaw: string;
    /** Signed into the order; the provider cannot fill below it. */
    minimumRaw: string;
  }>;
  slippageBps: number;
  etaSeconds: number;
  /**
   * What `deadlineUnix` actually is, because the two providers do not mean the
   * same thing by it and a surface that treats them alike would tell a person
   * their money is protected until a time that protects nothing.
   *
   * - `PROTOCOL` — a deadline the order itself carries. Mayan Swift signs one:
   *   past it, an unfilled order is refunded on the source chain.
   * - `QUOTE_VALIDITY` — no such deadline exists. Relay orders carry none; the
   *   number is only how long this product treats the quote as fresh before it
   *   re-reads it, and nothing on any chain is bound by it.
   */
  deadlineKind: "PROTOCOL" | "QUOTE_VALIDITY";
  /** Unix seconds. Read `deadlineKind` before showing this as a guarantee. */
  deadlineUnix: number;
  /**
   * What the swap costs, split the way a person has to be able to read it.
   *
   * One distinction decides whether these numbers add up, and it is easy to get
   * wrong: **`relayerUsd` is already inside `priceImpactBps`.** The provider's
   * impact figure *is* the input-to-output difference in USD, and the relayer
   * fee is the largest part of it. Only `sourceGasUsd` sits outside — the
   * wallet pays that separately, on top of the amount.
   *
   * So the honest total known cost is `impact + sourceGas`, never
   * `impact + every fee below`, which double-counts. And `relayerUsd` is itself
   * a parent of `relayerGasUsd + protocolUsd`, so adding all three
   * double-counts again. Both mistakes were made in the first canary packet.
   */
  fees: Readonly<{
    protocolBps: number;
    /** The provider's own service fee. Inside `relayerUsd`, and inside the impact. */
    protocolUsd: number | null;
    /** Relayer cost on success, USD aggregate as the provider reports it; null when the route has none. */
    relayerUsd: number | null;
    /** Destination-chain gas the relayer pays. Inside `relayerUsd`, and inside the impact. */
    relayerGasUsd: number | null;
    /** Source-chain gas the person's own wallet pays, **on top of** the amount. */
    sourceGasUsd: number | null;
    /** Relayer cost if the order is refunded instead. */
    refundUsd: number | null;
    /** Rent the source transaction reserves on Solana, in lamports; null off Solana. */
    rentLamports: string | null;
    referrerBps: number;
  }>;
  /**
   * Ryntra’s own fee — 25 bps on Relay — in the one shape all three providers
   * report through.
   *
   * Kept beside `fees` rather than inside it on purpose. Everything in `fees` is
   * a cost of moving the money, quoted by the rail; this is what Ryntra charges
   * for the service, it travels a different pipe on each rail, and it is the one
   * figure a person is entitled to see named after the company taking it. Adding
   * it into the provider total would hide exactly the number that should be
   * loudest.
   *
   * Like the relayer fee, it is **already inside `priceImpactBps`** and must not
   * be added to it. Relay states this outright — `totalImpact` is the impact
   * *with* fees and carries an `app` component in `expandedPriceImpact`, while
   * `priceImpact` is the one without them — and it follows from arithmetic on
   * Mayan, where the impact figure is the input-to-output difference and a
   * referrer fee is taken out of the output. So the honest total known cost stays
   * `impact + sourceGas`, exactly as `fees` above says, and naming this fee is
   * about telling a person who is charging them rather than about adding a row to
   * a total.
   */
  serviceFee: RyntraServiceFee;
  /** ERC-20 approvals the source wallet will be asked for; native coins need none. */
  approvals: number;
  /** Wallet prompts in total: approvals plus the swap itself. */
  walletPrompts: number;
  priceImpactBps: number | null;
  priceStatus: "GOOD" | "NORMAL" | "BAD" | null;
  /** The provider's own id for this quote, kept so the plan can prove it built what the person reviewed. */
  quoteId: string | null;
  observedAt: string;
}>;

/**
 * Has the market moved enough that a person must look again?
 *
 * A fresh quote whose signed minimum is lower than the reviewed one by more
 * than `toleranceBps`, or whose route or amount in changed, is a material
 * change: the plan refuses to build on it and the card opens a fresh Review.
 */
export function crossSwapQuoteMaterialChange(
  reviewed: Pick<CrossSwapQuote, "route" | "to" | "from">,
  fresh: Pick<CrossSwapQuote, "route" | "to" | "from">,
  toleranceBps = 25,
): Readonly<{ changed: false } | { changed: true; reason: "ROUTE" | "AMOUNT_IN" | "MINIMUM_DROPPED"; dropBps?: number }> {
  if (reviewed.route !== fresh.route) return { changed: true, reason: "ROUTE" };
  if (reviewed.from.amountRaw !== fresh.from.amountRaw) return { changed: true, reason: "AMOUNT_IN" };
  const before = BigInt(reviewed.to.minimumRaw);
  const after = BigInt(fresh.to.minimumRaw);
  if (after >= before || before === 0n) return { changed: false };
  const dropBps = Number(((before - after) * 10_000n) / before);
  if (dropBps > toleranceBps) return { changed: true, reason: "MINIMUM_DROPPED", dropBps };
  return { changed: false };
}
