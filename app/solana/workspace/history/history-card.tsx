"use client";

import { ArrowLineDownLeft, ArrowLineUpRight, ArrowUpRight, ArrowsLeftRight, ChartLineUp, Check, CopySimple, Globe, RocketLaunch } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useWalletData } from "@/app/app/wallet-data";
import { Panel } from "@/app/shell/panel";
import { isLaunchOrigin, isSpotOrigin } from "@/lib/solana/action-origin";
import type { SolanaWalletAction } from "@/lib/solana/action-ledger";
import { displayAmount } from "@/lib/solana/amounts";
import { downloadTextFile } from "@/lib/solana/download.client";
import { explorerTxUrl } from "@/lib/solana/explorer";
import { filterHistory, HISTORY_FILTERS, historyCounts, historyExportName, historyPage, historyToCsv, type HistoryFilter } from "@/lib/solana/history-view";
import { fetchReceiptForAction, launchReceiptRequest, receiptFetchable } from "@/lib/solana/receipt-fetch.client";
import { findReceiptForAction, receiptBinding } from "@/lib/solana/receipt-view";
import { assetsOfMovements } from "@/lib/solana/receipt-truth";
import { ExecutionTruth } from "../receipts/execution-truth";
import { downloadReceipt, storeBoundSolanaReceipt } from "@/lib/solana/send-receipt-vault.client";
import { isRetiredMint } from "@/lib/stocks/retired";
import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { WalletGate } from "../wallet-gate.tsx";
import { actionStateWord, describeAction, leg, legNumber } from "./history-lines.ts";
import styles from "./history.module.css";

const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/**
 * Activity — every operation this wallet made through Ryntra, read as a person
 * reads a statement: the page that made it, the day it happened, what went out
 * and what came in, and one row opened is a receipt in words — paid, received,
 * price, fee, when, the transaction — with the signed record one link away for
 * whoever wants the evidence.
 */

/** The Solana transaction a row can be opened on, wherever it is recorded. */
function solanaTransactionOf(action: SolanaWalletAction): string | null {
  for (const candidate of [action.signature, action.destinationTx, action.sourceTx]) {
    if (typeof candidate === "string" && SOLANA_SIGNATURE.test(candidate)) return candidate;
  }
  return null;
}

function short(value: string): string {
  return value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
}

/** The four words a reward row uses. Nothing internal reaches this map. */
const REWARD_LABEL: Readonly<Record<string, string>> = {
  CASHBACK: "Cashback",
  REFERRAL_L1: "Referral L1",
  REFERRAL_L2: "Referral L2",
  CLAIM: "Claimed",
};

type Page = ReturnType<typeof historyPage>;

function PageGlyph({ page, side }: { page: Page; side: "BUY" | "SELL" | null }) {
  if (page === "SPOT") return <ChartLineUp size={18} weight="bold" aria-hidden="true" data-side={side ?? undefined} />;
  if (page === "LAUNCH") return <RocketLaunch size={18} weight="bold" aria-hidden="true" data-side={side ?? undefined} />;
  if (page === "SWAP") return <ArrowsLeftRight size={18} weight="bold" aria-hidden="true" />;
  if (page === "BRIDGE") return <Globe size={18} weight="bold" aria-hidden="true" />;
  if (page === "RECEIVE") return <ArrowLineDownLeft size={18} weight="bold" aria-hidden="true" />;
  return <ArrowLineUpRight size={18} weight="bold" aria-hidden="true" />;
}

