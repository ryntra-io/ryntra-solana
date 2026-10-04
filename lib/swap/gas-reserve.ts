/**
 * What a native balance must keep back so the transaction can actually be sent.
 *
 * A person presses Max and it does not go through; they lower the amount a
 * little and it does not go through; they lower it again and it still does
 * not. MAX has to leave behind the minimum the transaction needs, and no more.
 * The first attempt at this taught the rule that shapes the whole module: one
 * measured `gasLimit = 32 432` is not a universal truth for every EVM network
 * and every asset type, and on EIP-1559/L2 the simple formula
 * `eth_gasPrice × one fixed gasLimit` is not always the full maximum cost.
 *
 * That is why this file no longer prices anything itself. One measured gas
 * limit describes one operation on one chain: a native deposit is not an
 * ERC-20 approve plus a bridge call, an EIP-1559 chain charges a base fee plus
 * a priority fee rather than a single price, and an optimistic rollup adds an
 * L1 data fee that appears in no `gasPrice` at all. A product that multiplied
 * one price by one limit would be confidently wrong on three chains out of four.
 *
 * ## So there are two phases, and they answer different questions
 *
 * **Before a transaction exists**, MAX needs a number and nothing can know the
 * real one. It uses a **conservative, network-specific** allowance — deliberately
 * generous, because the cost of being generous is a little value left behind and
 * the cost of being wrong is a button that cannot be pressed.
 *
 * **Once the transaction is built**, the real maximum cost is known: the plan
 * states it. `reconcileNativeCost` compares it against what the person actually
 * has and answers one of three things — it fits, it fits after one correction,
 * or it does not fit at all. Nobody is ever asked to find the number by
 * lowering the amount until something works.
 *
 * Pure: no clock, no network, no environment.
 */

/**
 * The allowance MAX holds back before any transaction exists, per network.
 *
 * Owned by `catalog.ts`, which is where the per-network figures live and where
 * each one carries the measurement or the reasoning behind it. This module only
 * says what such a figure is *for*: it is a pre-flight guess whose only job is to
 * keep MAX in the region of signable, and it is corrected the moment a real
 * transaction exists.
 */
export type ConservativeReserve = Readonly<{ reserveRaw: bigint; phase: "PRE_FLIGHT" }>;

export function conservativeReserve(reserveRaw: bigint): ConservativeReserve {
  return { reserveRaw, phase: "PRE_FLIGHT" };
}

/**
 * A Solana transaction fee is 5,000 lamports per signature, and this lane signs
 * once — but that is the **floor**, not the answer. A priority fee raises it, and
 * opening a destination token account costs rent on top. Both are properties of
 * the built transaction, so this constant is only ever used to make the
 * pre-flight guess not obviously too small.
 */
export const SOLANA_SIGNATURE_FEE_LAMPORTS = 5_000n;
/** Pre-flight headroom for a priority fee this lane may attach. Not a promise. */
export const SOLANA_PRIORITY_HEADROOM_LAMPORTS = 15_000n;

/**
 * The pre-flight Solana reserve: the quote's own rent when it states one, plus
 * enough for a fee that is not yet known exactly.
 *
 * Reserving the quoted rent **alone** was the defect this replaced: the amount
 * came out as balance minus rent, and the transaction then still had a signature
 * fee to pay out of lamports it no longer had — so MAX was short by exactly the
 * fee, every time, on every Solana origin.
 *
 * There is no ceiling here, unlike the EVM allowance. Rent is not a cushion that
 * may be trimmed; it is what the chain charges to open the account, and clamping
 * it back to a guessed figure would put the shortfall straight back.
 */
export function solanaPreFlightReserveLamports(
  quotedRentLamports: string | null,
  fallbackLamports: bigint,
): Readonly<{ reserveLamports: bigint; basis: "QUOTED_RENT" | "FALLBACK" }> {
  if (quotedRentLamports === null || !/^[0-9]+$/.test(quotedRentLamports)) {
    return { reserveLamports: fallbackLamports, basis: "FALLBACK" };
  }
  return {
    reserveLamports: BigInt(quotedRentLamports) + SOLANA_SIGNATURE_FEE_LAMPORTS + SOLANA_PRIORITY_HEADROOM_LAMPORTS,
    basis: "QUOTED_RENT",
  };
}

export type NativeCostInput = Readonly<{
  /** Everything the wallet holds of the coin that pays for gas, in its own units. */
  nativeBalanceRaw: bigint;
  /** What the person is about to send. Zero for an ERC-20 or SPL origin. */
  intendedNativeSpendRaw: bigint;
  /**
   * The built transaction's own maximum cost, as the plan states it.
   *
   * Whatever the chain's fee model is — legacy gas price, EIP-1559 base plus
   * priority, or a rollup's execution plus L1 data fee — this is the figure that
   * model produced for **this** execution. Nothing here reconstructs it, which
   * is the whole point: a reconstruction is a second fee model that can disagree
   * with the real one.
   */
  executionMaxCostRaw: bigint | null;
}>;

export type NativeCostVerdict =
  /** The amount and the fee both fit. Nothing to say. */
  | Readonly<{ ok: true; state: "FITS" }>
  /**
   * The fee turned out dearer than the pre-flight guess, and the largest
   * sendable amount is smaller than what is in the field. Corrected **once**,
   * with the figure to show — never by asking somebody to lower it themselves.
   */
  | Readonly<{ ok: true; state: "ADJUSTED"; maximumRaw: bigint; reserveRaw: bigint }>
  /**
   * The wallet cannot cover the fee at all, whatever the amount. For an ERC-20
   * origin this is the common case and the important one: the token balance is
   * irrelevant, and the answer is "top up the coin that pays for gas".
   */
  | Readonly<{ ok: false; state: "NATIVE_SHORT"; shortfallRaw: bigint; requiredRaw: bigint }>
  /** No cost figure was produced, so nothing may be claimed either way. */
  | Readonly<{ ok: true; state: "UNKNOWN" }>;

/**
 * Reconcile what the person is sending with what the built transaction will cost.
 *
 * Called once, after the plan exists and before anything is signed. It is the
 * half of the rule that stops the guessing game: if the exact transaction needs
 * more than MAX left behind, the person is never made to lower the amount by
 * hand several times — the largest allowed amount is recalculated once.
 *
 * The `intendedNativeSpendRaw` argument is what makes this work for both origins
 * with one function. A native origin spends the same coin the fee comes from, so
 * the two compete; an ERC-20 or SPL origin spends something else, so it passes
 * zero and the only question left is whether the wallet can pay the fee at all.
 */
export function reconcileNativeCost(input: NativeCostInput): NativeCostVerdict {
  const cost = input.executionMaxCostRaw;
  if (cost === null || cost < 0n) return { ok: true, state: "UNKNOWN" };

  /* The fee alone is beyond the wallet. No amount fixes this, so it is refused
     rather than corrected — and the shortfall is stated, because "not enough for
     the network fee" without a figure is the sentence people bounce off. */
  if (cost > input.nativeBalanceRaw) {
    return { ok: false, state: "NATIVE_SHORT", shortfallRaw: cost - input.nativeBalanceRaw, requiredRaw: cost };
  }

  const affordable = input.nativeBalanceRaw - cost;
  if (input.intendedNativeSpendRaw <= affordable) return { ok: true, state: "FITS" };
  return { ok: true, state: "ADJUSTED", maximumRaw: affordable, reserveRaw: cost };
}
