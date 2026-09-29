"use client";

/**
 * Your trades, on the surface that makes them.
 *
 * The same wallet-scoped action ledger Home and Activity read, narrowed to the
 * swap lane. Markets does not keep a second record of anything: this is one
 * `POST /api/solana/activity` filtered on the client, so a trade cannot appear
 * here and be missing from the Activity timeline.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { displayAmount } from "@/lib/solana/amounts";
import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { WalletGate } from "../wallet-gate.tsx";
import styles from "./markets.module.css";

const BASE = "/app";

type Leg = Readonly<{ amountRaw: string; decimals: number | null; symbol: string | null }> | null;

type Action = Readonly<{
  actionId: string;
  lane: "SEND" | "SWAP" | "BRIDGE" | "RECEIVE";
  outcome: "DONE" | "IN_FLIGHT" | "NEEDS_YOU" | "FAILED";
  out: Leg;
  in: Leg;
  updatedAt: string;
}>;

function leg(movement: Leg): string | null {
  if (movement === null) return null;
  if (movement.decimals === null) return movement.symbol;
  const amount = displayAmount(movement.amountRaw, movement.decimals);
  return movement.symbol === null ? amount : `${amount} ${movement.symbol}`;
}

export function MarketTrades({ gate = "tiles" }: { gate?: "tiles" | "line" } = {}) {
  const { text } = useSolanaI18n();
  const { connection } = useSolanaConnection();
  const address = connection?.address ?? null;
  const [actions, setActions] = useState<readonly Action[] | null>(null);

  useEffect(() => {
    if (!address) {
      setActions(null);
      return;
    }
    let live = true;
    void fetch("/api/solana/activity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: address, network: "mainnet" }),
    })
      .then((response) => response.json())
      .catch(() => null)
      .then((body) => {
        if (live) setActions(body?.data?.actions ?? []);
      });
    return () => {
      live = false;
    };
  }, [address]);

  /* One connect control per screen. Beside the Swap ticket — which already
     carries the wallet tiles — this panel says what it will hold and offers
     nothing to press; on Markets, where it is the only wallet-scoped panel, it
     is the connect control itself. */
  if (!address) {
    return gate === "tiles" ? (
      <WalletGate title={text("Connect a wallet to see the trades you have made here.")} />
    ) : (
      <div className={styles.empty}>
        <p className={styles.emptyLead}>{text("Connect a wallet to see the trades you have made here.")}</p>
      </div>
    );
  }

  const trades = (actions ?? []).filter((action) => action.lane === "SWAP");

  if (actions !== null && trades.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyLead}>{text("You have not traded here yet.")}</p>
        <Link className="rw-btn rw-btn--primary" href={`${BASE}/swap`}>
          {text("Open Swap")}
        </Link>
      </div>
    );
  }

  return (
    <div className="rw-tablewrap">
      <table className="rw-table">
        <thead>
          <tr>
            <th scope="col">{text("Sold")}</th>
            <th scope="col">{text("Bought")}</th>
            <th scope="col">{text("State")}</th>
            <th scope="col">{text("When")}</th>
            <th scope="col">{text("Receipt")}</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr key={trade.actionId}>
              <th scope="row" className="m" translate="no">
                {leg(trade.out) ?? "—"}
              </th>
              <td className="m" translate="no">
                {leg(trade.in) ?? "—"}
              </td>
              <td>
                <span className={styles.state} data-outcome={trade.outcome}>
                  {trade.outcome === "DONE"
                    ? text("Traded")
                    : trade.outcome === "FAILED"
                      ? text("Did not happen")
                      : trade.outcome === "NEEDS_YOU"
                        ? text("Needs you")
                        : text("On its way")}
                </span>
              </td>
              <td className="m" translate="no">
                {trade.updatedAt.slice(0, 10)}
              </td>
              <td>
                <Link className="so-open" href={`${BASE}/receipts`}>
                  {text("Open")}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