export function HistoryCard({ selectedAction = null, initialFilter = "ALL" }: { selectedAction?: string | null; initialFilter?: HistoryFilter }) {
  const { text, locale } = useSolanaI18n();
  const { connection } = useSolanaConnection();
  const { owner, activity, rewards, cashback, receiptRows, refresh } = useWalletData();
  const [checking, setChecking] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [filter, setFilter] = useState<HistoryFilter>(initialFilter);
  const actions = useMemo(() => activity.status === "ready" ? activity.data : [], [activity]);
  const shown = useMemo(() => filterHistory(actions, filter), [actions, filter]);
  const counts = useMemo(() => historyCounts(actions), [actions]);
  const intl = locale === "uk" ? "uk-UA" : "en-US";

  /* A received payment's row carries public chain facts only. The link back to
     the payment request it settled is private creator data, so it is read
     through the proof-gated listing and shown only when that answers. */
  const [payLinks, setPayLinks] = useState<Readonly<Record<string, string>>>({});
  const hasReceived = useMemo(() => actions.some((action) => action.lane === "RECEIVE"), [actions]);
  useEffect(() => {
    if (!owner || !hasReceived) {
      setPayLinks({});
      return;
    }
    let live = true;
    void (async () => {
      try {
        const response = await fetch(`/api/pay/requests?address=${encodeURIComponent(owner)}`);
        if (!response.ok) return;
        const payload = (await response.json()) as { rows?: readonly { id: string; reference: string }[] };
        if (!live || !payload.rows) return;
        setPayLinks(Object.fromEntries(payload.rows.map((row) => [row.reference, row.id])));
      } catch {
        /* No link, no claim. */
      }
    })();
    return () => {
      live = false;
    };
  }, [owner, hasReceived]);

  /* The row's two lines and its state — the same words Home's «Останні операції» use (`history-lines.ts`). */
  const describe = (action: SolanaWalletAction) => describeAction(action, text);
  const stateWord = (outcome: SolanaWalletAction["outcome"]): string => actionStateWord(outcome, text);

  const filterLabel = (option: HistoryFilter): string => {
    if (option === "ALL") return text("All");
    if (option === "SPOT") return text("Spot");
    if (option === "LAUNCH") return text("Launch");
    if (option === "SWAP") return text("Swap");
    if (option === "BRIDGE") return text("Bridge");
    if (option === "SEND") return text("Sent");
    if (option === "RECEIVE") return text("Received");
    return text("Needs you");
  };

  /* Rows under the day they happened. */
  const groups = useMemo(() => {
    const dayKey = (iso: string) => {
      const date = new Date(iso);
      return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    };
    const today = dayKey(new Date().toISOString());
    const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
    const out: { key: string; label: string; rows: SolanaWalletAction[] }[] = [];
    for (const action of shown) {
      const key = dayKey(action.updatedAt);
      const last = out[out.length - 1];
      if (last && last.key === key) {
        last.rows.push(action);
        continue;
      }
      const label = key === today ? text("Today") : key === yesterday ? text("Yesterday") : new Intl.DateTimeFormat(intl, { day: "numeric", month: "long" }).format(new Date(action.updatedAt));
      out.push({ key, label, rows: [action] });
    }
    return out;
  }, [shown, text, intl]);

  async function openReceipt(action: SolanaWalletAction) {
    const target = `/app/receipts?action=${encodeURIComponent(action.actionId)}`;
    if (findReceiptForAction(receiptRows, action) || opening !== null) {
      window.location.assign(target);
      return;
    }
    setOpening(action.actionId);
    const fetched = await fetchReceiptForAction(action, owner);
    if (fetched.ok && owner) {
      const bound = receiptBinding(fetched.receipt);
      storeBoundSolanaReceipt(window.localStorage, bound?.wallet ?? owner, owner, fetched.receipt);
    }
    setOpening(null);
    window.location.assign(target);
  }

  async function check(action: SolanaWalletAction) {
    if (!owner || action.signature === null || checking !== null) return;
    setChecking(action.actionId);
    try {
      /* A launch's trade is settled by its own receipt route; a swap by its recovery. */
      const launch = launchReceiptRequest(action, owner);
      const response = await fetch(launch?.path ?? "/api/solana/swap/recover", {
        method: "POST",
        headers: { "content-type": "application/json", ...(launch?.headers ?? {}) },
        body: JSON.stringify(launch?.body ?? { owner, signature: action.signature }),
      });
      const payload = await response.json() as { receipt?: unknown };
      if (response.ok && payload.receipt !== undefined) {
        storeBoundSolanaReceipt(window.localStorage, owner, owner, payload.receipt);
      }
    } catch {
      // Refresh below reports the durable answer or keeps the unresolved state.
    } finally {
      setChecking(null);
      refresh();
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      window.setTimeout(() => setCopied((current) => (current === value ? null : current)), 1_600);
    } catch {
      /* The signature is on screen; the explorer link carries it too. */
    }
  }

  if (!connection) {
    return (
      <Panel id="activity-timeline" title={text("History")} w={12} h={6} essential stretch>
        <WalletGate title={text("Connect a wallet — your transfers will be here, and where each one is.")} />
      </Panel>
    );
  }

  const panelHeight: 3 | 5 | 8 = selectedAction ? 8 : shown.length <= 2 ? 3 : shown.length <= 6 ? 5 : 8;

  return (
    <Panel id="activity-timeline" title={text("History")} w={12} h={panelHeight} essential scroll>
      <div className={styles.card}>
        {activity.status === "loading" ? <p className={styles.note}>{text("Reading…")}</p> : null}
        {activity.status === "error" ? (
          <div className={styles.message} role="alert">
            <p>{text("History could not be loaded.")}</p>
            <button className={styles.retry} type="button" onClick={refresh}>{text("Try again")}</button>
          </div>
        ) : null}

        {activity.status === "ready" && actions.length > 0 ? (
          <div className={styles.toolbar}>
            <div className={styles.filters} role="group" aria-label={text("Narrow this list")}>
              {HISTORY_FILTERS.filter((option) => option === "ALL" || counts[option] > 0).map((option) => (
                <button key={option} type="button" className={styles.filter} data-active={option === filter} data-filter={option} aria-pressed={option === filter} onClick={() => setFilter(option)}>
                  {filterLabel(option)}
                  <span className={styles.filterCount} translate="no">{counts[option]}</span>
                </button>
              ))}
            </div>
            <button
              className={styles.export}
              type="button"
              disabled={shown.length === 0 || !owner}
              onClick={() => {
                if (!owner) return;
                downloadTextFile(historyToCsv(shown), historyExportName(owner, filter, new Date().toISOString()), "text/csv;charset=utf-8");
              }}
            >
              {text("Export")}
            </button>
          </div>
        ) : null}

        {activity.status === "ready" && actions.length === 0 && activity.complete ? (
          <div className={styles.empty}>
            <p>{text("Nothing yet.")}</p>
            <Link className={styles.primary} href="/app/spot">{text("Open Spot")}</Link>
          </div>
        ) : null}
        {activity.status === "ready" && shown.length === 0 && actions.length > 0 ? <p className={styles.note}>{text("Nothing here under this filter.")}</p> : null}

        {activity.status === "ready" && shown.length > 0 ? (
          <div className={styles.days}>
            {groups.map((group) => (
              <section className={styles.day} key={group.key} aria-label={group.label}>
                <h3 className={styles.dayLabel}>{group.label}</h3>
                <ol className={styles.list}>
                  {group.rows.map((action) => {
                    const open = selectedAction !== null && (selectedAction === action.actionId || selectedAction === action.signature);
                    const receipt = findReceiptForAction(receiptRows, action);
                    const page = historyPage(action);
                    const words = describe(action);
                    const tx = solanaTransactionOf(action);
                    const outNumber = legNumber(action.out);
                    const inNumber = legNumber(action.in);
                    /* A Spot order and a launch's trade both have a side: the price is per unit of what was bought or sold. */
                    const spot = isSpotOrigin(action.origin) || isLaunchOrigin(action.origin) ? action.origin : null;
                    /* The price a fill achieved: the quote leg per unit of the market. */
                    const price = spot && outNumber !== null && inNumber !== null
                      ? spot.side === "BUY" ? outNumber / inNumber : inNumber / outNumber
                      : action.lane === "SWAP" && outNumber !== null && inNumber !== null ? inNumber / outNumber : null;
                    const priceBase = spot ? (spot.side === "BUY" ? action.in : action.out) : action.out;
                    const priceQuote = spot ? (spot.side === "BUY" ? action.out : action.in) : action.in;
                    return (
                      <li className={styles.row} data-open={open} data-outcome={action.outcome} key={action.actionId}>
                        <Link className={styles.rowMain} href={open ? "/app/activity" : `/app/activity?action=${encodeURIComponent(action.actionId)}`} scroll={false} aria-expanded={open}>
                          <span className={styles.glyph} data-page={page} data-side={words.side ?? undefined}>
                            <PageGlyph page={page} side={words.side} />
                          </span>
                          <span className={styles.what}>
                            <span className={styles.title} translate="no">{words.title}</span>
                            <span className={styles.sub}>{words.sub}</span>
                          </span>
                          <time className={styles.when} dateTime={action.updatedAt}>{new Intl.DateTimeFormat(intl, { timeStyle: "short" }).format(new Date(action.updatedAt))}</time>
                          <span className={styles.state} data-outcome={action.outcome}>{stateWord(action.outcome)}</span>
                        </Link>
                        {open ? (
                          <div className={styles.detail}>
                            <dl className={styles.facts}>
                              {action.out ? (
                                <div>
                                  <dt>{page === "RECEIVE" ? text("From") : text("You paid")}</dt>
                                  <dd translate="no">{leg(action.out) ?? text("Not available")}</dd>
                                </div>
                              ) : null}
                              {action.in ? (
                                <div>
                                  <dt>{text("You received")}</dt>
                                  <dd translate="no">{leg(action.in) ?? text("Not available")}</dd>
                                </div>
                              ) : null}
                              {/* A receipt of a token Ryntra no longer supports reads as history: what the asset is now, and the way out. */}
                              {[action.out, action.in].some((movement) => movement !== null && isRetiredMint(movement.mint)) ? (
                                <div data-retired>
                                  <dt>{text("Asset")}</dt>
                                  <dd>{`${text("No longer supported in Ryntra")} · ${text("You can sell it in your own wallet")}`}</dd>
                                </div>
                              ) : null}
                              {price !== null && Number.isFinite(price) && priceBase?.symbol && priceQuote?.symbol ? (
                                <div>
                                  <dt>{text("Price")}</dt>
                                  <dd translate="no">1 {priceBase.symbol} ≈ {price.toLocaleString("en-US", { maximumSignificantDigits: 6 })} {priceQuote.symbol}</dd>
                                </div>
                              ) : null}
                              {page === "LAUNCH" && action.fee && action.fee.amountRaw && action.fee.decimals !== null ? (
                                /* On a launch the fee is the curve's or the pool's own — what the person paid — with Ryntra's part of it. */
                                <>
                                  <div>
                                    <dt>{text("Fee")}</dt>
                                    <dd translate="no">{displayAmount(action.fee.amountRaw, action.fee.decimals)} {action.fee.symbol ?? ""}</dd>
                                  </div>
                                  {action.fee.ryntraRaw ? (
                                    <div>
                                      <dt>{text("Ryntra's part of the fee")}</dt>
                                      <dd translate="no">{displayAmount(action.fee.ryntraRaw, action.fee.decimals)} {action.fee.symbol ?? ""}</dd>
                                    </div>
                                  ) : null}
                                </>
                              ) : action.fee && action.fee.collected && action.fee.amountRaw && action.fee.decimals !== null ? (
                                <div>
                                  <dt>{text("Ryntra fee")}</dt>
                                  <dd translate="no">{displayAmount(action.fee.amountRaw, action.fee.decimals)} {action.fee.symbol ?? ""}</dd>
                                </div>
                              ) : null}
                              <div>
                                <dt>{text("Result")}</dt>
                                <dd>{stateWord(action.outcome)}</dd>
                              </div>
                              <div>
                                <dt>{text("When")}</dt>
                                <dd><time dateTime={action.updatedAt}>{new Intl.DateTimeFormat(intl, { dateStyle: "medium", timeStyle: "short" }).format(new Date(action.updatedAt))}</time></dd>
                              </div>
                              {tx ? (
                                <div>
                                  <dt>{text("Transaction")}</dt>
                                  <dd translate="no">
                                    <span className={styles.mono}>{short(tx)}</span>
                                    <button type="button" className={styles.copy} onClick={() => void copy(tx)} aria-label={text("Copy")}>
                                      {copied === tx ? <Check size={14} weight="bold" aria-hidden="true" /> : <CopySimple size={14} aria-hidden="true" />}
                                    </button>
                                  </dd>
                                </div>
                              ) : null}
                            </dl>
                            {/* The trade's execution truth, from its own receipt where this browser keeps it (SOL-X1). */}
                            {receipt ? <ExecutionTruth receipt={receipt.receipt} known={assetsOfMovements([action.in, action.out])} cashback={cashback} /> : null}
                            <div className={styles.actions}>
                              {tx ? (
                                <a className={styles.action} href={explorerTxUrl(action.network, tx)} target="_blank" rel="noreferrer noopener">
                                  {text("Explorer")} <ArrowUpRight size={12} aria-hidden="true" />
                                </a>
                              ) : null}
                              {receipt ? (
                                <button className={styles.action} type="button" onClick={() => downloadReceipt(receipt.receipt)}>{text("Download receipt")}</button>
                              ) : null}
                              {receipt || receiptFetchable(action) ? (
                                <button className={styles.action} type="button" onClick={() => void openReceipt(action)} disabled={opening !== null}>
                                  {opening === action.actionId ? text("Opening…") : text("Signed record")}
                                </button>
                              ) : null}
                              {action.lane === "RECEIVE" && payLinks[action.actionId.replace(/^receive:/, "")] ? (
                                <a className={styles.action} href={`/pay/${encodeURIComponent(payLinks[action.actionId.replace(/^receive:/, "")])}`} target="_blank" rel="noreferrer noopener">{text("Open payment request")}</a>
                              ) : null}
                              {action.lane === "SWAP" && action.signature && (action.outcome === "IN_FLIGHT" || action.outcome === "NEEDS_YOU") ? (
                                <button className={styles.actionPrimary} type="button" onClick={() => void check(action)} disabled={checking !== null}>{checking === action.actionId ? text("Checking…") : text("Check what happened")}</button>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        ) : null}

        {/* Rewards, under the operations that produced them — one line each,
            never a ledger; null for a wallet that has not proved itself. */}
        {rewards && rewards.length > 0 ? (
          <section className={styles.rewards}>
            <h3 className={styles.rewardsTitle}>{text("Rewards")}</h3>
            <ol className={styles.rewardsList}>
              {rewards.slice(0, 4).map((row, index) => (
                <li className={styles.rewardsRow} key={`${row.at}:${row.kind}:${index}`}>
                  <span className={styles.rewardsWhat}>{text(REWARD_LABEL[row.kind] ?? row.kind)}</span>
                  <span className={styles.rewardsAmount} translate="no">{row.display}</span>
                  <span className={styles.rewardsAt}>{row.at.slice(0, 10)}</span>
                </li>
              ))}
            </ol>
            <Link className={styles.rewardsMore} href="/app/rewards">{text("Open Rewards")}</Link>
          </section>
        ) : null}

        {activity.status === "ready" && !activity.complete ? <p className={styles.coverage}>{text("Some activity could not be loaded.")}</p> : null}
      </div>
    </Panel>
  );
}
