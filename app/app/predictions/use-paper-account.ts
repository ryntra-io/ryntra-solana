"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PredictionPlan } from "@/lib/predictions/plan-model";
import type { PaperAccountView } from "@/lib/predictions/paper";
import type { WatchEntry } from "@/lib/predictions/watchlist";

import { usePredictionsWallet } from "./surface";

/**
 * The paper account as the browser sees it: one read of
 * `/api/predictions/account`, the link flow (the server's message → one
 * wallet signature → the server's verify; under load the provider's bot
 * check first, and the same start again with its token), the revoke, and
 * a re-read on demand. The browser never sees a provider token: the answer is a link
 * state and the account's figures.
 *
 * `guest` — no proven wallet on this site (the person signs in with the
 * wallet first, through the shell's own control); `ready` — the account as
 * the server states it, linked or not. The wallet is the shell's
 * (`surface.tsx`): the Solana wallet the cabinet connected.
 */

export type AccountData = PaperAccountView & Readonly<{ wallet: string; watchlist: readonly WatchEntry[]; plans: readonly PredictionPlan[] }>;

export type AccountState =
  | Readonly<{ status: "loading"; account: null }>
  | Readonly<{ status: "guest"; account: null }>
  | Readonly<{ status: "ready"; account: AccountData }>
  | Readonly<{ status: "failed"; account: AccountData | null; code: string }>;

/** `challenge` — the provider wants its bot check before the sign-in starts; `round` counts the checks shown, so a refused token draws a fresh box. */
export type LinkFlow =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "challenge"; siteKey: string; round: number }>
  | Readonly<{ status: "signing" }>
  | Readonly<{ status: "verifying" }>
  | Readonly<{ status: "failed"; code: string; reason: string }>;

type ApiFailure = { error?: { code?: string; message?: string; siteKey?: string } };

/** `skip`: a component handed the account by its page reads nothing itself (one read per page, not one per panel). */
export function usePaperAccount(options: Readonly<{ skip?: boolean }> = {}): Readonly<{
  state: AccountState;
  link: LinkFlow;
  proven: boolean;
  address: string | null;
  refresh: () => Promise<void>;
  enable: (turnstileToken?: string) => Promise<boolean>;
  challengeFailed: (why: "failed" | "blocked") => void;
  cancelChallenge: () => void;
  disable: () => Promise<void>;
  prove: () => Promise<boolean | void>;
  connect: (() => void) | null;
}> {
  const wallet = usePredictionsWallet();
  const address = wallet.address;
  const proven = wallet.proven;
  const [state, setState] = useState<AccountState>({ status: "loading", account: null });
  const [link, setLink] = useState<LinkFlow>({ status: "idle" });
  const current = useRef<string | null>(null);
  const rounds = useRef(0);

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

  const skip = options.skip === true;
  useEffect(() => {
    if (skip) return;
    void refresh();
  }, [refresh, proven, skip]);

  /* `turnstileToken` — the bot check's answer, when the last start asked for one: the same start is sent again with it. */
  const enable = useCallback(async (turnstileToken?: string): Promise<boolean> => {
    if (!wallet.address) {
      setLink({ status: "failed", code: "NO_WALLET", reason: "" });
      return false;
    }
    setLink({ status: "signing" });
    try {
      const started = await fetch("/api/predictions/link/start", {
        method: "POST",
        headers: turnstileToken ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" },
        body: turnstileToken ? JSON.stringify({ turnstileToken }) : undefined,
        cache: "no-store",
      });
      const challenge = (await started.json()) as { message?: string } & ApiFailure;
      /* Asked again after a token: the server says CHALLENGE_FAILED; should it ever ask again instead, it is the same refusal, never a new round. */
      if (challenge.error?.code === "CHALLENGE_REQUIRED" && turnstileToken) {
        setLink({ status: "failed", code: "CHALLENGE_FAILED", reason: "" });
        return false;
      }
      if (challenge.error?.code === "CHALLENGE_REQUIRED" && challenge.error.siteKey) {
        rounds.current += 1;
        setLink({ status: "challenge", siteKey: challenge.error.siteKey, round: rounds.current });
        return false;
      }
      if (!started.ok || !challenge.message) {
        setLink({ status: "failed", code: challenge.error?.code ?? "UNAVAILABLE", reason: challenge.error?.message ?? "" });
        return false;
      }
      const signed = await wallet.sign(challenge.message);
      if (!signed.ok) {
        setLink({ status: "failed", code: signed.code, reason: signed.reason });
        return false;
      }
      setLink({ status: "verifying" });
      const verified = await fetch("/api/predictions/link/verify", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ message: challenge.message, signature: signed.signature, encoding: signed.encoding }),
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
  }, [wallet, refresh]);

  /* The check could not be shown or did not pass: nothing was started, the person may try again. */
  const challengeFailed = useCallback((why: "failed" | "blocked") => setLink({ status: "failed", code: why === "blocked" ? "CHALLENGE_BLOCKED" : "CHALLENGE_FAILED", reason: "" }), []);

  /* The person leaves the check: nothing was started, the card offers the sign-in again. */
  const cancelChallenge = useCallback(() => setLink({ status: "idle" }), []);

  const disable = useCallback(async () => {
    await fetch("/api/predictions/link/revoke", { method: "POST", headers: { accept: "application/json" } }).catch(() => null);
    await refresh();
  }, [refresh]);

  return { state, link, proven, address, refresh, enable, challengeFailed, cancelChallenge, disable, prove: wallet.prove, connect: wallet.connect };
}
