/**
 * The launch's flow (L3) — the fixed rules its facts are counted by, said once here so the API, the city and anyone
 * reading the same chain count them alike. Every figure is a fact of the chain, never a verdict on the token.
 *
 * - **The launch slot** — the block the token was created in. No one outside could have seen the token before that
 *   block was made, so every buy in it besides the creator's own first purchase was arranged ahead.
 * - **A same-slot bundle** — two or more wallets buying in one slot that share the transaction, the fee payer, or a
 *   funding cluster; in the launch slot every buyer besides the creator. One slot alone is no bundle: a busy minute puts
 *   strangers in one block.
 * - **A cluster** — wallets that are one party by the Growth line's protection rules (`lib/growth/protect.ts`, read
 *   only): one paid for the other's buy, one funded the other (followed `hops` steps back), or both were funded by a
 *   source no reviewer marked as a hub (an exchange, a bridge). A wallet whose start could not be read is not known to be
 *   anyone apart: it is never counted as an independent buyer — the count is a floor, never a guess. A history too long
 *   to read counts alone only when it reaches `deepAgeDays` back.
 * - **A buyer** — a wallet other than the creator and Ryntra's own that bought at least `floorUsdMicros` in one trade
 *   (the Growth line's floor of one dollar) that is not half of a round trip; on a pair that is not a dollar the floor
 *   cannot be said and is not applied.
 * - **Independent buyers** — buyers counted once per cluster; the creator's cluster is the creator's, never a buyer.
 * - **Graduated alone** — the largest buy on the curve put at least `singleTradeBps` of the curve's migration threshold
 *   into it, or one independent buyer (or none) filled it.
 *
 * Client-safe: constants only. The Growth line's own figures are asserted equal to these in the tests.
 */

export const FLOW_RULES = Object.freeze({
  version: "launch-flow-1.0.0",
  /** The least trade that is a buyer, micro-dollars: `PROTECT_RULES.activation.minTradeUsdMicros`. */
  floorUsdMicros: 1_000_000,
  /** One buy that put this much of the migration threshold into the curve graduated it alone. */
  singleTradeBps: 5_000,
  /** The funding trail followed back from a wallet: `PROTECT_RULES.funding.hops`. */
  hops: 2,
  /** A history too long to read stands alone when it reaches this far back: `PROTECT_RULES.funding.deepAgeDays`. */
  deepAgeDays: 30,
});

/** Why a group of same-slot buys is a bundle. */
export const BUNDLE_REASONS = ["launch_slot", "same_tx", "same_payer", "same_cluster"] as const;
export type BundleReason = (typeof BUNDLE_REASONS)[number];

/** How a past launch is the same creator's: their own wallet, or a wallet of their cluster. */
export const CREATOR_LINKS = ["same_wallet", "same_cluster"] as const;
export type CreatorLink = (typeof CREATOR_LINKS)[number];

/** How many groups, signatures and past launches one answer names; every one is counted in the totals. */
export const FLOW_LISTED = Object.freeze({ bundles: 20, signatures: 20, launches: 10 });
