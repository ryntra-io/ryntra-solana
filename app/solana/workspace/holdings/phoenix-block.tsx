"use client";

import { Block, Table, type TableColumn } from "@ryntra/core/ui";
import Link from "next/link";
import { useCallback, useMemo } from "react";

import type { Polled } from "@/app/solana/workspace/futures/use-futures-data";
import { useFuturesMarkets } from "@/app/solana/workspace/futures/use-futures-data";
import { futuresWord, type FuturesWordKey } from "@/app/solana/workspace/futures/futures-words";
import { symbolKey, unrealisedPnl, type FuturesAccount, type FuturesPosition } from "@/lib/phoenix/market-data";

import { formatAmount, formatTerminalPrice, formatUsdMoney, toneOf } from "../spot/spot-format.ts";
import { phoenixShown } from "./portfolio-model.ts";
import { portfolioWords } from "./portfolio-words.ts";
import styles from "./holdings.module.css";

const signed = (value: number | null, intl: string): string => (value === null ? "—" : `${value < 0 ? "−" : value > 0 ? "+" : ""}${formatUsdMoney(Math.abs(value), intl)}`);

/**
 * «На Phoenix» in Portfolio (SOL-C6, UX-604): the wallet's open Phoenix positions — entry, mark and result, the
 * table «Perps» draws, on the account read the value already made — with the collateral and how near the account
 * is to liquidation beside them. Read only: every action is on «Perps», one link away.
 */
export function PhoenixBlock({ read, locale }: { read: Polled<FuturesAccount>; locale: "en" | "uk" }) {
  const account = read.value;
  if (!account || !phoenixShown(account)) return null;
  return <PhoenixPositions account={account} locale={locale} />;
}

function PhoenixPositions({ account, locale }: { account: FuturesAccount; locale: "en" | "uk" }) {
  const w = useCallback((key: FuturesWordKey) => futuresWord(locale, key), [locale]);
  const words = portfolioWords(locale);
  const intl = locale === "uk" ? "uk-UA" : "en-US";
  /* The mark is the market list's, as on «Perps»: read only while there are positions to price. */
  const markets = useFuturesMarkets();
  const markBy = useMemo(() => new Map((markets.value?.markets ?? []).map((entry) => [symbolKey(entry.symbol), entry.markPrice])), [markets.value]);
  const markOf = useCallback((symbol: string) => markBy.get(symbolKey(symbol)) ?? null, [markBy]);
  const results = account.positions.map((position) => unrealisedPnl(position, markOf(position.symbol)));
  /* The sum only when every position has its result: a part of it would read as the whole. */
  const result = results.length > 0 && results.every((value) => value !== null) ? results.reduce<number>((sum, value) => sum + (value as number), 0) : null;
  const tier = account.margin?.riskTier ?? null;

  const columns = useMemo<TableColumn<FuturesPosition>[]>(
    () => [
      { key: "symbol", label: w("market"), render: (row) => <b translate="no">{row.symbol}</b> },
      { key: "side", label: w("side"), render: (row) => <span data-side={row.side}>{w(row.side)}</span> },
      { key: "size", label: w("size"), numeric: true, render: (row) => formatAmount(row.size, intl) },
      { key: "entryPrice", label: w("entry"), numeric: true, render: (row) => formatTerminalPrice(row.entryPrice, intl) },
      { key: "mark", label: w("mark"), numeric: true, render: (row) => formatTerminalPrice(markOf(row.symbol), intl) },
      {
        key: "pnl",
        label: w("pnl"),
        numeric: true,
        render: (row) => {
          const pnl = unrealisedPnl(row, markOf(row.symbol));
          return (
            <span className={styles.change} data-tone={toneOf(pnl) === "flat" ? undefined : toneOf(pnl)}>
              {signed(pnl, intl)}
            </span>
          );
        },
      },
    ],
    [w, intl, markOf],
  );

  const action = (
    <Link className="ryntra-button ryntra-button--secondary" href="/app/perps" prefetch={false}>
      <span className="ryntra-button__label">{words.phoenixOpen}</span>
    </Link>
  );

  return (
    <Block title={words.phoenixTitle} titleAs="h2" icon="chart-candlestick" lang={locale} action={action} data-portfolio="phoenix" id="portfolio-phoenix">
      <dl className={styles.coverage}>
        <div className={styles.fact}>
          <dt>{w("collateral")}</dt>
          <dd translate="no">{formatUsdMoney(account.collateralUsd, intl)}</dd>
        </div>
        {account.collateralSol ? (
          <div className={styles.fact}>
            <dt>{w("collateralSol")}</dt>
            <dd translate="no">{`${formatAmount(account.collateralSol, intl, 4)} SOL`}</dd>
          </div>
        ) : null}
        <div className={styles.fact}>
          <dt>{w("pnl")}</dt>
          <dd translate="no">
            <span className={styles.change} data-tone={toneOf(result) === "flat" ? undefined : toneOf(result)}>
              {signed(result, intl)}
            </span>
          </dd>
        </div>
        {/* How near liquidation, Phoenix's own tier: in sight wherever the positions are. */}
        {tier ? (
          <div className={styles.fact} data-tone={tier === "safe" ? undefined : "risk"} data-risk={tier}>
            <dt>{w("risk")}</dt>
            <dd>{w(`risk.${tier}` as FuturesWordKey)}</dd>
          </div>
        ) : null}
      </dl>
      <Table columns={columns} rows={account.positions} rowKey={(row) => `${row.subaccount}:${row.symbol}`} caption={w("positionsCaption")} empty={w("noPositions")} lang={locale} />
    </Block>
  );
}
