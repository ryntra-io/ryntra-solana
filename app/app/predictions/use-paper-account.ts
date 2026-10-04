"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import type { PredictionPlan } from "@/lib/predictions/plan-model";
import type { PaperAccountView } from "@/lib/predictions/paper";
import type { WatchEntry } from "@/lib/predictions/watchlist";
import { bytesToBase64, signMessageWithWallet } from "@/lib/solana/wallet-signin.client";

/**
 * The paper account as the browser sees it: one read of
 * `/api/predictions/account`, the link flow (the server's message → one
 * wallet signature → the server's verify), the revoke, and a re-read on
 * demand. The browser never sees a provider token: the answer is a link
 * state and the account's figures.
 *
 * `guest` — no proven wallet on this site (the person signs in with the
 * wallet first, through the shell's own control); `ready` — the account as
 * the server states it, linked or not.
 */

export type AccountData = PaperAccountView & Readonly<{ wallet: string; watchlist: readonly WatchEntry[]; plans: readonly PredictionPlan[] }>;

export type AccountState =
  | Readonly<{ status: "loading"; account: null }>
  | Readonly<{ status: "guest"; account: null }>
  | Readonly<{ status: "ready"; account: AccountData }>
  | Readonly<{ status: "failed"; account: AccountData | null; code: string }>;

export type LinkFlow = Readonly<{ status: "idle" }> | Readonly<{ status: "signing" }> | Readonly<{ status: "verifying" }> | Readonly<{ status: "failed"; code: string; reason: string }>;

type ApiFailure = { error?: { code?: string; message?: string } };

export function usePaperAccount(): Readonly<{
  state: AccountState;
  link: LinkFlow;
  proven: boolean;
  address: string | null;
  refresh: () => Promise<void>;
  enable: () => Promise<boolean>;
  disable: () => Promise<void>;
  prove: () => Promise<boolean | void>;
}> {
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const address = connection?.address ?? null;
  const proven = proof.state.status === "proven" && proof.state.address === address;
  const [state, setState] = useState<AccountState>({ status: "loading", account: null });
  const [link, setLink] = useState<LinkFlow>({ status: "idle" });
  const current = useRef<string | null>(null);

  /* The server decides who is asking (the proof cookie, or the phone's bearer):
     the read is made regardless of what the browser knows about the wallet, a
     401 is the guest state, and an answer for a wallet other than the one the
     browser shows is dropped — a wallet switch re-reads. */
  const refresh = useCallback(async () => {
    const wallet = address;
    current.current = wallet;
    try {
      const response = await fetch("/api/predictions/account", { headers: { accept: "application/json" }, cache: "no-store" });
      if (current.current !== wallet) return;
      if (response.status === 401) {
        setState({ status: "guest", account: null });
        return;
      }
      const body = (await response.json()) as AccountData | ApiFailure;
      if (!response.ok) {
        setState((prev) => ({ status: "failed", account: prev.account, code: (body as ApiFailure).error?.code ?? "UNAVAILABLE" }));
        return;
      }
      const data = body as AccountData;
      if (wallet && data.wallet !== wallet) {
        setState({ status: "guest", account: null });
        return;
      }
      setState({ status: "ready", account: data });
    } catch {
      if (current.current !== wallet) return;
      setState((prev) => ({ status: "failed", account: prev.account, code: "NETWORK" }));
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh, proven]);

  const enable = useCallback(async (): Promise<boolean> => {
    if (!connection) {
      setLink({ status: "failed", code: "NO_WALLET", reason: "" });
      return false;
    }
    setLink({ status: "signing" });
    try {
      const started = await fetch("/api/predictions/link/start", { method: "POST", headers: { accept: "application/json" }, cache: "no-store" });
      const challenge = (await started.json()) as { message?: string } & ApiFailure;
      if (!started.ok || !challenge.message) {
        setLink({ status: "failed", code: challenge.error?.code ?? "UNAVAILABLE", reason: challenge.error?.message ?? "" });
        return false;
      }
      const signed = await signMessageWithWallet(connection.wallet, connection.address, challenge.message);
      if (!signed.ok) {
        setLink({ status: "failed", code: signed.state, reason: signed.reason });
        return false;
      }
      setLink({ status: "verifying" });
      const verified = await fetch("/api/predictions/link/verify", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ message: challenge.message, signature: bytesToBase64(signed.signature), encoding: "base64" }),
      });
      const outcome = (await verified.json()) as ApiFailure;
      if (!verified.ok) {
        setLink({ status: "failed", code: outcome.error?.code ?? "UNAVAILABLE", reason: outcome.error?.message ?? "" });
        return false;
      }
      setLink({ status: "idle" });
      await refresh();
      return true;
    } catch {
      setLink({ status: "failed", code: "NETWORK", reason: "" });
      return false;
    }
  }, [connection, refresh]);

  const disable = useCallback(async () => {
    await fetch("/api/predictions/link/revoke", { method: "POST", headers: { accept: "application/json" } }).catch(() => null);
    await refresh();
  }, [refresh]);

  return { state, link, proven, address, refresh, enable, disable, prove: proof.prove };
}
