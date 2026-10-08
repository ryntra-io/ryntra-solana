"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { bytesToBase64, signInWithWallet, type SignInInput } from "@/lib/solana/wallet-signin.client";

import { postWalletProof, walletAuthGeneration, announceAccountChange } from "@/lib/account/wallet-auth.client";
import { useSolanaI18n } from "./i18n/provider";

import { useSolanaConnection } from "./connection";

/**
 * Proof of ownership for the connected Solana wallet, as a hook.
 *
 * `prove()` asks the server for a sign-in message, has the wallet sign it and
 * hands the signature back; the server verifies and sets the `rw` proof
 * cookie. `link()` does the same and binds the address to the account signed
 * in right now. The state names exactly what the person has: a connected
 * address is `unproven`, a signature that verified is `proven`, and the
 * cookie's expiry is what the server said.
 */
export type WalletProofState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "unproven" }
  | { status: "proven"; address: string; expiresAt: string | null }
  | { status: "signing" }
  | { status: "refused" | "failed" | "unsupported" | "taken"; reason: string };

export function useWalletProof() {
  const { connection } = useSolanaConnection();
  const { locale } = useSolanaI18n();
  const [state, setState] = useState<WalletProofState>({ status: "idle" });
  const address = connection?.address ?? null;
  const currentAddress = useRef(address);
  currentAddress.current = address;

  /* Is there a live proof for this address? The archive route answers 401
     without one; the check is cheap and never prompts the wallet. */
  const check = useCallback(async () => {
    if (!address) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "checking" });
    try {
      const r = await fetch(`/api/solana/receipts/archive?address=${encodeURIComponent(address)}`);
      if (currentAddress.current !== address) return;
      if (r.status === 401) setState({ status: "unproven" });
      else if (r.ok) setState({ status: "proven", address, expiresAt: null });
      else setState({ status: "unproven" });
    } catch {
      if (currentAddress.current !== address) return;
      setState({ status: "unproven" });
    }
  }, [address]);

  useEffect(() => {
    void check();
  }, [check]);

  const run = useCallback(
    async (action: "prove" | "link" | "signin") => {
      if (!connection) return;
      const generation = walletAuthGeneration();
      const current = () => currentAddress.current === connection.address && walletAuthGeneration() === generation;
      setState({ status: "signing" });
      try {
        const prepared = await fetch(`/api/auth/solana?address=${encodeURIComponent(connection.address)}&action=${action}&locale=${locale === "uk" ? "uk" : "en"}`);
        if (!current()) return false;
        if (!prepared.ok) {
          setState({ status: "failed", reason: prepared.status === 429 ? "Too many attempts. Wait a minute." : "Sign-in is unavailable right now." });
          return;
        }
        const { input, message } = (await prepared.json()) as { input: SignInInput; message: string };
        const signed = await signInWithWallet(connection.wallet, input, message);
        if (!current()) return false;
        if (!signed.ok) {
          setState({ status: signed.state === "REFUSED" ? "refused" : signed.state === "UNSUPPORTED" ? "unsupported" : "failed", reason: signed.reason });
          return;
        }
        if (signed.address !== connection.address) {
          setState({ status: "failed", reason: "Wallet changed. Start sign-in again." });
          return false;
        }
        const res = await postWalletProof({ action, locale: locale === "uk" ? "uk" : "en", address: signed.address,
          signedMessage: bytesToBase64(signed.signedMessage), signature: bytesToBase64(signed.signature) }, generation);
        if (!res || !current()) return false;
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; expiresAt?: string };
        if (res.ok && data.ok) {
          setState({ status: "proven", address: signed.address, expiresAt: data.expiresAt ?? null });
          if (action === "signin") announceAccountChange();
          /* Its own channel, not the account's (that one refreshes the shell):
             the invitation line listens here and binds the moment a wallet is
             proven, on any page. */
          try {
            const proven = new BroadcastChannel("ryntra-wallet-proven");
            proven.postMessage(signed.address);
            proven.close();
          } catch {
            /* No BroadcastChannel: the line binds on the next page instead. */
          }
          return true;
        }
        if (res.status === 409) setState({ status: "taken", reason: "Another account already linked this wallet." });
        else if (res.status === 401 && action === "link") setState({ status: "failed", reason: "Sign in to your account first, then link the wallet." });
        else setState({ status: "failed", reason: "That signature could not be verified." });
      } catch {
        if (!current()) return false;
        setState({ status: "failed", reason: "The request could not be completed." });
      }
    },
    [connection, locale],
  );

  return {
    address,
    state,
    prove: () => run("prove"),
    signIn: () => run("signin"),
    link: () => run("link"),
    recheck: check,
  };
}
