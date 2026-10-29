/**
 * A Solana mint as a person pastes it: base58 (no 0, O, I or l), 32 to 44 characters. Anything else is not an
 * address, and the city never asks the engine about it.
 */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isMint(value: unknown): value is string {
  return typeof value === 'string' && BASE58.test(value);
}

/** What was pasted, trimmed of the spaces and quotes a copy brings along; null when it is not a mint. */
export function pastedMint(value: string): string | null {
  const trimmed = value.trim().replace(/^["'`]+|["'`]+$/g, '');
  return isMint(trimmed) ? trimmed : null;
}

/** A ticker as people type it: no leading `$`, upper case. */
export function bareSymbol(symbol: string): string {
  return symbol.trim().replace(/^\$+/, '').toUpperCase();
}
