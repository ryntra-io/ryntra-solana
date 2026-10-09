"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { SolanaWalletAction } from "@/lib/solana/action-ledger";
import { isSpotOrigin } from "@/lib/solana/action-origin";
import { explorerTxUrl } from "@/lib/solana/explorer";
import { WRAPPED_SOL_MINT } from "@/lib/solana/send-kinds";
import type { SpotMarket } from "@/lib/spot/markets";

import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { formatAmount, formatUsdPrice, rawToNumber } from "./spot-format.ts";
import type { FillsState, HoldingsState, SpotHolding } from "./use-spot-data.ts";

import styles from "./spot.module.css";

function movementText(movement: SolanaWalletAction["out"], locale: string): string | null {
  if (!movement || movement.decimals === null) return null;
  const value = rawToNumber(movement.amountRaw, movement.decimals);
  if (value === null) return null;
  return `${formatAmount(value, locale)} ${movement.symbol ?? ""}`.trim();
}

/**
 * What the wallet has done and holds in the selected market.
 *
 * Fills are the wallet's own Activity rows from the swap lane, newest first,
 * kept to the ones that touch this market; a Spot row says which side it was.
 * The holding is the wallet's balance of the asset, priced from the market's
 * live figure. Neither is a second Portfolio — that page has the whole picture
 * and is one link away.
 */
