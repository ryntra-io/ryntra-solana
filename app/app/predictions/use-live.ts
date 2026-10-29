"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { LiveAccess } from "@/lib/predictions/live";
import type { PaperAccountView } from "@/lib/predictions/paper";
import type { RedeemReceipt } from "@/lib/predictions/redeem";

/**
 * Live trading as the server states it for the signed-in wallet
 * (`/api/predictions/live`): whether it is open, on which venues and up to
 * what amount, and the live account when it is. Nothing here decides
 * anything — the server checks every live quote and fill again.
 */
export type LiveData = Readonly<{
  wallet: string;
  access: LiveAccess;
  account: PaperAccountView | null;
  redeemable: readonly Readonly<{ outcomeId: string; question: string; label: string; valueUsd: number }>[];
  receipts: readonly RedeemReceipt[];
}>;

export function useLive(wallet: string | null, ready: boolean): Readonly<{ live: LiveData | null; refresh: () => Promise<void> }> {
  const [live, setLive] = useState<LiveData | null>(null);
  const current = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    current.current = wallet;
    if (!wallet || !ready) {
      setLive(null);
      return;
    }
    try {
      const response = await fetch("/api/predictions/live", { headers: { accept: "application/json" }, cache: "no-store" });
      if (current.current !== wallet) return;
      if (!response.ok) {
        setLive(null);
        return;
      }
      const body = (await response.json()) as LiveData;
      /* An answer for another wallet than the one shown is never drawn. */
      setLive(body.wallet === wallet ? body : null);
    } catch {
      if (current.current === wallet) setLive(null);
    }
  }, [wallet, ready]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { live, refresh };
}
