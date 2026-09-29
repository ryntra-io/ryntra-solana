import type { SolanaWalletAction } from "./action-ledger.ts";

/**
 * The executed dollar value of a wallet action, at par, or nothing.
 *
 * One valuation rule, shared by the owner's business dashboard
 * (`lib/admin/business.ts`) and the Points ledger (`lib/points/`), so a trade
 * is worth the same dollars on both — there is no second bookkeeping to drift
 * from the first. Pure and client-safe: no clock, no store, no `process.env`.
 *
 * Par is the only valuation made here on its own: a stablecoin is a dollar by
 * construction, so the figure is a fact about the row rather than a price read
 * later. Anything else is left unvalued rather than priced; a caller that has
 * a better source — the provider's own dollar figure for this exact fill —
 * says so under its own basis.
 */

/** Solana mainnet stablecoins carried at par, and the decimals par assumes. */
export const ACTION_PAR_MINTS: Readonly<Record<string, number>> = {
  /* USDC */ EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6,
  /* USDT */ Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 6,
};

/** Symbols carried at par where a row names the asset by symbol rather than mint (the cross-chain lanes). */
export const ACTION_PAR_SYMBOLS: ReadonlySet<string> = new Set(["USDC", "USDT", "USDG"]);

/** Raw base units of a par asset, rescaled to USD micro-units. */
export function parUsdMicros(amountRaw: string, decimals: number): bigint {
  const raw = BigInt(amountRaw);
  if (decimals === 6) return raw;
  if (decimals > 6) return raw / 10n ** BigInt(decimals - 6);
  return raw * 10n ** BigInt(6 - decimals);
}

/** The USD value of one leg, at par, or null. */
export function movementUsdMicros(movement: SolanaWalletAction["out"]): bigint | null {
  if (movement === null) return null;
  if (!/^(0|[1-9][0-9]*)$/.test(movement.amountRaw)) return null;
  if (movement.mint !== null) {
    const par = ACTION_PAR_MINTS[movement.mint];
    if (par === undefined) return null;
    const decimals = movement.decimals ?? par;
    return decimals === par ? parUsdMicros(movement.amountRaw, decimals) : null;
  }
  if (movement.symbol && ACTION_PAR_SYMBOLS.has(movement.symbol.toUpperCase()) && movement.decimals !== null) {
    return parUsdMicros(movement.amountRaw, movement.decimals);
  }
  return null;
}

/** Executed value of a trade: the stablecoin leg that left, else the one that arrived. */
export function tradeUsdMicros(action: SolanaWalletAction): bigint | null {
  return movementUsdMicros(action.out) ?? movementUsdMicros(action.in);
}

/**
 * The provider's own dollar figure for a fill, kept only when the input that
 * moved is exactly the input that was quoted — the rule Points has applied
 * since it existed. A quote for a different amount values nothing.
 */
export function statedUsdOf(inUsdValue: string | null | undefined, quotedInputRaw: string, actualInputRaw: string): number | null {
  if (!inUsdValue || quotedInputRaw !== actualInputRaw) return null;
  const value = Number(inUsdValue);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** How a row's executed value is established: a stablecoin leg at par, or the provider's own figure for the exact fill. */
export type ExecutedUsdBasis = "PAR" | "PROVIDER_STATED";

/** Executed value in USD: par where a stablecoin leg exists, else the provider's stated figure, else nothing. */
export function executedUsd(action: Pick<SolanaWalletAction, "out" | "in" | "statedUsd">): Readonly<{ value: number; basis: ExecutedUsdBasis }> | null {
  const par = movementUsdMicros(action.out) ?? movementUsdMicros(action.in);
  if (par !== null) return { value: Number(par) / 1_000_000, basis: "PAR" };
  if (typeof action.statedUsd === "number" && Number.isFinite(action.statedUsd)) return { value: action.statedUsd, basis: "PROVIDER_STATED" };
  return null;
}
