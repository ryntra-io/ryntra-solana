"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import type { PositionsResponse, PositionWatchView } from "@/lib/api/v1/contract";

/**
 * Нагляд over the wallet's positions, read once for the page
 * (`GET /api/v1/positions`, contract 1.21.0): the
 * company page, Portfolio and Нагляд read the same answer, so a position never
 * says one state in one place and another in the next. Behind the wallet's
 * proof — a position's exit is the wallet's own record — and kept per wallet;
 * a reader asks again only when the answer is older than it can bear.
 */

type Store = Readonly<{ key: string | null; status: "idle" | "loading" | "ready" | "failed"; body: PositionsResponse | null; readAt: number }>;

const EMPTY: Store = { key: null, status: "idle", body: null, readAt: 0 };
let store: Store = EMPTY;
let inflight: string | null = null;
const listeners = new Set<() => void>();

function publish(next: Store) {
  store = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const current = () => store;
const initial = () => EMPTY;

async function load(key: string): Promise<void> {
  if (inflight === key) return;
  inflight = key;
  if (store.key !== key) publish({ key, status: "loading", body: null, readAt: 0 });
  else if (store.status !== "ready") publish({ ...store, status: "loading" });
  try {
    const response = await fetch("/api/v1/positions", { headers: { accept: "application/json", "X-Ryntra-API": "1" } });
    if (store.key !== key) return;
    if (!response.ok) {
      publish({ ...store, status: store.body ? "ready" : "failed" });
      return;
    }
    const body = (await response.json()) as PositionsResponse;
    if (store.key !== key) return;
    publish({ key, status: "ready", body, readAt: Date.now() });
  } catch {
    if (store.key === key) publish({ ...store, status: store.body ? "ready" : "failed" });
  } finally {
    if (inflight === key) inflight = null;
  }
}

/** A position as the server judged it, put straight into the page's answer — the watch just turned on, before the next read. */
export function acceptPosition(position: PositionWatchView): void {
  if (!store.body) return;
  const others = store.body.positions.filter((entry) => entry.mint !== position.mint);
  publish({ ...store, body: { ...store.body, positions: [position, ...others] } });
}

export type Positions = Readonly<{
  /** Without a wallet; before its proof; reading; not read; read. */
  phase: "guest" | "unproven" | "loading" | "failed" | "ready";
  body: PositionsResponse | null;
  /** The position of one mint, once read. */
  of: (mint: string) => PositionWatchView | null;
  /** Ask again — only when the answer is older than `maxAgeMs`. */
  reload: (maxAgeMs?: number) => void;
}>;

export function usePositions(): Positions {
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const address = connection?.address ?? null;
  const snapshot = useSyncExternalStore(subscribe, current, initial);
  const proven = proof.state.status === "proven" && proof.state.address === address;
  const key = proven && address ? address : null;

  useEffect(() => {
    if (!key) return;
    if (store.key !== key || store.status === "idle") void load(key);
  }, [key]);

  const reload = useCallback(
    (maxAgeMs = 0) => {
      if (!key) return;
      if (store.key === key && store.status === "ready" && Date.now() - store.readAt < maxAgeMs) return;
      void load(key);
    },
    [key],
  );

  const mine = key !== null && snapshot.key === key;
  const body = mine ? snapshot.body : null;
  const of = useCallback((mint: string) => body?.positions.find((entry) => entry.mint === mint) ?? null, [body]);
  const phase: Positions["phase"] = !address ? "guest" : !proven ? "unproven" : body ? "ready" : mine && snapshot.status === "failed" ? "failed" : "loading";
  return { phase, body, of, reload };
}
