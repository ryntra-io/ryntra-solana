"use client";

/**
 * The wallet, as a state rather than a control.
 *
 * Control needs to *show* which wallet is connected; it does not need to manage
 * one. Reaching for the full Solana connection control here crashed the route,
 * because that component reads the Solana workspace's own translator and that
 * provider does not exist in the agents tree — and mounting a second, fail-closed
 * catalog on a surface with its own locale to render one address would be a lot
 * of machinery for a chip.
 *
 * So this is the chip. It carries no menu, offers no connect and disconnects
 * nothing: the wallet is managed where the wallet is used. A person who wants to
 * change it goes to Money, which is where changing it means something.
 */

import { Wallet } from "@phosphor-icons/react";

export function ProductWalletChip({
  address,
  label,
}: {
  address: string | null;
  /** What the chip is, for a screen reader. Never rendered as visible prose. */
  label: string;
}) {
  if (!address) return null;
  const short = `${address.slice(0, 4)}…${address.slice(-4)}`;

  return (
    <span className="rs-walletchip" title={address} aria-label={`${label}: ${address}`}>
      <Wallet size={15} weight="bold" aria-hidden />
      <span translate="no">{short}</span>
    </span>
  );
}
