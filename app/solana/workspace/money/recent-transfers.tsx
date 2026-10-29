"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ArrowsLeftRight } from "@phosphor-icons/react";
import { Block } from "@ryntra/core/ui";

import { useWalletData } from "@/app/app/wallet-data";
import type { SolanaWalletAction } from "@/lib/solana/action-ledger";

import { describeAction } from "../history/history-lines.ts";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { localFigure } from "./figures.ts";
import styles from "./recent-transfers.module.css";

/** Which of the wallet's operations a page of «Гроші» shows beside its form. */
export type RecentKind = "transfers" | "incoming" | "networks";

function belongs(action: SolanaWalletAction, kind: RecentKind): boolean {
  if (action.lane === "SWAP") return false;
  if (kind === "incoming") return action.lane === "RECEIVE" || (action.lane === "BRIDGE" && action.destination === "SOLANA");
  if (kind === "networks") return action.lane === "BRIDGE" || action.lane === "CROSS_SWAP";
  return true;
}

/**
 * The page's own recent money, beside its form (B18): what this wallet sent, received or moved between networks —
 * read from the wallet's history on the server, so a phone and a laptop show the same rows. One line per operation,
 * in History's own words (`describeAction`), each opening its row in History; «Усі» opens the whole of it.
 *
 * A guest and a wallet with nothing yet see the block with one line — the page keeps its shape, and the form's own
 * action is the one that does something about it.
 */
export function RecentTransfers({ kind, title, limit = 4 }: { kind: RecentKind; title: string; limit?: number }) {
  const { owner, activity } = useWalletData();
  const { text, locale } = useSolanaI18n();
  const uk = locale === "uk";
  const rows = owner && activity.status === "ready" ? activity.data.filter((action) => belongs(action, kind)).slice(0, limit) : [];
  const date = new Intl.DateTimeFormat(uk ? "uk-UA" : "en-US", { day: "numeric", month: "short" });
  const empty = !owner
    ? kind === "incoming"
      ? uk
        ? "Тут з'являться твої надходження."
        : "Money you receive will show here."
      : kind === "networks"
        ? uk
          ? "Тут з'являться твої переміщення між мережами."
          : "Your moves between networks will show here."
        : uk
          ? "Тут будуть твої перекази."
          : "Your transfers will be here."
    : activity.status === "loading" || activity.status === "idle"
      ? null
      : activity.status === "error"
        ? uk
          ? "Історію зараз не вдалося прочитати."
          : "History could not be read right now."
        : uk
          ? "Тут поки порожньо."
          : "Nothing here yet.";
  return (
    <Block
      title={title}
      icon="activity"
      lang={uk ? "uk" : "en"}
      loading={Boolean(owner) && (activity.status === "loading" || activity.status === "idle")}
      action={
        owner && rows.length > 0 ? (
          <Link className={styles.all} href="/app/activity">
            {uk ? "Уся історія" : "All history"}
          </Link>
        ) : undefined
      }
      data-recent={kind}
    >
      {rows.length > 0 ? (
        <ul className={styles.rows}>
          {rows.map((action) => {
            const lines = describeAction(action, text);
            const Icon = action.lane === "RECEIVE" || (action.lane === "BRIDGE" && action.destination === "SOLANA") ? ArrowDownLeft : action.lane === "SEND" ? ArrowUpRight : ArrowsLeftRight;
            return (
              <li key={action.actionId}>
                <Link className={styles.row} href={`/app/activity?action=${encodeURIComponent(action.actionId)}`}>
                  <span className={styles.icon} aria-hidden="true">
                    <Icon size={16} weight="bold" />
                  </span>
                  <span className={styles.what} translate="no">
                    {localFigure(lines.title, locale)}
                  </span>
                  <time className={styles.when} dateTime={action.updatedAt}>
                    {date.format(new Date(action.updatedAt))}
                  </time>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : empty ? (
        <p className={styles.empty}>{empty}</p>
      ) : null}
    </Block>
  );
}
