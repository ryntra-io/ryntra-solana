"use client";

import { CheckCircle, Clock, XCircle } from "@phosphor-icons/react";
import { Button, Review, Table, type TableColumn } from "@ryntra/core/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { explorerTxUrl } from "@/lib/solana/explorer";
import type { LimitOrderState } from "@/lib/solana/limits/store.server";
import { reviewNetworkFrom, reviewWord } from "@/lib/ticket/review-words";

import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { limitFailureText, signAndCancel, type LimitOrderView } from "./limit-api.ts";
import { cancelReturns } from "./limit-cancel-review.ts";
import { isOpenLimit, limitOrderPrice } from "./limit-orders-view.ts";
import orderStyles from "./my-orders.module.css";
import styles from "./spot.module.css";
import { formatAmount, formatPrice, rawToNumber } from "./spot-format.ts";
import type { LimitOrdersRead } from "./use-limit-orders.ts";

const VENUE_NAME = { trigger: "Jupiter", dlmm: "Meteora DLMM" } as const;
/* The quote assets by mint: a catalogue that is busy never turns SOL into «So11…». */
const KNOWN_SYMBOLS: Readonly<Record<string, string>> = {
  So11111111111111111111111111111111111111112: "SOL",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
};
const STATE_WORDS: Record<LimitOrderState, string> = {
  PLACING: "Placing",
  OPEN: "Waiting",
  PARTIAL: "Part filled",
  FILLED: "Filled",
  CANCELLING: "Cancelling",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  FAILED: "Did not happen",
};
/** The tone each state is read in: a fill is a success, a failure the one red, waiting the live one. */
const STATE_TONE: Record<LimitOrderState, "live" | "done" | "quiet" | "bad"> = {
  PLACING: "live",
  OPEN: "live",
  PARTIAL: "live",
  CANCELLING: "live",
  FILLED: "done",
  CANCELLED: "quiet",
  EXPIRED: "quiet",
  FAILED: "bad",
};

/**
 * «Мої ордери» (B3): every limit order of the wallet at Jupiter and on DLMM —
 * the ones waiting first, with «Скасувати», a converted DLMM order with
 * «Забрати», then what filled, was cancelled or expired, each with its
 * transaction. The orders are the Spot workspace's one read
 * (`use-limit-orders.ts`), the same the chart draws and the ticket counts.
 * «Скасувати» and «Забрати» open the core's Review first (SOL-C14); only its
 * «Підписати в гаманці» builds the cancellation and asks the wallet.
 */
