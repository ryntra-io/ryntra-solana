"use client";

import { Page, Skeleton } from "@ryntra/core/ui";

import pair from "@/app/app/form-pair.module.css";
import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";

import { planWordsFor } from "../plans/plan-words";

/**
 * The plan builder while its page is made: the core's action column in the middle of the canvas with the heading and
 * the form's place (SOL-C19) — not the shape of «Мої стратегії» the rest of the section waits in.
 */
export default function PlanBuilderLoading() {
  const { locale } = useSolanaI18n();
  const word = planWordsFor(locale);
  return (
    <Page kind="action" className={pair.column} title={word("builderTitle")} lang={locale === "uk" ? "uk" : "en"} aria-busy="true" data-surface-state="LOADING">
      <Skeleton lines={8} label={word("assetLoadingAny")} />
    </Page>
  );
}
