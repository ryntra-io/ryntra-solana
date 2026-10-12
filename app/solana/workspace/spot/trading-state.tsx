"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { SolanaWalletAction } from "@/lib/solana/action-ledger";
import { isSpotOrigin } from "@/lib/solana/action-origin";
import { explorerTxUrl } from "@/lib/solana/explorer";
import { WRAPPED_SOL_MINT } from "@/lib/solana/send-kinds";
import type { SpotMarket } from "@/lib/spot/markets";
import type { TokenFacts } from "@/lib/spot/token-page";

import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { formatAmount, formatUsdPrice, rawToNumber } from "./spot-format.ts";
import { TOKEN_TAB_LABELS, TokenTabBody, tokenTabsOf, type TokenTab } from "./token-tabs.tsx";
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
 *
 * The tabs are one list (`tabs` below): the token page's market tabs first — for a stock «Актив», then
 * «Угоди» (who bought, how much, who sells, the capitalisation at the trade),
 * «Холдери», «Ліквідність», «Ризик» and, where the creator lists any,
 * «Соцмережі» — readable without a wallet; then the wallet's own two. A tab a
 * token has nothing for is not drawn.
 */
export type TradingStateTab = "holding" | "fills" | TokenTab;
export function TradingState({
  market,
  facts = null,
  native = false,
  holdings,
  fills,
  pro,
  onRefresh,
}: {
  market: SpotMarket | null;
  /** The token page's facts from Jupiter (`useTokenPart(…, "overview")`), when read. */
  facts?: TokenFacts | null;
  /** SOL: no creator and no holders worth listing. */
  native?: boolean;
  holdings: HoldingsState;
  fills: FillsState;
  pro: boolean;
  onRefresh: () => void;
}) {
  const { text, locale } = useSolanaI18n();
  const { connection } = useSolanaConnection();
  const [tab, setTab] = useState<TradingStateTab>("trades");
  const mint = market?.mint ?? null;
  const owner = connection?.address ?? null;
  const marketTabs = useMemo(() => tokenTabsOf(market, facts, native), [market, facts, native]);
  /* A tab the next token does not have falls back to its first: a stock's «Актив», else «Угоди». */
  useEffect(() => {
    if (tab === "holding" || tab === "fills") return;
    if (marketTabs.length > 0 && !marketTabs.includes(tab)) setTab(marketTabs[0] as TradingStateTab);
  }, [marketTabs, tab]);

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

  const active: TradingStateTab = pro ? tab : "holding";
  const marketTab = active !== "holding" && active !== "fills" && market && marketTabs.includes(active) ? active : null;
  const tabs: readonly Readonly<{ id: TradingStateTab; label: string }>[] = [
    ...marketTabs.map((id) => ({ id, label: text(TOKEN_TAB_LABELS[id]) })),
    { id: "holding", label: text("Holding") },
    { id: "fills", label: `${marketTabs.length > 0 ? text("My trades") : text("Recent fills")}${rows.length > 0 ? ` · ${rows.length}` : ""}` },
  ];

  return (
    <section className={`${styles.panel} ${styles.state}`} aria-label={text("Trading state")} data-token-state>
      {pro ? (
        <div
          className={styles.stateTabs}
          data-dense
          role="tablist"
          data-token-tabs
          onKeyDown={(event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
            const index = tabs.findIndex((entry) => entry.id === tab);
            const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
            if (!next) return;
            event.preventDefault();
            setTab(next.id);
            event.currentTarget.querySelector<HTMLButtonElement>(`[data-state-tab="${next.id}"]`)?.focus();
          }}
        >
          {tabs.map((entry) => (
            <button key={entry.id} type="button" role="tab" id={`state-tab-${entry.id}`} aria-controls="state-panel" tabIndex={tab === entry.id ? 0 : -1} className={styles.stateTab} aria-selected={tab === entry.id} onClick={() => setTab(entry.id)} data-state-tab={entry.id}>
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className={styles.stateBody} id="state-panel" role={pro ? "tabpanel" : undefined} aria-labelledby={pro ? `state-tab-${active}` : undefined}>
        {marketTab && market ? (
          <TokenTabBody key={`${market.mint}:${marketTab}`} tab={marketTab} market={market} facts={facts} owner={owner} />
        ) : null}
        {marketTab ? null : connection && (holdings.status === "unavailable" || holdings.partial || fills.status === "unavailable") ? (
          <p className={styles.note}>
            {holdings.partial ? text("Some balances could not be read.") : holdings.status === "unavailable" ? text("Balances are unavailable right now.") : text("History is unavailable right now.")}
            {" "}<button className={styles.ghost} type="button" onClick={onRefresh}>{text("Read again")}</button>
          </p>
        ) : null}
        {marketTab ? null : !connection ? (
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
