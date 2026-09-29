"use client";

import { useCallback, useEffect, useState } from "react";

import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { openSolanaConnection } from "@/app/solana/workspace/connection-trigger.client";
import { isPhoneUserAgent, phantomBrowseUrl } from "@/lib/solana/open-in-wallet";

/** How long the page waits for a wallet to announce itself before it says there is none — Phantom's own browser registers at once. */
const REGISTRY_SETTLE_MS = 800;

/**
 * How «Простий» reaches a wallet (canon v5.1 §4 «Почати з картки»;
 * `RYN-INVEST-SIMPLE-001`, session 5). Where the browser has a wallet, the
 * header's own panel connects it — one way to connect, as everywhere. A phone
 * whose browser has none is offered the one path that works there: this very
 * page, opened inside Phantom.
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
