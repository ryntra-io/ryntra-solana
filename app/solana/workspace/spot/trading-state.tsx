"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { SolanaWalletAction } from "@/lib/solana/action-ledger";
import { isSpotOrigin } from "@/lib/solana/action-origin";
import { explorerTxUrl } from "@/lib/solana/explorer";
import { WRAPPED_SOL_MINT } from "@/lib/solana/send-kinds";
import type { SpotMarket } from "@/lib/spot/markets";
import type { TokenFacts } from "@/lib/spot/token-page";

import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { ConnectWalletButton } from "../wallet-gate.tsx";
import { openLimitCount } from "./limit-orders-view.ts";
import { MyOrders } from "./my-orders.tsx";
import { formatAmount, formatUsdPrice, rawToNumber } from "./spot-format.ts";
import { TOKEN_TAB_LABELS, TokenTabBody, tokenTabsOf, type TokenTab } from "./token-tabs.tsx";
import type { LimitOrdersRead } from "./use-limit-orders.ts";
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
 * «Соцмережі» — readable without a wallet; «Аналітика» — what the market did on
 * the chain; then, after a rule, the account's own: «Ордери (n) · Позиція ·
 * Історія» (B16), one «Мої» on a phone. A tab a token has nothing for is not
 * drawn.
 */
