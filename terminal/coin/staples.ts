import { spotIcon } from '../../city/lib/search/rank.ts';
import { SOL, USDC, USDT_MINT, type KnownAsset, type PayAsset } from '../../city/lib/trade/tiles.ts';

export { USDT_MINT };

/**
 * The coins the Spot desk always has at hand: SOL, USDC and USDT to pay with and to be paid in, the wallet's own coins beside them, and the coin
 * picker's «Main» tab. Pure: the tests hold it as it is written. What a coin costs, its route and its order stay the
 * trade card's (`city/lib/trade/**`) and the swap engine's; a coin here is only offered.
 */

/**
 * The engine's logo route for any coin of Solana's catalogue (`/api/spot/icon`): the picture Jupiter lists for the mint,
 * fetched by the engine and cached at the edge; a coin without one answers «no logo» and keeps its letter.
 */
export const spotLogo = (mint: string): string => `/api/spot/icon?mint=${encodeURIComponent(mint)}`;

/** USDC's own logo, kept with the site: the city's logo proxy answers nothing for money that is not a tower. */
export const USDC_LOGO = '/site/universe/USDC.png';

/** Tether's dollar on Solana: 6 decimals, its logo from the engine's catalogue route. */
export const USDT: KnownAsset = { mint: USDT_MINT, symbol: 'USDT', decimals: 6, name: 'Tether USD', verified: true, icon: spotLogo(USDT_MINT) };

/** What the desk always offers to pay with and to be paid in, in this order. */
export const MONEY: readonly KnownAsset[] = [SOL, USDC, USDT];

/** The most coins of the wallet the «pay with» list offers beside the money. */
export const WALLET_COINS = 12;

/**
 * The coin picker's «Main» tab, first: the money, the staked SOL, bitcoin on Solana, then the coins people trade most —
 * each read with its price from the Market's engine (`/api/v1/market/depth`, the list of named mints).
 */
export const MAIN_MINTS: readonly string[] = [
  SOL.mint,
  USDC.mint,
  USDT_MINT,
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // JitoSOL
  'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v', // JupSOL
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', // cbBTC
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
  'METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL', // MET
  'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', // JTO
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', // PYTH
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
  '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN', // TRUMP
  '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv', // PENGU
];

/** The list's rows in the order the list names them; a coin the read did not bring is left out, never guessed. */
export function inMainOrder<T extends Readonly<{ id: string }>>(coins: readonly T[]): T[] {
  const at = new Map(MAIN_MINTS.map((mint, i) => [mint, i]));
  return coins.filter((coin) => at.has(coin.id)).sort((a, b) => at.get(a.id)! - at.get(b.id)!);
}

/**
 * A coin's logo for the ticket's lists and fields: its own same-origin picture when it carries one, USDC's kept with the
 * site, SOL's from the city's proxy, and any other coin's from the engine's catalogue route — never nothing, so a
 * letter stands only where the engine truly has no logo.
 */
export function payLogo(asset: Pick<PayAsset, 'mint' | 'icon'>): string {
  if (asset.icon) return asset.icon;
  if (asset.mint === USDC.mint) return USDC_LOGO;
  if (asset.mint === SOL.mint) return `/api/icon/${SOL.mint}`;
  return spotLogo(asset.mint);
}

/**
 * The coin's own logo where the ticket writes an amount in it (a sale): the address the market named through the
 * engine's route, a same-origin picture as it is, else the catalogue route by its mint.
 */
export function coinLogo(coin: Readonly<{ mint: string; icon: string | null }>): string {
  if (coin.icon?.startsWith('/')) return coin.icon;
  return spotIcon(coin.mint, coin.icon) ?? payLogo({ mint: coin.mint, icon: null });
}

/** What a balance says: a coin the wallet holds something of. */
type Held = Readonly<{ asset: PayAsset; spendableRaw: string }>;

/**
 * What a buy is paid with, one tap each: SOL, USDC and USDT always — never the coin bought — then the wallet's coins
 * with something to spend, then the coin already picked if none of those is it (a coin kept from the Swap screen).
 * Each coin once.
 */
export function payRows(input: Readonly<{ towerMint: string; held: readonly Held[]; picked: PayAsset | null; most?: number }>): PayAsset[] {
  const rows: PayAsset[] = [];
  const seen = new Set<string>([input.towerMint]);
  const add = (asset: PayAsset) => {
    if (seen.has(asset.mint)) return;
    seen.add(asset.mint);
    rows.push(asset);
  };
  MONEY.forEach(add);
  let wallet = 0;
  for (const coin of input.held) {
    if (wallet >= (input.most ?? WALLET_COINS)) break;
    if (coin.spendableRaw === '0' || !/^\d+$/.test(coin.spendableRaw) || seen.has(coin.asset.mint)) continue;
    add(coin.asset);
    wallet += 1;
  }
  if (input.picked) add(input.picked);
  return rows;
}

/** What a sale is paid in, one tap each: SOL, USDC or USDT — never the coin sold — and the coin already picked. */
export function paidRows(towerMint: string, picked: PayAsset | null): PayAsset[] {
  return payRows({ towerMint, held: [], picked });
}

/**
 * The quick sums of a buy on the coin's desk, in what pays — what a trader taps most: tenths of SOL to five, and ten to
 * five hundred dollars in USDC or USDT («$10»). Another coin of the wallet has none: its 25 % … Max stand for it.
 */
export function quickSums(payMint: string): Readonly<{ sums: readonly string[]; dollars: boolean }> | null {
  if (payMint === SOL.mint) return { sums: ['0.1', '0.5', '1', '5'], dollars: false };
  if (payMint === USDC.mint || payMint === USDT_MINT) return { sums: ['10', '50', '100', '500'], dollars: true };
  return null;
}

/**
 * What a sale is paid in when the person turns a buy into a sale: the coin a buy was paid with if it is money (SOL, USDC,
 * USDT), else the first money the coin sold allows — a coin of the wallet picked to pay with is not what a sale brings
 * by itself. Null keeps what stands.
 */
export function saleMoney(towerMint: string, payMint: string): KnownAsset | null {
  if (MONEY.some((asset) => asset.mint === payMint)) return null;
  return MONEY.find((asset) => asset.mint !== towerMint) ?? null;
}
