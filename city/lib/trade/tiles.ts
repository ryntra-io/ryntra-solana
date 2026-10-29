import { NATIVE_SOL_DECIMALS, SOLANA_MAINNET_USDC_MINT, WRAPPED_SOL_MINT } from '../../../lib/solana/send-kinds.ts';
import { ticker } from './format.ts';

/**
 * What a tower is bought with and sold into. A tower is bought with SOL, USDC or any other coin of the wallet, and sold
 * into SOL, USDC or any coin the search finds — the person picks; never the tower itself, so the SOL tower is paid with
 * USDC by default and the USDC tower with SOL. How much is spent is `size.ts`.
 */

export type Side = 'buy' | 'sell';

export type PayAsset = Readonly<{
  mint: string;
  symbol: string;
  /** Known for SOL, USDC and every coin of the wallet; null for a coin the search found, which is only received. */
  decimals: number | null;
  name?: string | null;
  /** Jupiter's verification as the source said it; null where it did not say. */
  verified?: boolean | null;
  /** A same-origin picture address, or null for the plain disc. */
  icon?: string | null;
}>;

/** A coin whose decimals are known: SOL, USDC, a coin of the wallet. */
export type KnownAsset = PayAsset & Readonly<{ decimals: number }>;

export const SOL: KnownAsset = { mint: WRAPPED_SOL_MINT, symbol: 'SOL', decimals: NATIVE_SOL_DECIMALS, name: 'Solana', verified: true, icon: `/api/icon/${WRAPPED_SOL_MINT}` };
export const USDC: KnownAsset = { mint: SOLANA_MAINNET_USDC_MINT, symbol: 'USDC', decimals: 6, name: 'USD Coin', verified: true, icon: null };

/** SOL and USDC: the two the card always offers, written without a `$`. */
export function isBase(asset: Pick<PayAsset, 'mint'>): boolean {
  return asset.mint === SOL.mint || asset.mint === USDC.mint;
}

/** How the card writes an asset's unit: SOL and USDC as they are, every other coin as its ticker. */
export function unitOf(asset: Pick<PayAsset, 'mint' | 'symbol'>): string {
  return isBase(asset) ? asset.symbol : ticker(asset.symbol);
}

/**
 * What this tower can be paid with and sold into: SOL, USDC and the other coin the person picked, never the tower
 * itself and never one coin twice.
 */
export function payOptionsFor(towerMint: string, other: PayAsset | null = null): readonly PayAsset[] {
  const options = [SOL, USDC, ...(other && !isBase(other) ? [other] : [])];
  return options.filter((asset) => asset.mint !== towerMint);
}

/**
 * The asset the card uses: the one the person picked — SOL or USDC by its symbol, the other coin by its mint — when
 * this tower allows it, else the first it allows.
 */
export function payAssetFor(towerMint: string, wanted?: string | null, other: PayAsset | null = null): PayAsset {
  const options = payOptionsFor(towerMint, other);
  return options.find((asset) => (isBase(asset) ? asset.symbol === wanted : asset.mint === wanted)) ?? options[0]!;
}

/** What the connected wallet can spend of one asset, as the engine's holdings read says. */
export type Balance = Readonly<{ spendableRaw: string; decimals: number }>;