export type TradingStateTab = "holding" | "fills" | "orders" | "mine" | "analytics" | TokenTab;
export function TradingState({
  market,
  facts = null,
  native = false,
  holdings,
  fills,
  limits = null,
  pro,
  onRefresh,
  analytics = null,
  phone = false,
}: {
  market: SpotMarket | null;
  /** The token page's facts from Jupiter (`useTokenPart(…, "overview")`), when read. */
  facts?: TokenFacts | null;
  /** SOL: no creator and no holders worth listing. */
  native?: boolean;
  holdings: HoldingsState;
  fills: FillsState;
  /** The wallet's limit orders, the Spot workspace's one read: «Мої ордери» and its count. */
  limits?: LimitOrdersRead | null;
  pro: boolean;
  onRefresh: () => void;
  /** «Аналітика»: what the market did on the chain, on request (B16: a tab of the panel rather than a card under the chart). */
  analytics?: ReactNode;
  /** A phone's segment: the account's three as one «Мої». */
  phone?: boolean;
}) {
  const { text } = useSolanaI18n();
  const { connection } = useSolanaConnection();
  const [tab, setTab] = useState<TradingStateTab>("trades");
  const mint = market?.mint ?? null;
  const owner = connection?.address ?? null;
  const marketTabs = useMemo(() => tokenTabsOf(market, facts, native), [market, facts, native]);
  /* A tab the next token does not have falls back to its first: a stock's «Актив», else «Угоди». */
  useEffect(() => {
    if (tab === "holding" || tab === "fills" || tab === "orders" || tab === "mine" || tab === "analytics") return;
    if (marketTabs.length > 0 && !marketTabs.includes(tab)) setTab(marketTabs[0] as TradingStateTab);
  }, [marketTabs, tab]);

  const account = useAccountViews({ market, holdings, fills, limits, onRefresh });
  const { rows, guestLine, readNote, holdingView, fillsView } = account;
  const ordersCount = limits ? openLimitCount(limits.orders) : 0;
  /* The account's three, each with its count (B16): what waits, what is held, what was done. On a phone they are one
     «Мої» — the segment keeps four places. */
  const accountTabs: readonly Readonly<{ id: TradingStateTab; label: string }>[] = phone
    ? [{ id: "mine", label: `${text("Mine")}${ordersCount > 0 ? ` · ${ordersCount}` : ""}` }]
    : [
        /* B3: the wallet's limit orders at Jupiter and on DLMM, with «Скасувати» and «Забрати». */
        { id: "orders", label: `${text("Orders")}${ordersCount > 0 ? ` · ${ordersCount}` : ""}` },
        { id: "holding", label: text("Position") },
        { id: "fills", label: `${text("History")}${rows.length > 0 ? ` · ${rows.length}` : ""}` },
      ];
  const marketEntries: readonly Readonly<{ id: TradingStateTab; label: string }>[] = [
    ...marketTabs.map((id) => ({ id: id as TradingStateTab, label: text(TOKEN_TAB_LABELS[id]) })),
    ...(analytics ? [{ id: "analytics" as const, label: text("Analytics") }] : []),
  ];
  /* A phone's segment: the trades, the holders and the risk, then «Мої»; the rest of the market's tabs after them. */
  const PHONE_FIRST: readonly TradingStateTab[] = ["asset", "trades", "holders", "risk"];
  const tabs = phone
    ? [...marketEntries.filter((entry) => PHONE_FIRST.includes(entry.id)), ...accountTabs, ...marketEntries.filter((entry) => !PHONE_FIRST.includes(entry.id))]
    : [...marketEntries, ...accountTabs];
  const accountIds = new Set(accountTabs.map((entry) => entry.id));

  /* A tab of the other width's set: the account's three on a desk are one «Мої» on a phone, and back. */
  const shown: TradingStateTab = phone && (tab === "holding" || tab === "fills" || tab === "orders") ? "mine" : !phone && tab === "mine" ? "holding" : tab;
  const active: TradingStateTab = pro ? shown : "holding";
  const marketTab = active !== "holding" && active !== "fills" && active !== "orders" && active !== "mine" && active !== "analytics" && market && marketTabs.includes(active) ? active : null;

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
            const index = tabs.findIndex((entry) => entry.id === active);
            const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
            if (!next) return;
            event.preventDefault();
            setTab(next.id);
            event.currentTarget.querySelector<HTMLButtonElement>(`[data-state-tab="${next.id}"]`)?.focus();
          }}
        >
          {tabs.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`state-tab-${entry.id}`}
              aria-controls="state-panel"
              tabIndex={active === entry.id ? 0 : -1}
              className={styles.stateTab}
              aria-selected={active === entry.id}
              onClick={() => setTab(entry.id)}
              data-state-tab={entry.id}
              /* The account's tabs stand at the end of the row on a desk, after a rule: the market ‖ the account. */
              data-account-start={!phone && accountIds.has(entry.id) && !accountIds.has(tabs[index - 1]?.id ?? "") ? "true" : undefined}
            >
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className={styles.stateBody} id="state-panel" role={pro ? "tabpanel" : undefined} aria-labelledby={pro ? `state-tab-${active}` : undefined}>
        {marketTab && market ? <TokenTabBody key={`${market.mint}:${marketTab}`} tab={marketTab} market={market} facts={facts} owner={owner} /> : null}
        {/* The market still on its way: the panel keeps its size with the bones of its rows, never an empty box. */}
        {!market && !["analytics", "holding", "fills", "orders", "mine"].includes(active) ? (
          <div className={styles.stateLoading} aria-busy="true" aria-label={text("Loading market…")}>
            {[0, 1, 2, 3, 4].map((row) => (
              <span key={row} className={styles.aboutBone} />
            ))}
          </div>
        ) : null}
        {active === "analytics" ? analytics : null}
        {active === "orders" ? (!connection ? guestLine : limits ? <MyOrders limits={limits} marketMint={mint} onRefresh={onRefresh} /> : null) : null}
        {active === "holding" ? (!connection ? guestLine : <>{readNote}{holdingView}</>) : null}
        {active === "fills" ? (!connection ? guestLine : <>{readNote}{fillsView}</>) : null}
        {active === "mine" ? (
          !connection ? (
            guestLine
          ) : (
            <div className={styles.mine}>
              {readNote}
              <h3 className={styles.mineTitle}>{text("Position")}</h3>
              {holdingView}
              {limits ? (
                <>
                  <h3 className={styles.mineTitle}>{text("Orders")}</h3>
                  <MyOrders limits={limits} marketMint={mint} onRefresh={onRefresh} />
                </>
              ) : null}
              <h3 className={styles.mineTitle}>{text("History")}</h3>
              {fillsView}
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}

/** What the wallet holds and has done in the selected market, and how each of the account's three reads. */
export function useAccountViews({
  market,
  holdings,
  fills,
  limits,
  onRefresh,
}: {
  market: SpotMarket | null;
  holdings: HoldingsState;
  fills: FillsState;
  limits: LimitOrdersRead | null;
  onRefresh: () => void;
}) {
  const { text, locale } = useSolanaI18n();
  const { connection } = useSolanaConnection();
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

  const guestLine = (
    <div className={styles.empty}>
      <span>{text("Connect a wallet to see what you hold and what you have traded here.")}</span>
      {/* A button, not a pointer at the header (B14); secondary — the ticket's is the screen's orange action. */}
      <ConnectWalletButton variant="secondary" />
    </div>
  );
  const readNote =
    connection && (holdings.status === "unavailable" || holdings.partial || fills.status === "unavailable") ? (
      <p className={styles.note}>
        {holdings.partial ? text("Some balances could not be read.") : holdings.status === "unavailable" ? text("Balances are unavailable right now.") : text("History is unavailable right now.")}
        {" "}<button className={styles.ghost} type="button" onClick={onRefresh}>{text("Read again")}</button>
      </p>
    ) : null;
  const holdingView =
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
          <dd>{share === null ? "—" : `${new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(share)}${locale === "uk" ? " %" : "%"}`}</dd>
        </div>
        <div>
          <dt>{text("Portfolio")}</dt>
          <dd><Link className={styles.ghost} href="/app/portfolio">{text("Open")} →</Link></dd>
        </div>
      </dl>
    );
  const fillsView =
    fills.status === "unavailable" && rows.length === 0 ? (
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
                <td data-num="true">{new Date(action.updatedAt).toLocaleString(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td>{what}</td>
                <td data-num="true">{movementText(action.out, locale) ?? "—"}</td>
                <td data-num="true">{movementText(action.in, locale) ?? "—"}</td>
                <td>{state}</td>
                <td>{action.signature ? <a href={explorerTxUrl("mainnet", action.signature)} target="_blank" rel="noreferrer noopener">{text("Explorer")}</a> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );

  const ordersView = !connection ? guestLine : limits ? <MyOrders limits={limits} marketMint={mint} onRefresh={onRefresh} /> : null;
  return { rows, guestLine, readNote, holdingView, fillsView, ordersView, ordersCount: limits ? openLimitCount(limits.orders) : 0 };
}

/**
 * One of the account's three as a panel of its own (B16, the terminal): «Ордери» with «Скасувати» and «Забрати»,
 * «Позиція» — what the wallet holds here and what it is worth, «Історія» — its fills in this market. A guest reads one
 * sentence and connects from the header.
 */
export function AccountPanel({ tab, ...read }: { tab: "orders" | "holding" | "fills" } & Parameters<typeof useAccountViews>[0]) {
  const { connection } = useSolanaConnection();
  const views = useAccountViews(read);
  return (
    <div className={styles.accountPanel} data-account-panel={tab}>
      {tab === "orders" ? views.ordersView : !connection ? views.guestLine : (
        <>
          {views.readNote}
          {tab === "holding" ? views.holdingView : views.fillsView}
        </>
      )}
    </div>
  );
}
