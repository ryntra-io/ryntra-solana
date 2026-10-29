"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { LimitOrdersView } from "@/lib/predictions/limit";

/**
 * The wallet's limit orders as the server states them
 * (`GET /api/predictions/limit/orders`): the working ones are read back from
 * the venue before the answer is written, so what the page shows is the
 * venue's own state rather than a guess of ours.
 *
 * Nothing here decides anything: every place and every cancel is checked
 * again by the server.
 */
export function useLimitOrders(wallet: string | null, ready: boolean): Readonly<{ limits: LimitOrdersView | null; refresh: () => Promise<void> }> {
  const [limits, setLimits] = useState<LimitOrdersView | null>(null);
  const current = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    current.current = wallet;
    if (!wallet || !ready) {
      setLimits(null);
      return;
    }
    try {
      const response = await fetch("/api/predictions/limit/orders", { headers: { accept: "application/json" }, cache: "no-store" });
      if (current.current !== wallet) return;
      if (!response.ok) {
        setLimits(null);
        return;
      }
      const body = (await response.json()) as LimitOrdersView;
      /* An answer for another wallet than the one shown is never drawn. */
      setLimits(body.wallet === wallet ? body : null);
    } catch {
      if (current.current === wallet) setLimits(null);
    }
  }, [wallet, ready]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { limits, refresh };
}
