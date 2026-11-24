/**
 * The network «Autopay» runs on in this release: `NEXT_PUBLIC_RYNTRA_AUTOPAY` — `devnet` or `mainnet`;
 * anything else — closed, no tab and no menu item. Its own file, so the menu reads it without the screen.
 */
export type AutopayNetwork = 'devnet' | 'mainnet';

export function autopayNetwork(flag: string | undefined = process.env.NEXT_PUBLIC_RYNTRA_AUTOPAY): AutopayNetwork | null {
  const value = flag?.trim().toLowerCase();
  return value === 'devnet' || value === 'mainnet' ? value : null;
}

export const autopayOpen = (flag?: string): boolean => autopayNetwork(flag ?? process.env.NEXT_PUBLIC_RYNTRA_AUTOPAY) !== null;
