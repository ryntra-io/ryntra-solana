"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { readLimitOrders, type LimitOrderView } from "./limit-api.ts";
import type { LimitToken } from "./limit-orders-view.ts";

export type LimitOrdersRead = Readonly<{
  status: "idle" | "loading" | "ready" | "failed";
  orders: readonly LimitOrderView[];
  tokens: Readonly<Record<string, LimitToken>>;
  complete: boolean;
  reload: () => void;
}>;

/** How often the orders are read again while the page is open: a fill arrives without the person doing anything. */
export const LIMIT_ORDERS_REFRESH_MS = 30_000;

type Held = Omit<LimitOrdersRead, "reload"> & Readonly<{ owner: string | null }>;

const NOTHING: Held = { owner: null, status: "idle", orders: [], tokens: {}, complete: true };

/**
 * The wallet's limit orders, read once for the whole Spot workspace — the
 * chart's lines, the ticket's count and «Мої ордери» all show this one read —
 * again on every `generation` (a placement, a cancellation, a fill elsewhere
 * on the page) and every half minute. The orders belong to the wallet that
 * was read: another wallet starts from nothing; a refresh of the same wallet
 * shows no skeleton, and a failed one keeps its last good answer.
 */
export function useLimitOrders(owner: string | null, generation: number): LimitOrdersRead {
  const [held, setHeld] = useState<Held>(NOTHING);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((current) => current + 1), []);

  useEffect(() => {
    if (!owner) {
      setHeld(NOTHING);
      return undefined;
    }
    let cancelled = false;
    const read = async () => {
      setHeld((current) =>
        current.owner === owner && current.status === "ready" ? current : { owner, status: "loading", orders: [], tokens: {}, complete: true },
      );
      const answer = await readLimitOrders(owner);
      if (cancelled) return;
      if (answer.ok) setHeld({ owner, status: "ready", orders: answer.value.orders, tokens: answer.value.tokens, complete: answer.value.complete });
      else setHeld((current) => (current.owner === owner && current.status === "ready" ? current : { owner, status: "failed", orders: [], tokens: {}, complete: true }));
    };
    void read();
    const timer = window.setInterval(() => void read(), LIMIT_ORDERS_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [owner, generation, nonce]);

  /* A wallet that changed before its read answered shows nothing of the last one, even for a render. */
  const shown = held.owner === owner ? held : owner ? { ...NOTHING, owner, status: "loading" as const } : NOTHING;
  return useMemo(
    () => ({ status: shown.status, orders: shown.orders, tokens: shown.tokens, complete: shown.complete, reload }),
    [shown.status, shown.orders, shown.tokens, shown.complete, reload],
  );
}
