"use client";

/**
 * Once the wallet choice inside Send, Swap and Bridge. Since B14 a guest's one action in every form is
 * `ConnectWalletButton` (`wallet-gate.tsx`), which opens the header's panel — the choice, the install and the failure
 * live there — so this row draws nothing.
 */

export type WalletConnectRowProps = Readonly<{
  hintClassName?: string;
  errorClassName?: string;
}>;

export function WalletConnectRow(props: WalletConnectRowProps): null {
  void props;
  return null;
}
