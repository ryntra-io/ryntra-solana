"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { SettleSweep } from "@/lib/predictions/settle-run";

/**
 * Settlement as the server states it for the signed-in wallet
 * (`/api/predictions/settlement`): the calendar, the payouts on their way in
 * and the notes. The read asks for no payout — `collect` does, and the server
 * checks everything again under the market's one request id, so a second
 * press cannot become a second payout.
 */
export type SettlementData = SettleSweep;

export function useSettlement(wallet: string | null, ready: boolean): Readonly<{
  settlement: SettlementData | null;
  busy: boolean;
  refresh: () => Promise<void>;
  collect: () => Promise<void>;
}> {
  const [settlement, setSettlement] = useState<SettlementData | null>(null);
  const [busy, setBusy] = useState(false);
  const current = useRef<string | null>(null);

  const load = useCallback(
    async (method: "GET" | "POST") => {
      current.current = wallet;
      if (!wallet || !ready) {
        setSettlement(null);
        return;
      }
      if (method === "POST") setBusy(true);
      try {
        const response = await fetch("/api/predictions/settlement", { method, headers: { accept: "application/json" }, cache: "no-store" });
        if (current.current !== wallet) return;
        if (!response.ok) return;
        const body = (await response.json()) as SettlementData;
        /* An answer for another wallet than the one shown is never drawn. */
        if (body.wallet === wallet) setSettlement(body);
      } catch {
        /* Nothing is invented on a failed read: what is drawn stays as it was. */
      } finally {
        if (method === "POST") setBusy(false);
      }
    },
    [wallet, ready],
  );

  const refresh = useCallback(() => load("GET"), [load]);
  const collect = useCallback(() => load("POST"), [load]);

  useEffect(() => {
    void load("GET");
  }, [load]);

  return { settlement, busy, refresh, collect };
}
