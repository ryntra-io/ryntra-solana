import { ACCOUNT_WORDS } from '../../city/lib/quarter/words.ts';
import { SEEKER_CONNECT_WALLET } from '../../lib/solana/seeker-connect.ts';

/**
 * Whether the header's wallet panel stands open, and so listens for a tap outside it. Never while the phone's sections
 * sheet is open: the sheet holds the wallet then, and a tap inside the sheet's list of wallets must reach it — a header
 * listening at the same time took that tap as «outside» and cancelled the list under the finger. Otherwise: the menu
 * of a connected wallet, the list of wallets to pick, or the last step's one line.
 *
 * Pure, so the rule is tested as it is (`terminal/shell/shell-rules.test.mjs`).
 */
export function headerWalletShows(state: Readonly<{ sheet: boolean; open: boolean; connected: boolean; picking: boolean; error: boolean }>): boolean {
  if (state.sheet) return false;
  return (state.open && state.connected) || state.picking || state.error;
}

/**
 * The list of wallets as the panel offers them: Seeker Connect first wherever it is listed — it is listed only where a
 * Seeker is likely (`lib/solana/wallet.client.ts`), and there the phone's own wallet is the one its owner came with. The rest keep the order the wallets' own ranking gave them.
 */
export function walletsInOrder<T extends Readonly<{ name: string }>>(wallets: readonly T[]): T[] {
  const seeker = wallets.filter((wallet) => wallet.name === SEEKER_CONNECT_WALLET);
  return [...seeker, ...wallets.filter((wallet) => wallet.name !== SEEKER_CONNECT_WALLET)];
}

/**
 * Whether the last step's line is a person's own «no», not a fault: the sign-in's second window closed — «Nothing was
 * signed. Nothing changed.» It is said calmly, never in the error's red (it read as something broken).
 */
export function walletLineCalm(line: string | null): boolean {
  return line !== null && (line === ACCOUNT_WORDS.en.declined || line === ACCOUNT_WORDS.uk.declined);
}