export function TradingState({
  market,
  holdings,
  fills,
  pro,
  onRefresh,
}: {
  market: SpotMarket | null;
  holdings: HoldingsState;
  fills: FillsState;
  pro: boolean;
  onRefresh: () => void;
}) {
  const { text, locale } = useSolanaI18n();
  const { connection } = useSolanaConnection();
  const [tab, setTab] = useState<"holding" | "fills">("holding");
  const mint = market?.mint ?? null;

  const holding = useMemo<SpotHolding | null>(() => {
    if (!mint || !holdings.value) return null;
    if (mint === WRAPPED_SOL_MINT) return holdings.value.find((row) => row.kind === "NATIVE_SOL") ?? null;
    return holdings.value.find((row) => row.mint === mint) ?? null;
  }, [holdings, mint]);
  const amount = holding ? rawToNumber(holding.amountRaw, holding.decimals) : null;
  const valueUsd = amount !== null && market?.price !== null && market?.price !== undefined ? amount * market.price : null;
  const walletUsd = useMemo(() => {
    if (!holdings.value) return null;
    let total = 0;
    let priced = false;
    for (const row of holdings.value) {
      const price = row.catalog?.usdPrice ? Number(row.catalog.usdPrice) : null;
      const rowAmount = rawToNumber(row.amountRaw, row.decimals);
      if (price === null || rowAmount === null || !Number.isFinite(price)) continue;
      total += rowAmount * price;
      priced = true;
    }
    return priced ? total : null;
  }, [holdings.value]);
  const share = valueUsd !== null && walletUsd !== null && walletUsd > 0 ? (valueUsd / walletUsd) * 100 : null;

  const rows = useMemo(() => {
    if (!fills.value || !mint) return [];
    return fills.value.filter((action) => action.out?.mint === mint || action.in?.mint === mint).slice(0, 10);
  }, [fills.value, mint]);

  const active = pro ? tab : "holding";

  return (
    <section className={`${styles.panel} ${styles.state}`} aria-label={text("Trading state")}>
      {pro ? (
        <div className={styles.stateTabs} data-dense role="tablist">
          <button type="button" role="tab" className={styles.stateTab} aria-selected={tab === "holding"} onClick={() => setTab("holding")}>{text("Holding")}</button>
          <button type="button" role="tab" className={styles.stateTab} aria-selected={tab === "fills"} onClick={() => setTab("fills")}>
            {text("Recent fills")}{rows.length > 0 ? ` · ${rows.length}` : ""}
          </button>
        </div>
      ) : null}
      <div className={styles.stateBody}>
        {connection && (holdings.status === "unavailable" || holdings.partial || fills.status === "unavailable") ? (
          <p className={styles.note}>
            {holdings.partial ? text("Some balances could not be read.") : holdings.status === "unavailable" ? text("Balances are unavailable right now.") : text("History is unavailable right now.")}
            {" "}<button className={styles.ghost} type="button" onClick={onRefresh}>{text("Read again")}</button>
          </p>
        ) : null}
        {!connection ? (
          <div className={styles.empty}>
            <span>{text("Connect a wallet to see what you hold and what you have traded here.")}</span>
          </div>
        ) : active === "holding" ? (
          holdings.status === "unavailable" && !holding ? (
            <div className={styles.empty}><span>{text("Balances are unavailable right now.")}</span></div>
          ) : holdings.status === "loading" && !holdings.value ? (
            <div className={styles.empty}><span>{text("Reading balances…")}</span></div>
          ) : !holding && holdings.partial ? (
            <div className={styles.empty}><span>{text("Some balances could not be read.")}</span></div>
          ) : !holding || amount === null || amount === 0 ? (
            <div className={styles.empty}>
              <span>{market ? `${text("You do not hold")} ${market.symbol} ${text("yet.")}` : text("Pick a market.")}</span>
            </div>
          ) : (
            <dl className={styles.holdingGrid}>
              <div>
                <dt>{text("You hold")}</dt>
                <dd>{formatAmount(amount, locale)} {market?.symbol ?? holding.symbol ?? ""}</dd>
              </div>
              <div>
                <dt>{text("Value")}</dt>
                <dd>{valueUsd === null ? "—" : formatUsdPrice(valueUsd, locale)}</dd>
              </div>
              <div>
                <dt>{text("Of wallet")}</dt>
                <dd>{share === null ? "—" : `${share.toFixed(1)}%`}</dd>
              </div>
              <div>
                <dt>{text("Portfolio")}</dt>
                <dd><Link className={styles.ghost} href="/app/portfolio">{text("Open")} →</Link></dd>
              </div>
            </dl>
          )
        ) : fills.status === "unavailable" && rows.length === 0 ? (
          <div className={styles.empty}><span>{text("History is unavailable right now.")}</span></div>
        ) : fills.status === "loading" && !fills.value ? (
          <div className={styles.empty}><span>{text("Reading fills…")}</span></div>
        ) : rows.length === 0 ? (
          <div className={styles.empty}><span>{market ? `${text("No fills in")} ${market.symbol} ${text("from this wallet yet.")}` : text("Pick a market.")}</span></div>
        ) : (
          <table className={styles.fills}>
            <thead>
              <tr>
                <th scope="col">{text("When")}</th>
                <th scope="col">{text("What")}</th>
                <th scope="col">{text("Paid")}</th>
                <th scope="col">{text("Received")}</th>
                <th scope="col">{text("State")}</th>
                <th scope="col"><span className="sr-only">{text("Explorer")}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((action) => {
                const origin = action.origin;
                const what = isSpotOrigin(origin) ? (origin.side === "BUY" ? text("Spot Buy") : text("Spot Sell")) : text("Swap");
                const state = action.outcome === "DONE" ? text("Filled") : action.outcome === "FAILED" ? text("Did not happen") : action.outcome === "NEEDS_YOU" ? text("Needs you") : text("In flight");
                return (
                  <tr key={action.actionId}>
                    <td data-mono="true">{new Date(action.updatedAt).toLocaleString(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td>{what}</td>
                    <td data-mono="true">{movementText(action.out, locale) ?? "—"}</td>
                    <td data-mono="true">{movementText(action.in, locale) ?? "—"}</td>
                    <td>{state}</td>
                    <td>{action.signature ? <a href={explorerTxUrl("mainnet", action.signature)} target="_blank" rel="noreferrer noopener">{text("Explorer")}</a> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
