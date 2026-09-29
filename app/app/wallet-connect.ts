"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The wallet sign-in flow, once.
 *
 * It was inside `WalletSignIn`, which is a button. The connection control is
 * not a button — it is a menu with states, an address, capabilities and a
 * panel — and giving it its own copy of "ask for accounts, ask the server for a
 * message, sign it, post it" would have been the second implementation of the
 * one path in this product that mints a session. So the flow moved here and
 * both surfaces report it.
 *
 * Raw EIP-1193 on purpose. A hub has a full provider stack, and pulling
 * it into the sign-in path would make the page a visitor lands on depend on the
 * Hub's connection machinery to render a control. Two JSON-RPC calls is the
 * whole requirement: ask which account, ask for a signature.
 *
 * The client never builds the message. It asks the server for one and signs
 * exactly what it is given — that is what makes every bound in `verifySiwe`
 * real rather than a formality the caller could satisfy for itself.
 */

type Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function provider(): Provider | null {
  const injected = (globalThis as { ethereum?: Provider }).ethereum;
  return injected && typeof injected.request === "function" ? injected : null;
}

/** A wallet's rejection is a decision, not a failure. */
const REJECTED = /user rejected|user denied|4001/i;

export type WalletAction = "signin" | "link";

export type WalletConnect = {
  /** An injected wallet exists on this page. `false` until the browser is read. */
  available: boolean;
  /** A request is open and waiting on the person. */
  busy: boolean;
  /** The connector's own refusal, as a sentence. `null` when it has not refused. */
  error: string | null;
  /** A `link` completed. `signin` navigates instead, so it never sets this. */
  done: boolean;
  run: () => Promise<void>;
};

export function useWalletConnect(
  action: WalletAction = "signin",
  onLinked?: (wallet: string) => void,
): WalletConnect {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  /* Read in an effect, never during render: `globalThis.ethereum` does not
     exist on the server, and a control that guessed would render one thing and
     hydrate into another. */
  useEffect(() => {
    setAvailable(provider() !== null);
  }, []);

  const run = useCallback(async () => {
    const eth = provider();
    if (!eth) {
      setError("No browser wallet found on this page.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts?.[0];
      if (!address) {
        setError("The wallet did not return an address.");
        return;
      }
      const chainIdHex = (await eth.request({ method: "eth_chainId" })) as string;
      const chainId = Number.parseInt(chainIdHex, 16);

      const prepared = await fetch(
        `/api/auth/wallet?address=${encodeURIComponent(address)}&chainId=${chainId}`,
      );
      if (!prepared.ok) {
        setError(
          prepared.status === 400
            ? "This network is not supported for sign-in. Switch to Ethereum."
            : "Sign-in is unavailable right now.",
        );
        return;
      }
      const { message } = (await prepared.json()) as { message: string };

      const signature = (await eth.request({
        method: "personal_sign",
        params: [message, address],
      })) as string;

      const res = await fetch("/api/auth/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature, action }),
      });

      if (res.ok) {
        if (action === "link") {
          const body = (await res.json()) as { wallet: string };
          setDone(true);
          onLinked?.(body.wallet);
        } else {
          /* A full navigation, not a router refresh: the session cookie has
             just changed and every server component on the next page must be
             rendered against it. */
          window.location.assign("/app");
        }
        return;
      }

      if (res.status === 503) {
        /* The wallet-first door is wired and its migration is not applied.
           This used to be a 404 reading "no Ryntra account has proved this
           address yet — sign in through the Telegram bot once", which stopped
           being true with the 2026-08-19 identity decision: an unknown address
           now becomes an account. Saying otherwise would send a person to a
           bot they no longer need. */
        setError("Wallet accounts are not enabled yet. This is a server-side switch, not something your wallet did.");
      } else if (res.status === 409) {
        setError("Another account already proved this address.");
      } else if (res.status === 429) {
        setError("Too many attempts. Wait a minute and try again.");
      } else if (res.status === 401) {
        setError("That signature could not be verified.");
      } else {
        setError("The request could not be completed.");
      }
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(REJECTED.test(text) ? null : "The wallet could not complete the request.");
    } finally {
      setBusy(false);
    }
  }, [action, onLinked]);

  return { available, busy, error, done, run };
}
