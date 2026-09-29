"use client";

import { useMemo, type ReactNode } from "react";

import { ConnectionControl, type ConnectionCopy } from "@/app/shell/connection-control";
import { connectionCopyFor } from "@/app/shell/connection-copy";
import type { ConnectionAdapter, ConnectionCapability } from "@/app/shell/connection";

import { useWalletConnect } from "./wallet-connect";

/**
 * Ryntra's connection, expressed in the shell's contract.
 *
 * One control for every workspace that shares the Ryntra session — the cabinet,
 * Robinhood Chain and Agent Control today. It lives in `app/app/` because the
 * sign-in flow it drives does, not because it is the cabinet's.
 *
 * This slot used to be `CabinetAccount` — an avatar circle with the first
 * letter of a Telegram name in it. `connection-control.tsx` names that by name
 * as one of the five answers it replaces: *"Home's Telegram avatar standing in
 * for a financial connection"*. A profile picture is an identity and a wallet
 * is an authority, and a control that shows one while meaning the other teaches
 * people that being signed in is the same as being able to spend.
 *
 * **What it reports, and what it deliberately does not claim.**
 *
 * The address here is the one the *account* has proved — through SIWE, against
 * a server-issued single-use nonce, recorded on the row. That is `READ` and
 * `OWNERSHIP_PROVEN` and nothing more. It is emphatically **not** `SIGN_TX`:
 * the cabinet builds no transaction and holds no connection to a chain. Signing
 * happens inside the action lifecycle, on the surfaces that own the exact
 * bytes, and a capability set that guessed otherwise here would be the same
 * false assertion as `NO WALLET` printed above a route that signs — the same
 * mistake, in the other direction.
 *
 * **No network is claimed either.** The cabinet is venue-neutral; the address
 * is the same address on every chain a person uses it on, and there is no
 * single network this workspace requires. `network: null` says that, where a
 * confident chip would say something the surface cannot check.
 */
export function RyntraConnectionControl({
  identityWallet,
  identity,
  copy,
}: {
  /** The address this account has proved, or `null`. */
  identityWallet: string | null;
  /** Ryntra session metadata, shown above the connection inside the panel. */
  identity?: ReactNode;
  copy?: ConnectionCopy;
}) {
  const { available, busy, error, run } = useWalletConnect("signin");

  const adapter = useMemo<ConnectionAdapter>(() => {
    const capabilities: ConnectionCapability[] = [];
    if (identityWallet) capabilities.push("READ", "OWNERSHIP_PROVEN");

    return {
      id: "ryntra",
      snapshot: {
        /* A proved address is itself a connector: the account can be read
           without a wallet extension present on this page at all. Without one,
           availability is whether a wallet could be asked. */
        available: Boolean(identityWallet) || available,
        connecting: busy,
        address: identityWallet,
        /* Nothing to be off. See the note above `network: null`. */
        onExpectedNetwork: true,
        capabilities,
        error,
      },
      network: null,
      connect: identityWallet ? undefined : () => void run(),
      truncate: (value) => `${value.slice(0, 6)}…${value.slice(-4)}`,
    };
  }, [available, busy, error, identityWallet, run]);

  return (
    <ConnectionControl
      adapter={adapter}
      identity={identity}
      manageHref="/app/connect"
      copy={copy ?? connectionCopyFor("en")}
    />
  );
}
