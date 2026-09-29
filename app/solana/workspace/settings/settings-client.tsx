"use client";

/**
 * The two settings facts only the browser knows.
 *
 * Which wallet is connected, and how many signed receipts this browser is
 * holding. Both are read here rather than described on the server, because the
 * server knows neither and a settings page that guessed at either would be
 * stating something it cannot check.
 */

import Link from "next/link";

import { KeyValue } from "@/app/shell/panel";
import { InfoControl } from "@/app/shell/info-control";
import { readSolanaReceipts } from "@/lib/solana/send-receipt-vault.client";
import { useEffect, useState } from "react";

import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";

function short(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function SettingsWallet() {
  const { text } = useSolanaI18n();
  const { connection } = useSolanaConnection();

  return (
    <>
      <KeyValue label={text("Wallet")}>
        {connection ? (
          <span translate="no">{short(connection.address)}</span>
        ) : (
          text("Not connected")
        )}
      </KeyValue>
      <KeyValue
        label={text("Ryntra's access")}
        hint={
          <InfoControl label={text("What connecting a wallet allows")}>
            <p>
              {text("Connecting lets this workspace read public balances and ask your wallet to show you a transaction. Every signature is yours, given in your own wallet, one transaction at a time. No Ryntra server holds a key and none can move anything on your behalf.")}
            </p>
          </InfoControl>
        }
      >
        {text("Read, and ask you to sign")}
      </KeyValue>
      <KeyValue label={text("Managed in")}>
        <Link className="so-open" href="/app/send">
          {text("Money")}
        </Link>
      </KeyValue>
      <KeyValue
        label={text("Ryntra account")}
        hint={
          <InfoControl label={text("Two separate principals")}>
            <p>
              {text("A Ryntra account and a Solana wallet are separate. Signing in does not authorize anything your wallet does, and connecting a wallet does not sign you in. The account exists for agents, policies and approvals.")}
            </p>
          </InfoControl>
        }
      >
        {text("Separate from your wallet")}
      </KeyValue>
    </>
  );
}

export function SettingsReceipts() {
  const { text } = useSolanaI18n();
  const { connection } = useSolanaConnection();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!connection) {
      setCount(null);
      return;
    }
    try {
      setCount(readSolanaReceipts(window.localStorage, connection.address).length);
    } catch {
      /* A store that cannot be read says nothing. It never says zero: "we could
         not look" and "there are none" are different answers. */
      setCount(null);
    }
  }, [connection]);

  return (
    <>
      <KeyValue label={text("Receipts in this browser")}>
        {count === null ? text("Unknown") : <span translate="no">{count}</span>}
      </KeyValue>
      <KeyValue
        label={text("Kept where")}
        hint={
          <InfoControl label={text("What clearing site data removes")}>
            <p>
              {text("Receipts are stored in this browser, so clearing site data clears them. The signed file you download is the copy that outlives it, and it verifies without trusting this site. What an action did is also recorded against your wallet address on our side, because that much is already public on the chain.")}
            </p>
          </InfoControl>
        }
      >
        {text("This browser")}
      </KeyValue>
      <KeyValue label={text("All of them")}>
        <Link className="so-open" href="/app/receipts">
          {text("Open")}
        </Link>
      </KeyValue>
      <KeyValue label={text("Export your operations")}>
        <Link className="so-open" href="/app/activity">
          {text("Open")}
        </Link>
      </KeyValue>
    </>
  );
}
