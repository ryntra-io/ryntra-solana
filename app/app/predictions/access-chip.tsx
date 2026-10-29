"use client";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { VenueAccess } from "@/lib/predictions/access";

import styles from "./predictions.module.css";
import { wordsFor, type PredictionWord } from "./words";

const LABEL: Readonly<Record<VenueAccess, PredictionWord>> = { open: "accessOpen", account: "accessAccount", view: "accessView", off: "accessOff", unknown: "accessUnknown" };
const WHY: Readonly<Record<Exclude<VenueAccess, "account">, PredictionWord>> = { open: "accessOpenWhy", view: "accessViewWhy", off: "accessOffWhy", unknown: "accessUnknownWhy" };

/** Why a venue is in its state, in one sentence. */
export function accessWhy(state: VenueAccess, venue: string | null, locale: WorkspaceLocale): string {
  const word = wordsFor(locale);
  if (state === "account") return venue === "kalshi" ? word("accessKalshiWhy") : word("accessKycWhy");
  return word(WHY[state]);
}

/** One access state as a dot and a word; the reason is the chip's title. */
export function AccessChip({ state, locale, venue = null, why }: { state: VenueAccess; locale: WorkspaceLocale; venue?: string | null; why?: string }) {
  const word = wordsFor(locale);
  const reason = why ?? accessWhy(state, venue, locale);
  return (
    <span className={styles.access} data-state={state} title={reason}>
      <i aria-hidden="true" />
      {word(LABEL[state])}
      <span className="sr-only">. {reason}</span>
    </span>
  );
}
