"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import type { PortfolioRiskResponse } from "@/lib/api/v1/contract";

/**
 * «Ризик портфеля» of the wallet, read for Home (`GET /api/v1/positions/risk`,
 * contract 1.23.0): the server's one word for the wallet as a whole, with
 * every rule broken or what could not be read. Behind the wallet's proof —
 * the verdict stands on the wallet's own exits — and kept per wallet, so a
 * return to Home within a minute draws it at once and reads it again behind.
 */

/* `expired`: the route answered 401 — the proof the page held has lapsed; the person confirms again rather than retrying into the same refusal. */
type Store = Readonly<{ key: string | null; status: "idle" | "loading" | "ready" | "failed" | "expired"; body: PortfolioRiskResponse | null; readAt: number }>;

const EMPTY: Store = { key: null, status: "idle", body: null, readAt: 0 };
/** How long a verdict is drawn without a new read. */
const FRESH_MS = 60_000;
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
  else publish({ ...store, status: "loading" });
  try {
    const response = await fetch("/api/v1/positions/risk", { headers: { accept: "application/json", "X-Ryntra-API": "1" } });
    if (store.key !== key) return;
    if (!response.ok) {
      publish({ ...store, status: response.status === 401 ? "expired" : "failed" });
      return;
    }
    const body = (await response.json()) as PortfolioRiskResponse;
    if (store.key !== key) return;
    publish({ key, status: "ready", body, readAt: Date.now() });
  } catch {
    if (store.key === key) publish({ ...store, status: "failed" });
  } finally {
    if (inflight === key) inflight = null;
  }
}

export type PortfolioRiskRead = Readonly<{
  /** Without a wallet; before its proof; reading (with the last verdict, if any); not read; read. */
  phase: "guest" | "unproven" | "loading" | "failed" | "ready";
  body: PortfolioRiskResponse | null;
  /** Ask again now. */
  reload: () => void;
  /** The wallet's proof — a signature, nothing moved. */
  prove: () => void;
  signing: boolean;
}>;

export function usePortfolioRisk(): PortfolioRiskRead {
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const address = connection?.address ?? null;
  const snapshot = useSyncExternalStore(subscribe, current, initial);
  const proven = proof.state.status === "proven" && proof.state.address === address;
  const key = proven && address ? address : null;

  useEffect(() => {
    if (!key) return;
    if (store.key !== key || store.status === "idle" || (store.status !== "loading" && Date.now() - store.readAt > FRESH_MS)) void load(key);
  }, [key]);

  const reload = useCallback(() => {
    if (key) void load(key);
  }, [key]);
  /* A signature, then the verdict read again for the wallet it proved. */
  const prove = useCallback(() => {
    void proof.prove().then((proved) => {
      if (proved && address) void load(address);
    });
  }, [proof, address]);

  const mine = key !== null && snapshot.key === key;
  /* A lapsed proof draws no verdict it can no longer vouch for. */
  const body = mine && snapshot.status !== "expired" ? snapshot.body : null;
  /* While the proof is being looked up nothing is asked of the person: the line waits as it does for the verdict. */
  const checking = proof.state.status === "idle" || proof.state.status === "checking";
  const expired = mine && snapshot.status === "expired";
  const phase: PortfolioRiskRead["phase"] = !address ? "guest" : checking ? "loading" : !proven || expired ? "unproven" : mine && snapshot.status === "ready" ? "ready" : mine && snapshot.status === "failed" ? "failed" : "loading";
  return { phase, body, reload, prove, signing: proof.state.status === "signing" };
}
