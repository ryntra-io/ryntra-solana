"use client";

import { AutoinvestBlock } from "@/app/app/invest/autoinvest-block";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";

import { botsWords } from "./bots-words";
import styles from "./bots.module.css";

/**
 * The recurring-buy rules in «Мої боти» — the same block Home draws, one
 * truth: the month's budget, the rules with their switches, «Додати правило».
 * A guest reads one line; the way in is the plans' gate below it.
 */
export function MyRecurring({ locale }: { locale: WorkspaceLocale }) {
  const word = botsWords(locale);
  const { connection } = useSolanaConnection();
  if (connection) return <AutoinvestBlock locale={locale} heading={false} />;
  return (
    <div className={styles.guest}>
      <p className={styles.guestLine}>{word("connect")}</p>
    </div>
  );
}
