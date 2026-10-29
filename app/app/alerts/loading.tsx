"use client";

import { Page, Skeleton } from "@ryntra/core/ui";

import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";
import { words } from "@/lib/monitoring/copy";

import styles from "./monitoring.module.css";

/**
 * The loading state, as reserved geometry: Нагляд's own column in the middle of the canvas (SOL-C19), its heading and
 * the place of its notes.
 *
 * Nothing from an earlier read is shown here. A surface that renders its last
 * state while fetching the next is the most convincing way to tell a reader
 * everything is fine.
 */
export default function AlertsLoading() {
  const { locale } = useSolanaI18n();
  const lang = locale === "uk" ? "uk" : "en";
  const w = words(lang);
  return (
    <Page kind="action" className={styles.page} title={w.title} lang={lang} aria-busy="true" data-surface-state="LOADING">
      <Skeleton lines={6} label={w.loading} />
    </Page>
  );
}
