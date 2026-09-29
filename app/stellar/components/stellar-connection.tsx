"use client";

import { useMemo } from "react";

import type { ConnectionAdapter, ConnectionCapability } from "@/app/shell/connection";
import { ConnectionControl, DEFAULT_COPY } from "@/app/shell/connection-control";
import { STELLAR_NETWORKS } from "@/lib/stellar/network";
import { useStellarWallet } from "./stellar-wallet-provider.tsx";

/**
 * Stellar's connection, expressed in the shell's contract.
 *
 * The provider is untouched — it still owns detection, the connect gesture, the
 * network check and disconnect, and it still refuses to auto-connect. This maps
 * its twelve-value state onto the shell's seven and hands over a snapshot.
 *
 * The mapping is where the honesty is. Stellar's states describe a *session*
 * (`SIGNING`, `SIGNED`, `SIGNATURE_REJECTED`) as well as a connection, and the
 * shell's contract is only about connection. So `SIGNING` becomes
 * `ACTION_PENDING` — an authorization is open and nothing proceeds until the
 * person answers it — while `SIGNED` is just connected again, because a
 * completed signature says nothing about the wallet's current state.
 *
 * `SWITCH_NETWORK` is deliberately absent from the capabilities. Freighter
 * cannot be told to change network by a page; the person changes it in the
 * extension. Reporting the capability would have produced a button that opens
 * nothing, which is exactly the failure the contract's "absent means absent"
 * rule exists to prevent.
 */
export function StellarConnectionControl() {
  const { state, copy, address, walletName, installUrl, expectedNetwork, connect, disconnect } =
    useStellarWallet();

  const adapter = useMemo<ConnectionAdapter>(() => {
    const capabilities: ConnectionCapability[] = [];
    if (address) capabilities.push("READ", "OWNERSHIP_PROVEN", "SIGN_TX");

    const network =
      STELLAR_NETWORKS.find((entry) => entry.passphrase === expectedNetwork) ??
      STELLAR_NETWORKS.find((entry) => entry.label === expectedNetwork) ??
      null;

    return {
      id: "stellar",
      snapshot: {
        /* An extension that is not installed is not a connector. Every other
           state means one is present, whatever it is currently doing. */
        available: state !== "NOT_INSTALLED" && state !== "UNAVAILABLE",
        connecting: state === "CONNECTING",
        address,
        onExpectedNetwork: state !== "WRONG_NETWORK",
        capabilities,
        actionPending: state === "SIGNING",
        /* The wallet's own refusals, in its own words. `LOCKED` is one: an
           extension that is installed and locked has refused, and saying so
           beats a connect button that silently does nothing. */
        error:
          state === "ACCESS_DENIED" || state === "SIGNATURE_REJECTED" || state === "LOCKED"
            ? (copy.body ?? copy.title)
            : null,
      },
      network: network
        ? {
            label: network.label,
            explorerAddressUrl: (value) => `${network.explorerBase}/account/${value}`,
          }
        : { label: expectedNetwork },
      connect,
      disconnect: () => void disconnect(),
      truncate: (value) => `${value.slice(0, 4)}…${value.slice(-4)}`,
    };
  }, [address, connect, copy, disconnect, expectedNetwork, state]);

  /* Not installed is not "connect failed" — it is a different answer, and the
     one action it allows is an install link rather than a button that cannot
     work. The panel says so instead of offering the gesture. */
  const notInstalled = state === "NOT_INSTALLED";

  return (
    <ConnectionControl
      adapter={adapter}
      manageHref="/stellar/workspace/settings"
      copy={{
        ...DEFAULT_STELLAR_COPY,
        unavailableTitle: `${walletName} is not installed`,
        unavailableBody: notInstalled
          ? `Install ${walletName} to connect. Every read surface in this workspace works without it.`
          : DEFAULT_STELLAR_COPY.unavailableBody,
        manage: installUrl && notInstalled ? `Install ${walletName}` : DEFAULT_STELLAR_COPY.manage,
      }}
    />
  );
}


/** English, and Stellar-specific only where the default would be wrong. */
const DEFAULT_STELLAR_COPY = {
  ...DEFAULT_COPY,
  disconnectedBody:
    "Connecting reads your balances and trustlines. Nothing is signed until you authorize it.",
  capSignTx: "Sign transactions",
};