export function MyOrders({ limits, marketMint, onRefresh }: { limits: LimitOrdersRead; marketMint: string | null; onRefresh?: () => void }) {
  const { text, locale } = useSolanaI18n();
  const { connection } = useSolanaConnection();
  const lang = locale === "uk" ? "uk" : "en";
  const [acting, setActing] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<LimitOrderView | null>(null);
  /* The Review stands over the terminal in its own sheet: a panel of the terminal is too short to hold it with its action. */
  const sheet = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = sheet.current;
    if (!element) return;
    if (reviewing && !element.open) element.showModal();
    if (!reviewing && element.open) element.close();
  }, [reviewing]);
  const [notice, setNotice] = useState<string | null>(null);

  const symbol = useCallback((mint: string) => limits.tokens[mint]?.symbol ?? KNOWN_SYMBOLS[mint] ?? `${mint.slice(0, 4)}…`, [limits.tokens]);
  const human = useCallback((raw: string, mint: string) => {
    const decimals = limits.tokens[mint]?.decimals;
    if (decimals === null || decimals === undefined) return "—";
    return `${formatAmount(rawToNumber(raw, decimals), locale)} ${symbol(mint)}`;
  }, [limits.tokens, locale, symbol]);

  async function act(order: LimitOrderView) {
    if (!connection) return;
    setActing(order.key);
    setNotice(null);
    const answer = await signAndCancel({ wallet: connection.wallet, address: connection.address }, order);
    setActing(null);
    if (!answer.ok) {
      setReviewing(null);
      setNotice(limitFailureText(answer, text, text("The order was not cancelled.")));
      return;
    }
    setReviewing(null);
    setNotice(order.canClaim ? text("Taken back into your wallet.") : text("Cancelled. The amount is back in your wallet."));
    limits.reload();
    onRefresh?.();
  }

  const rows = useMemo(() => {
    const ordered = [...limits.orders];
    /* Waiting orders first, this market's before others', newest first within each. */
    ordered.sort((a, b) => {
      const open = Number(isOpenLimit(b)) - Number(isOpenLimit(a));
      if (open !== 0) return open;
      const here = Number(b.baseMint === marketMint) - Number(a.baseMint === marketMint);
      if (here !== 0) return here;
      return (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt);
    });
    return ordered.slice(0, 30);
  }, [limits.orders, marketMint]);

  const stateBadge = (order: LimitOrderView) => {
    const tone = STATE_TONE[order.state];
    const Icon = tone === "done" ? CheckCircle : tone === "bad" || tone === "quiet" ? XCircle : Clock;
    return (
      <span className={orderStyles.state} data-tone={tone}>
        {tone === "live" ? <span className={orderStyles.pulse} aria-hidden="true" /> : <Icon size={14} weight={tone === "done" ? "fill" : "regular"} aria-hidden="true" />}
        {text(STATE_WORDS[order.state])}
      </span>
    );
  };

  const columns: TableColumn<LimitOrderView>[] = [
    {
      key: "what",
      label: text("Order"),
      /* Three columns that fit a phone: what and where it stands; the price with the amount and what filled; one action. */
      render: (order) => (
        <span className={orderStyles.what}>
          <b data-side={order.side}>{order.side === "buy" ? text("Buy") : text("Sell")} {symbol(order.baseMint)}</b>
          <span className={orderStyles.meta}>
            {stateBadge(order)}
            <span className={orderStyles.venue}>{VENUE_NAME[order.venue]}</span>
          </span>
        </span>
      ),
    },
    {
      key: "price",
      label: text("Price"),
      numeric: true,
      render: (order) => {
        const value = limitOrderPrice(order, limits.tokens);
        const filled = order.filledOutputRaw !== "0";
        return (
          <span className={orderStyles.what}>
            <b>{value === null ? "—" : `${formatPrice(value, locale)} ${symbol(order.quoteMint)}`}</b>
            <span className={orderStyles.amounts} data-filled={filled ? "true" : undefined}>
              {human(order.makingRaw, order.inputMint)}
              {filled ? <span className={orderStyles.got}> → {human(order.filledOutputRaw, order.outputMint)}</span> : null}
            </span>
          </span>
        );
      },
    },
    {
      key: "action",
      label: <span className="sr-only">{text("Action")}</span>,
      render: (order) =>
        order.canCancel || order.canClaim ? (
          <Button
            className={orderStyles.act}
            variant={order.canClaim ? "primary" : "secondary"}
            lang={lang}
            loading={acting === order.key}
            disabled={acting !== null}
            aria-haspopup="dialog"
            onClick={() => {
              setNotice(null);
              setReviewing(order);
            }}
          >
            {order.canClaim ? text("Take back") : text("Cancel")}
          </Button>
        ) : (order.fills.at(-1)?.signature ?? order.cancelSignature ?? order.placeSignature) ? (
          <a className={orderStyles.link} href={explorerTxUrl("mainnet", (order.fills.at(-1)?.signature ?? order.cancelSignature ?? order.placeSignature) as string)} target="_blank" rel="noreferrer noopener">
            {order.state === "FILLED" ? text("Receipt") : text("Explorer")}
          </a>
        ) : null,
    },
  ];

  if (!connection) {
    return <div className={styles.empty}><span>{text("Connect a wallet to see your orders.")}</span></div>;
  }
  /* The Review of the order picked: what comes back, every cost on its own line, what the venue does — then the wallet. */
  const shown = reviewing ? (limits.orders.find((order) => order.key === reviewing.key) ?? reviewing) : null;
  /* An order that left the list or can no longer be cancelled since the Review opened is not offered for a signature. */
  const stillOpen = shown !== null && acting !== shown.key && limits.orders.some((order) => order.key === shown.key && (order.canCancel || order.canClaim));
  const shownPrice = shown ? limitOrderPrice(shown, limits.tokens) : null;
  const review = shown ? (
    <Review
      className={orderStyles.review}
      lang={lang}
      titleAs="h3"
      data-limit-review
      title={`${shown.canClaim ? text("Take back the converted order") : text("Cancel the limit order")} · ${shown.side === "buy" ? text("Buy") : text("Sell")} ${symbol(shown.baseMint)}`}
      pay={reviewWord(lang, "onlyNetwork")}
      get={[...cancelReturns(shown).map((back) => human(back.raw, back.mint)), text("the order account's rent")].join(" + ")}
      costs={[
        { label: reviewWord(lang, "ryntra"), value: reviewWord(lang, "none") },
        { label: VENUE_NAME[shown.venue], value: reviewWord(lang, "none") },
        { label: reviewWord(lang, "network"), value: reviewNetworkFrom(lang) },
      ]}
      costsTotal={reviewNetworkFrom(lang)}
      rows={[
        { label: text("Price"), value: shownPrice === null ? "—" : `${formatPrice(shownPrice, locale)} ${symbol(shown.quoteMint)}` },
        ...(shown.filledOutputRaw !== "0" ? [{ label: text("Filled so far"), value: `${human(shown.filledInputRaw, shown.inputMint)} → ${human(shown.filledOutputRaw, shown.outputMint)}` }] : []),
      ]}
      whatItIs={
        shown.venue === "trigger"
          ? text("Jupiter closes the order: what has not filled comes back to your wallet with the order account's rent. What already filled stays in your wallet.")
          : text("Meteora closes the order in the pool: what has not converted, what has converted, the fees it earned and the rent come back to your wallet in one signature.")
      }
      signer={<span translate="no">{`${connection.address.slice(0, 4)}…${connection.address.slice(-4)}`}</span>}
      ready={stillOpen || acting === shown.key}
      blockedReason={text("This order is already closed or being closed.")}
      signing={acting === shown.key}
      {...(acting === shown.key ? {} : { onCancel: () => setReviewing(null) })}
      onConfirm={() => void act(shown)}
      risk={reviewWord(lang, "walletShowsFee")}
      details={
        <dl className={orderStyles.reviewDetails}>
          <div><dt>{text("Order")}</dt><dd translate="no">{shown.order}</dd></div>
          {shown.pool ? <div><dt>{text("Pool")}</dt><dd translate="no">{shown.pool}</dd></div> : null}
        </dl>
      }
    />
  ) : null;

  return (
    <div className={orderStyles.root} data-my-orders>
      <dialog
        ref={sheet}
        className={orderStyles.sheet}
        aria-label={shown ? (shown.canClaim ? text("Take back the converted order") : text("Cancel the limit order")) : undefined}
        onClose={() => {
          /* However the sheet closed — the browser's own second Esc included — the Review closes with it. */
          if (acting === null) setReviewing(null);
        }}
        onCancel={(event) => {
          /* Esc closes the Review, never a signature already asked for. */
          event.preventDefault();
          if (acting === null) setReviewing(null);
        }}
        onClick={(event) => {
          /* A press on the dimmed terminal around the Review closes it; a press inside never reaches the dialog itself. */
          if (event.target === event.currentTarget && acting === null) setReviewing(null);
        }}
      >
        <div className={orderStyles.sheetBody}>{review}</div>
      </dialog>
      <Table
        lang={lang}
        caption={text("My orders")}
        columns={columns}
        rows={rows}
        rowKey={(order) => order.key}
        loading={limits.status === "loading" || limits.status === "idle"}
        skeletonRows={3}
        empty={limits.status === "failed" ? text("Your orders could not be read right now.") : text("No limit orders yet. Set one in the ticket: «Limit».")}
      />
      {notice ? <p className={styles.note} role="status">{notice}</p> : null}
      {limits.status === "ready" && !limits.complete ? <p className={styles.note}>{text("Some venues did not answer; the list may be incomplete.")}</p> : null}
    </div>
  );
}
