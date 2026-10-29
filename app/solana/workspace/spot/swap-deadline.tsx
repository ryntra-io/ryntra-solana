"use client";

import Link from "next/link";

import { eventPagePath } from "@/lib/stocks/company-page-route";
import { isWatched, spotDeadlineLine, windowState } from "@/lib/stocks/conversion-watch";
import { lifecycleEventFor } from "@/lib/stocks/lifecycle-events";

import styles from "./spot.module.css";

/**
 * A token its issuer set a swap deadline for, beside «Купити» (UX-504): the
 * date in red — «Обміняти до 12.03.2027, інакше токен згорить · не акція» —
 * and the swap one press away on the token's own page. Over the ticket on a
 * desk, over the pinned «Купити | Продати» on a phone; nothing for any other
 * token.
 */
/** Whether a market carries the deadline line — the phone's pinned bar is taller by it. */
export function hasSwapDeadline(mint: string | null): boolean {
  return isWatched(mint ? lifecycleEventFor(mint) : null);
}

export function SwapDeadline({ mint, lang }: Readonly<{ mint: string | null; lang: "en" | "uk" }>) {
  const event = mint ? lifecycleEventFor(mint) : null;
  if (!isWatched(event)) return null;
  const now = Date.now();
  const open = windowState(event, now) === "open";
  return (
    <p className={styles.deadlineLine} data-swap-deadline>
      <span>{spotDeadlineLine(event, lang, now)}</span>
      <Link href={eventPagePath(event)} prefetch={false}>
        {open ? (lang === "uk" ? "Обмін" : "Swap") : lang === "uk" ? "Деталі" : "Details"}
      </Link>
    </p>
  );
}
