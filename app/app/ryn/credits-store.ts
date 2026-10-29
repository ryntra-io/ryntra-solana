"use client";

import { useSyncExternalStore } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { AssistantCredits, AssistantCreditsResponse } from "@/lib/api/v1/contract";

/**
 * The proven wallet's credits, one copy for every place that shows them (AI-06b): the balance at the top of the
 * assistant's page, the badge on the header's button on every other page, and the line under the composer. Whoever
 * reads fresher figures — a question answered, an order paid, the credits fold — publishes them here, so the three
 * never disagree. The figures are always the server's; nothing here counts.
 */

/** `credits: null` — this deployment serves no credits for that wallet (switched off): nothing to show, not «loading». */
type Snapshot = Readonly<{ owner: string; credits: AssistantCredits | null }> | null;

let snapshot: Snapshot = null;
const listeners = new Set<() => void>();
let inflight: string | null = null;
/* Every publish is a new version: a read that started before fresher figures arrived is not published over them. */
let version = 0;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function publishCredits(owner: string, credits: AssistantCredits | null): void {
  if (snapshot && snapshot.owner === owner && snapshot.credits === credits) return;
  snapshot = { owner, credits };
  version += 1;
  for (const listener of listeners) listener();
}

/**
 * The credits of `owner` as last read: `undefined` while unknown, `null` where none are served — another wallet's
 * figures are never shown for this one.
 */
export function useCredits(owner: string | null): AssistantCredits | null | undefined {
  const current = useSyncExternalStore(subscribe, () => snapshot, () => null);
  return owner !== null && current?.owner === owner ? current.credits : undefined;
}

/** One read of the credits for `owner`, unless they are already here (`again`: read anew — AI-08, after a refusal that names them) or on their way. */
export function loadCredits(owner: string, again = false): void {
  if ((!again && snapshot && snapshot.owner === owner) || inflight === owner) return;
  inflight = owner;
  const started = version;
  const fresh = () => version === started;
  void fetch("/api/v1/assistant/credits", { headers: { "content-type": "application/json", "X-Ryntra-API": "1" }, credentials: "same-origin", cache: "no-store" })
    .then(async (response) => {
      if (response.ok) {
        const body = (await response.json()) as AssistantCreditsResponse;
        if (fresh()) publishCredits(owner, body.credits);
      }
      /* Switched off here: said once, so nothing waits for figures that will not come. A failed read stays unknown. */
      else if (((await response.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code === "CAPABILITY_UNAVAILABLE") publishCredits(owner, null);
    })
    .catch(() => undefined)
    .finally(() => {
      if (inflight === owner) inflight = null;
    });
}

/* «Поповнити» at the top of the page opens the «Кредити» tab at its packages: one event the surface listens for. */
export const CREDITS_TOP_UP_EVENT = "ryntra:assistant-top-up";

export function askTopUp(): void {
  window.dispatchEvent(new CustomEvent(CREDITS_TOP_UP_EVENT));
}

/* ── The figures in a person's words ─────────────────────────────────── */

const tag = (locale: WorkspaceLocale) => (locale === "uk" ? "uk-UA" : "en-GB");

export const creditNumber = (n: number, locale: WorkspaceLocale) => new Intl.NumberFormat(tag(locale)).format(n);

/** `2 000` up to five digits, `28,7 тис.` / `28.7K` beyond — the header's badge has the room of a word. */
/** The phone's round button has the room of three signs: `950`, `2K`, `28K`. */
export const creditBadgeShort = (n: number) => (n < 1_000 ? String(n) : n < 1_000_000 ? `${Math.floor(n / 1_000)}K` : `${Math.floor(n / 1_000_000)}M`);

export const creditCompact = (n: number, locale: WorkspaceLocale) => (n < 10_000 ? creditNumber(n, locale) : new Intl.NumberFormat(tag(locale), { notation: "compact", maximumFractionDigits: 1 }).format(n));

/** One · few (2–4) · many in Ukrainian; one and many in English. */
export function plural(n: number, locale: WorkspaceLocale, en: readonly [string, string], uk: readonly [string, string, string]): string {
  if (locale !== "uk") return n === 1 ? en[0] : en[1];
  const ones = n % 10;
  const tens = n % 100;
  if (ones === 1 && tens !== 11) return uk[0];
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return uk[1];
  return uk[2];
}

export const creditsWord = (n: number, locale: WorkspaceLocale) => plural(n, locale, ["credit", "credits"], ["кредит", "кредити", "кредитів"]);
export const questionsWord = (n: number, locale: WorkspaceLocale) => plural(n, locale, ["question", "questions"], ["питання", "питання", "питань"]);

/** How many questions with the model the balance and the day's free credits pay for, at today's price. */
export function questionsOf(credits: AssistantCredits): Readonly<{ balance: number; free: number }> {
  const price = credits.prices.question;
  if (price <= 0) return { balance: 0, free: 0 };
  return { balance: Math.floor(credits.balance / price), free: Math.floor(credits.free.left / price) };
}
