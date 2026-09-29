"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { StellarNetwork } from "@/lib/stellar/network";
import type { StellarWalletAdapter, StellarWalletConnection } from "@/lib/stellar/wallets/adapter";
import { StellarWalletError } from "@/lib/stellar/wallets/adapter";
import { resolveState, walletEntry } from "@/lib/stellar/wallets/registry";
import { WALLET_COPY, stateForError, type StellarWalletState } from "@/lib/stellar/wallets/states";

/**
 * The wallet's state, held in one place and derived from facts.
 *
 * **Nothing here is imported by a server component**, and the adapter itself is
 * loaded only when someone presses connect — so the whole public read surface,
 * the Asset Passport included, ships without a wallet package. That is the
 * property `wallets.test.mjs` asserts rather than trusts.
 *
 * The state is recomputed from installed/address/network rather than tracked by
 * hand, because a stored `connected` flag and a wallet that changed network in
 * another tab disagree silently — and the disagreement only becomes visible at
 * the moment someone signs.
 *
 * There is no auto-connect. A wallet prompt that appears because a page loaded
 * is a permission request nobody asked for; connection happens on a gesture.
 */

/**
 * Which network the wallet must be on — declared by whoever mounts this, never
 * assumed here.
 *
 * It used to be the constant `STELLAR_MAINNET`, chosen when every Stellar
 * surface read mainnet and none of them signed. The moment `/authorize`
 * shipped, that constant inverted the guard it exists to be: a wallet on
 * mainnet passed the check and then produced a signature our comparison had to
 * reject *after* the person approved it in Freighter, and a wallet correctly on
 * testnet was told **"Wrong Stellar network"** and blocked from signing the
 * transaction the page had just built for it.
 *
 * The exact failure `states.ts` warns about in writing — *"a wallet pointed at
 * mainnet will happily sign a transaction built for testnet"* — was being
 * enforced backwards one file away from the warning.
 *
 * A prop rather than a fixed value, because the answer belongs to the surface
 * that signs. `lib/stellar/wallets/wallets.test.mjs` asserts the mount and the
 * signing surface name the same network, so they cannot drift apart again.
 */

type WalletContextValue = Readonly<{
  state: StellarWalletState;
  copy: (typeof WALLET_COPY)[StellarWalletState];
  address: string | null;
  walletName: string;
  installUrl: string;
  expectedNetwork: string;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}>;

const WalletContext = createContext<WalletContextValue | null>(null);

export function useStellarWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useStellarWallet must be used inside StellarWalletProvider.");
  return value;
}

export function StellarWalletProvider({ expected, children }: { expected: StellarNetwork; children: ReactNode }) {
  const entry = walletEntry("freighter");

  const [installed, setInstalled] = useState(false);
  const [connection, setConnection] = useState<StellarWalletConnection | null>(null);
  const [busy, setBusy] = useState<"connecting" | "signing" | null>(null);
  const [failure, setFailure] = useState<StellarWalletState | null>(null);

  /* Availability only. Detecting an extension is not connecting to it, and this
     is the one call the package times out on its own. */
  useEffect(() => {
    let live = true;
    void (async () => {
      const adapter: StellarWalletAdapter = await entry.load();
      const found = await adapter.isAvailable();
      if (live) setInstalled(found);
    })();
    return () => {
      live = false;
    };
  }, [entry]);

  const connect = useCallback(async () => {
    setFailure(null);
    setBusy("connecting");
    try {
      const adapter = await entry.load();
      setConnection(await adapter.connect());
    } catch (error) {
      /* A refusal and a missing extension are different situations with
         different next steps; only an unrecognised error is a fault. */
      setFailure(error instanceof StellarWalletError ? stateForError(error.code) : "UNAVAILABLE");
      setConnection(null);
    } finally {
      setBusy(null);
    }
  }, [entry]);

  const disconnect = useCallback(async () => {
    const adapter = await entry.load();
    await adapter.disconnect();
    setConnection(null);
    setFailure("DISCONNECTED");
  }, [entry]);

  const state = useMemo<StellarWalletState>(() => {
    if (failure && !busy) return failure;
    return resolveState({
      installed,
      address: connection?.address ?? null,
      walletNetwork: connection,
      expected,
      busy,
    });
  }, [failure, busy, installed, connection, expected]);

  const value = useMemo<WalletContextValue>(
    () => ({
      state,
      copy: WALLET_COPY[state],
      address: connection?.address ?? null,
      walletName: entry.name,
      installUrl: entry.installUrl,
      expectedNetwork: expected.label,
      connect,
      disconnect,
    }),
    [state, connection, entry, expected, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
