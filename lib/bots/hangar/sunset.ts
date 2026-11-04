/**
 * The Trigger V1 sunset watcher. Jupiter keeps Trigger V1 (`j1o2qRpj…`,
 * non-custodial: the order's own account, only the owner's signature takes it
 * back) beside Trigger V2, which holds the tokens in a vault Jupiter manages —
 * custodial, so the Hangar never moves an order there (bots hub, stage A).
 *
 * No end date for V1 is announced as of `TRIGGER_V1_SUNSET.checkedAt`. The
 * watcher states what stands on V1 now, and once a date is set here it says
 * how close it is and which open orders would outlive it: an order the keeper
 * no longer fills keeps the tokens until the person cancels it.
 *
 * Pure and client-safe.
 */

import type { HangarOrder } from "./orders.ts";

/** Jupiter's word on V1's end: null — none announced. Updated by hand when Jupiter announces one. */
export const TRIGGER_V1_SUNSET: Readonly<{ at: string | null; checkedAt: string }> = Object.freeze({ at: null, checkedAt: "2026-10-29" });

/** From this close to the date the note asks to act now. */
export const SUNSET_URGENT_MS = 14 * 86_400_000;

export type SunsetLevel = "watch" | "plan" | "urgent" | "past";

export type SunsetNote = Readonly<{
  level: SunsetLevel;
  sunsetAt: string | null;
  /** Open V1 orders, and those whose own expiry falls after the sunset (or never). */
  open: number;
  outlive: readonly string[];
  line: Readonly<{ uk: string; en: string }>;
}>;

/** The note for a wallet's V1 orders; null when none is open. */
export function triggerV1SunsetNote(orders: readonly HangarOrder[], nowMs: number, sunsetAt: string | null = TRIGGER_V1_SUNSET.at): SunsetNote | null {
  const open = orders.filter((order) => order.venue === "trigger" && (order.state === "OPEN" || order.state === "PARTIAL"));
  if (open.length === 0) return null;
  const end = sunsetAt === null ? Number.NaN : Date.parse(sunsetAt);
  if (!Number.isFinite(end)) {
    return {
      level: "watch",
      sunsetAt: null,
      open: open.length,
      outlive: [],
      line: { uk: "Jupiter Trigger V1 працює; дату завершення не оголошено", en: "Jupiter Trigger V1 is running; no end date announced" },
    };
  }
  const outlive = open.filter((order) => order.expiredAt === null || !(Date.parse(order.expiredAt) <= end)).map((order) => order.order);
  const left = end - nowMs;
  if (left <= 0) {
    return { level: "past", sunsetAt, open: open.length, outlive, line: { uk: "Trigger V1 завершено — скасуйте ордери, щоб повернути токени", en: "Trigger V1 has ended — cancel the orders to get the tokens back" } };
  }
  const days = Math.ceil(left / 86_400_000);
  return {
    level: left <= SUNSET_URGENT_MS ? "urgent" : "plan",
    sunsetAt,
    open: open.length,
    outlive,
    line: { uk: `Trigger V1 завершується за ${days} дн.`, en: `Trigger V1 ends in ${days} d` },
  };
}
