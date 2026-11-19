import { SOL, USDC, USDT_MINT } from './tiles.ts';

/**
 * A coin's decimals, known without a wallet: an amount typed in a coin becomes raw units only through them,
 * and a sale of a coin the wallet does not hold — or any sale before a wallet is connected — used to have nowhere to
 * read them, so the price was never asked and «You get» stood at 0. SOL, USDC and USDT are known by heart; any other
 * coin's decimals are read once from the chain through the engine's own read (`POST /api/solana/tokens/mint`, a byte of
 * the mint account) or taken from a price the engine already answered for it. Reading only.
 */

const known = new Map<string, number>([
  [SOL.mint, SOL.decimals],
  [USDC.mint, USDC.decimals],
  [USDT_MINT, 6],
]);
const asked = new Map<string, Promise<number | null>>();
const unread = new Set<string>();

/** The chain's read of a mint's decimals did not come the last time it was asked: nothing to wait for on screen. */
export function decimalsUnread(mint: string): boolean {
  return unread.has(mint);
}

/** A mint's decimals when known; null while they are not. */
export function knownDecimals(mint: string): number | null {
  return known.get(mint) ?? null;
}

/** Keeps a mint's decimals the engine said (a price's own map, a wallet's balance); anything not a whole 0–18 is let go. */
export function learnDecimals(mint: string, decimals: unknown): void {
  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 18 || known.has(mint)) return;
  known.set(mint, decimals);
}

export type DecimalsFetch = (url: string, init: RequestInit) => Promise<Readonly<{ ok: boolean; json: () => Promise<unknown> }>>;

/**
 * A mint's decimals read from the chain, once per mint at a time: null when the engine did not answer (asked again on
 * the next need) or the address is not a coin.
 */
export function askDecimals(mint: string, fetchImpl: DecimalsFetch = (url, init) => fetch(url, init)): Promise<number | null> {
  const have = knownDecimals(mint);
  if (have !== null) return Promise.resolve(have);
  const pending = asked.get(mint);
  if (pending) return pending;
  const read = fetchImpl('/api/solana/tokens/mint', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mint }) })
    .then(async (response) => {
      if (!response.ok) return null;
      const body = (await response.json()) as { mint?: unknown; decimals?: unknown } | null;
      if (!body || body.mint !== mint) return null;
      learnDecimals(mint, body.decimals);
      return knownDecimals(mint);
    })
    .catch(() => null)
    .then((decimals) => {
      if (decimals === null) unread.add(mint);
      else unread.delete(mint);
      return decimals;
    })
    .finally(() => asked.delete(mint));
  asked.set(mint, read);
  return read;
}
