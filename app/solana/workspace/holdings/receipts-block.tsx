"use client";

import { Block, Button, Table, type TableColumn } from "@ryntra/core/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import type { WalletRead } from "@/app/app/wallet-data";
import type { SolanaWalletAction } from "@/lib/solana/action-ledger";

import { describeAction } from "../history/history-lines.ts";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { receiptRows } from "./portfolio-model.ts";
import { portfolioWords } from "./portfolio-words.ts";
import styles from "./holdings.module.css";

/** When, in the few characters a cell has: the hour for today, the day before that (Home's rule). */
function shortMoment(at: Date, locale: "en" | "uk"): string {
  const tag = locale === "uk" ? "uk-UA" : "en-US";
  const today = new Date().toDateString() === at.toDateString();
  return new Intl.DateTimeFormat(tag, today ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" }).format(at);
}

/**
 * «Квитанції» in Portfolio (B5): the newest operations that finished, each
 * opening its receipt in History.
 *
 * The rows are worded by History's own lines (`describeAction`), so one
 * operation is never said two ways; the read is the wallet's server history
 * the page already holds (`useWalletData`), so nothing is asked twice.
 */
export function ReceiptsBlock({ activity, onRetry }: { activity: WalletRead<SolanaWalletAction>; onRetry: () => void }) {
  const { text, locale } = useSolanaI18n();
  const words = portfolioWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const router = useRouter();
  const rows = useMemo(() => (activity.status === "ready" ? receiptRows(activity.data) : []), [activity]);
  const reading = activity.status === "idle" || activity.status === "loading";

  const columns: TableColumn<SolanaWalletAction>[] = [
    {
      key: "what",
      label: words.what,
      render: (row) => {
        const lines = describeAction(row, text);
        return (
          <span className={styles.receiptCell}>
            <b className={styles.receiptMain} data-side={lines.side?.toLowerCase()} translate="no">
              {lines.title}
            </b>
            <span className={styles.receiptSub} translate="no">
              {lines.sub}
            </span>
          </span>
        );
      },
    },
    {
      key: "when",
      label: words.when,
      numeric: true,
      render: (row) => {
        const at = new Date(row.updatedAt);
        return Number.isNaN(at.getTime()) ? "—" : <time dateTime={row.updatedAt}>{shortMoment(at, lang)}</time>;
      },
    },
  ];

  const action =
    activity.status === "error" ? (
      <Button variant="secondary" onClick={onRetry} lang={lang}>
        {words.retry}
      </Button>
    ) : (
      <Link className="ryntra-button ryntra-button--secondary" href="/app/activity" prefetch={false}>
        <span className="ryntra-button__label">{words.receiptsAll}</span>
      </Link>
    );

  return (
    <Block title={words.receiptsTitle} titleAs="h2" icon="receipt" lang={lang} loading={reading} action={action} data-portfolio="receipts" id="portfolio-receipts">
      {activity.status === "error" ? (
        <p className={styles.blockSentence}>{words.receiptsUnread}</p>
      ) : rows.length > 0 ? (
        <>
          <Table
            columns={columns}
            rows={rows}
            rowKey={(row) => row.actionId}
            caption={words.receiptsCaption}
            onRowClick={(row) => router.push(`/app/activity?action=${encodeURIComponent(row.actionId)}`)}
            rowLabel={(row) => describeAction(row, text).title}
            lang={lang}
          />
          {activity.status === "ready" && !activity.complete ? <p className={styles.blockNote}>{words.receiptsPartly}</p> : null}
        </>
      ) : activity.status === "ready" ? (
        <p className={styles.blockSentence}>{activity.complete ? words.receiptsNone : words.receiptsPartly}</p>
      ) : null}
    </Block>
  );
}
