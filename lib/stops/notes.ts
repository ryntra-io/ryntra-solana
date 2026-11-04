/**
 * What a reached stop tells the person (CITY-149), in both of the city's languages — one dictionary, so the note, the
 * phone's push, the browser's push and Telegram all say the same short line: «Стоп SOL досягнуто — продати?». The
 * note opens the city on the stop's coin with the stop named (`stopHref`); the city opens the sale's exact order there
 * and the person's wallet signs it. A note is never permission to trade.
 */

import { createHash } from "node:crypto";

import type { EngineStop } from "./model.ts";

type Words = Readonly<{
  title: (coin: string, side: EngineStop["side"]) => string;
  reason: (price: string, unit: string) => string;
  cta: (side: EngineStop["side"]) => string;
}>;

export const STOP_NOTE_WORDS: Readonly<Record<"en" | "uk", Words>> = {
  en: {
    title: (coin, side) => (side === "sell" ? `Stop ${coin} reached — sell?` : `Stop ${coin} reached — buy?`),
    reason: (price, unit) => `The price came to ${price} ${unit}. Your wallet signs the order.`,
    cta: (side) => (side === "sell" ? "Open the sale" : "Open the purchase"),
  },
  uk: {
    title: (coin, side) => (side === "sell" ? `Стоп ${coin} досягнуто — продати?` : `Стоп ${coin} досягнуто — купити?`),
    reason: (price, unit) => `Ціна дійшла до ${price} ${unit}. Ордер підписує твій гаманець.`,
    cta: (side) => (side === "sell" ? "Відкрити продаж" : "Відкрити купівлю"),
  },
};

/** A ticker as people read it: no leading `$`, upper case, short. */
export const tickerOf = (symbol: string) => symbol.replace(/^\$/, "").toUpperCase().slice(0, 16);

/** A price as typed, read easily: no trailing zeros after the point, and the decimal comma in Ukrainian. */
export function priceWords(price: string, locale: "en" | "uk" = "en"): string {
  const [whole = "0", fraction = ""] = price.split(".");
  const cut = fraction.replace(/0+$/, "");
  return cut ? `${whole}${locale === "uk" ? "," : "."}${cut}` : whole;
}

export type StopNoteText = Readonly<{ title: string; reason: string; cta: string }>;

export function stopNoteText(stop: Pick<EngineStop, "side" | "base" | "quote" | "price">, locale: "en" | "uk"): StopNoteText {
  const w = STOP_NOTE_WORDS[locale];
  return { title: w.title(tickerOf(stop.base.symbol), stop.side), reason: w.reason(priceWords(stop.price, locale), tickerOf(stop.quote.symbol)), cta: w.cta(stop.side) };
}

/** The Telegram message: the line and its reason, no address in the text — the button under it opens the sale. */
export function stopTelegramText(words: Readonly<{ title: string; reason: string }>): string {
  return `Ryntra\n${words.title}\n${words.reason}`;
}

/** Where the note opens: the city on the stop's coin, the stop named — the city opens its sale for the wallet to sign. */
export function stopHref(stop: Pick<EngineStop, "id" | "base">): string {
  return `/c/${stop.base.mint}?stop=${stop.id}`;
}

/** The trigger every note of a stop carries: the stop's own id, so a stop is told once. */
export const STOP_TRIGGER_PREFIX = "spot-stop:";

/** Whether an inbox note is a reached stop's (its trigger says so); such a note opens its own `href`, a city address. */
export function isStopNote(note: Readonly<{ triggerId: string }>): boolean {
  return note.triggerId.startsWith(STOP_TRIGGER_PREFIX);
}

export function stopNoteId(stopId: string): string {
  return `inb_${createHash("sha256").update(`${STOP_TRIGGER_PREFIX}${stopId}`).digest("hex").slice(0, 24)}`;
}

export function stopMonitorId(stopId: string): string {
  return `mon_${createHash("sha256").update(`spot-stop-monitor:${stopId}`).digest("hex").slice(0, 24)}`;
}
