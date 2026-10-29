"use client";

import { useCallback, useEffect, useState } from "react";

import { isPhoneUserAgent, phantomBrowseUrl } from "@/lib/solana/open-in-wallet";

import { openSolanaConnection } from "./connection-trigger.client.ts";
import { useSolanaConnection } from "./connection.tsx";

/** How long the page waits for a wallet to announce itself before it says there is none — Phantom's own browser registers at once. */
const REGISTRY_SETTLE_MS = 800;

/**
 * How every page reaches a wallet (B14: one button everywhere). Where the browser has a wallet — one or several — the
 * header's own panel connects it, so the choice, the failure and the way out are the same panel on every screen. A phone
 * whose browser has none is offered the one path that works there: this very page, opened inside Phantom.
 */
export function useWalletReach(): Readonly<{ openInWallet: boolean; reach: () => void }> {
  const { wallets, connection } = useSolanaConnection();
  const [phone, setPhone] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    setPhone(isPhoneUserAgent(window.navigator.userAgent));
    const timer = window.setTimeout(() => setSettled(true), REGISTRY_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const openInWallet = phone && settled && !connection && wallets.length === 0;

  const reach = useCallback(() => {
    if (openInWallet) {
      window.location.assign(phantomBrowseUrl(window.location.href, window.location.origin));
      return;
    }
    openSolanaConnection();
  }, [openInWallet]);

  return { openInWallet, reach };
}

/**
 * A press inside a sheet that sits above the header (the phone's ticket on Spot): the sheet closes first, and the
 * header's panel opens two frames later, once the sheet is gone — otherwise the panel opens under it and the press
 * looks dead (B14, critic round 1).
 */
export function reachAfter(before: (() => void) | undefined, reach: () => void): void {
  if (!before) {
    reach();
    return;
  }
  before();
  window.requestAnimationFrame(() => window.requestAnimationFrame(reach));
}
