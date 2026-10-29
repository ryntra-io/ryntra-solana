import { bareSymbol, pastedMint } from '../search/mint.ts';
import { formatUnits, shortAddress } from './format.ts';
import { SOL, USDC, type Balance, type PayAsset } from './tiles.ts';
import type { Holdings } from './wallet.ts';

/**
 * Any coin for any coin on the trade card: which coins the wallet can pay with, and how a list of them answers what
 * the person typed. The wallet's coins are the engine's holdings read — what it can spend and what the engine called
 * each coin; the coins to receive are the city's search. Nothing here prices anything: the engine's quote does.
 */

/** A tower as this file needs it: its mint and the name the city may say for it. */
export type NamedTower = Readonly<{ id: string; symbol: string; name: string; verified: boolean; icon?: string | null }>;

/** A tower's logo through the city's own icon route, as the tower card draws it; only a verified tower's. */
function towerIcon(tower: NamedTower | undefined): string | null {
  return tower?.verified && tower.icon ? `/api/icon/${tower.id}` : null;
}

/** One coin the wallet holds, ready to pay with: the asset, what can be spent of it, and that amount in short. */
export type WalletCoin = Readonly<{ asset: PayAsset; balance: Balance; amount: string }>;

/**
 * The coins of the wallet the card may pay with, SOL first and USDC second, then every other coin in the order the
 * engine listed them (verified and named first). A coin keeps the name the engine gave it, else its tower's when the
 * city may say that one, else its address cut short — never a name guessed.
 */
export function walletCoins(holdings: Holdings | null, towers: readonly NamedTower[] = []): readonly WalletCoin[] {
  if (!holdings) return [];
  const coins: WalletCoin[] = [];
  const add = (asset: PayAsset, balance: Balance | null | undefined) => {
    if (!balance || !/^\d+$/.test(balance.spendableRaw) || BigInt(balance.spendableRaw) === 0n) return;
    coins.push({ asset, balance, amount: formatUnits(balance.spendableRaw, balance.decimals, 'down') });
  };
  add(SOL, holdings.sol);
  add(USDC, holdings.tokens.get(USDC.mint));
  const byMint = new Map(towers.map((tower) => [tower.id, tower]));
  for (const [mint, balance] of holdings.tokens) {
    if (mint === SOL.mint || mint === USDC.mint) continue;
    const named = holdings.names?.get(mint) ?? null;
    const tower = byMint.get(mint);
    const symbol = named?.symbol ?? (tower?.verified ? bareSymbol(tower.symbol) : null);
    add(
      {
        mint,
        symbol: symbol ?? shortAddress(mint),
        name: named?.name ?? (tower?.verified ? tower.name : null),
        decimals: balance.decimals,
        verified: named?.verified ?? (tower ? tower.verified : null),
        icon: named?.icon ?? towerIcon(tower),
      },
      balance,
    );
  }
  return coins;
}

/**
 * Whether a coin answers what was typed: a pasted address finds its own coin only; a word finds the ticker or the name
 * by its start, or by any word of the name. Nothing typed keeps every coin.
 */
export function coinMatches(asset: Pick<PayAsset, 'mint' | 'symbol' | 'name'>, query: string): boolean {
  const typed = query.trim();
  if (!typed) return true;
  const mint = pastedMint(typed);
  if (mint) return asset.mint === mint;
  const q = bareSymbol(typed);
  if (!q) return true;
  const symbol = asset.symbol.toUpperCase();
  const name = (asset.name ?? '').toUpperCase();
  return symbol.startsWith(q) || name.startsWith(q) || name.split(/[\s\-_.]+/).some((part) => part.startsWith(q)) || (q.length >= 2 && symbol.includes(q));
}

/** The coins a picker offers to receive when nothing is typed: SOL and USDC, then the busiest towers of the city. */
export function suggestedCoins(towers: readonly (NamedTower & Readonly<{ volume24h?: number }>)[], exclude: ReadonlySet<string>, limit = 6): readonly PayAsset[] {
  const listed: PayAsset[] = [SOL, USDC].filter((asset) => !exclude.has(asset.mint));
  const busiest = [...towers]
    .filter((tower) => tower.verified && !exclude.has(tower.id) && tower.id !== SOL.mint && tower.id !== USDC.mint)
    .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
  for (const tower of busiest) {
    if (listed.length >= limit) break;
    listed.push({ mint: tower.id, symbol: bareSymbol(tower.symbol), name: tower.name, decimals: null, verified: true, icon: towerIcon(tower) });
  }
  return listed;
}
