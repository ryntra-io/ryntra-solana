"use client";

import { useCallback, useEffect, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { AgentBudgetState, AssistantCreditEntry, AssistantCreditPurchase, AssistantCredits, AssistantCreditsResponse } from "@/lib/api/v1/contract";

import { CreditsBuy } from "./credits-buy";
import { questionsWord } from "./credits-store";

import styles from "./ryn.module.css";
import type { RynWord } from "./ryn-words";

/**
 * The assistant's credits on its page (AI-04). Two places, one truth:
 * under the composer the price of the next question before it is asked —
 * free while the day's free credits last, then from the balance — and one
 * fold under the brief with what credits are, the welcome credits, the
 * prices and the latest entries. The figures are the server's (`budget.credits`).
 */

const HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;

type Word = (w: RynWord) => string;

/** «кредит / кредити / кредитів» by the number (the English «credit / credits» the same way). */
export function creditUnit(n: number, word: Word, locale: WorkspaceLocale): string {
  if (locale !== "uk") return n === 1 ? word("creditOne") : word("creditMany");
  const tens = n % 100;
  const ones = n % 10;
  if (ones === 1 && tens !== 11) return word("creditOne");
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return word("creditFew");
  return word("creditMany");
}

/** How much of the next question comes from the balance — what the person must be shown before asking. */
function fromBalanceOf(credits: AssistantCredits): number {
  return Math.max(0, credits.prices.question - credits.free.left);
}

/** What the next question costs and whether it will be answered by the model — the line under the composer. */
/** Whether the line shows a price the balance pays — the only time the client may send that price. */
function balancePays(credits: AssistantCredits): boolean {
  const fromBalance = fromBalanceOf(credits);
  return fromBalance > 0 && fromBalance <= credits.balance && credits.dailySpend.used + fromBalance <= credits.dailySpend.cap;
}

export function priceLine(budget: AgentBudgetState, word: Word, locale: WorkspaceLocale): string {
  const credits = budget.credits;
  if (budget.model === "absent") return word("budgetAbsent");
  if (!credits) return budget.exhausted ? word("budgetExhausted") : `${budget.day.used} / ${budget.day.allowance} ${word("budgetLine")}`;
  const price = credits.prices.question;
  const fromBalance = fromBalanceOf(credits);
  if (fromBalance > credits.balance) return word("creditsSpent");
  if (credits.dailySpend.used + fromBalance > credits.dailySpend.cap) return word("creditsLimit");
  const fill = (template: string, values: Readonly<Record<string, number | string>>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
  const freeQuestions = price > 0 ? Math.floor(credits.free.left / price) : 0;
  const figures = { price, unit: creditUnit(price, word, locale), left: credits.free.left, daily: credits.free.daily, balance: credits.balance, free: price - fromBalance, rest: fromBalance, freeQ: `${freeQuestions} ${questionsWord(freeQuestions, locale)}` };
  const cost = fromBalance === 0 ? word("creditsFreeNow") : fromBalance === price ? word("creditsFromBalance") : word("creditsPartly");
  return `${word("creditsQuestion")}: ${fill(cost, figures)}`;
}

/**
 * The price the person was shown, sent with the question: the full price only
 * when the line said some of it comes from the balance; 0 while it said
 * «free» — so if the free credits ran out elsewhere meanwhile, nothing of the
 * balance is taken without the line saying so first.
 */
export function shownPrice(budget: AgentBudgetState): number | undefined {
  const credits = budget.credits;
  if (!credits) return undefined;
  return balancePays(credits) ? credits.prices.question : 0;
}

const PRICE_ROWS: readonly (readonly [keyof AssistantCredits["prices"], RynWord])[] = [
  ["question", "priceQuestion"],
  ["alertExplain", "priceAlertExplain"],
  ["tokenReport", "priceTokenReport"],
  ["priceMove", "priceMove"],
  ["voice", "priceVoice"],
  ["deep", "priceDeep"],
  ["plan", "pricePlan"],
];

const ACTION_WORD: Readonly<Record<NonNullable<AssistantCreditEntry["action"]>, RynWord>> = Object.fromEntries(PRICE_ROWS.map(([key, label]) => [key, label])) as Record<NonNullable<AssistantCreditEntry["action"]>, RynWord>;

const ENTRY_WORD: Readonly<Record<AssistantCreditEntry["kind"], RynWord>> = { grant: "entryGrant", hold: "entryHold", capture: "entryCapture", release: "entryRelease", expire: "entryExpire", "merge-out": "entryMergeOut", "merge-in": "entryMergeIn" };

/** A hold and its release net to nothing: the history shows what was added, spent and moved. */
function shown(entry: AssistantCreditEntry): boolean {
  return entry.kind === "grant" || (entry.kind === "merge-in" && entry.credits !== 0) || (entry.kind === "merge-out" && entry.credits !== 0) || (entry.kind === "capture" && (entry.charged ?? 0) > 0);
}

function entryCredits(entry: AssistantCreditEntry, format: (n: number) => string = String): string {
  const value = entry.kind === "capture" ? -(entry.charged ?? 0) : entry.credits;
  return value > 0 ? `+${format(value)}` : value < 0 ? `−${format(-value)}` : "0";
}

export function CreditsPanel({ locale, word, budget, onChange, active }: { locale: WorkspaceLocale; word: Word; budget: AgentBudgetState; onChange: (credits: AssistantCredits) => void; active: boolean }) {
  const credits = budget.credits ?? null;
  /* AI-06b: a tab of the page — read when it is first shown, and again as the figures move while it is shown. */
  const open = active;
  const [entries, setEntries] = useState<readonly AssistantCreditEntry[] | null>(null);
  const [purchase, setPurchase] = useState<AssistantCreditPurchase | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Readonly<{ text: string; tone: "ok" | "muted" | "error" }> | null>(null);
  /* Refused as taken or not eligible: the ask is not offered again on this page. */
  const [asked, setAsked] = useState(false);
  const tag = locale === "uk" ? "uk-UA" : "en-GB";

  const servesCredits = credits !== null;
  const freeUsed = credits?.free.used ?? 0;
  const balance = credits?.balance ?? 0;
  /*
   * Read once per opening and again after each question (the figures moved), never on every render. AI-06b: a read
   * that failed is tried once more, then said with «Спробувати ще» — never an empty tab behind «Поповнити», and never
   * «Ще нічого не витрачено» for a history that was not read.
   */
  const [readFailed, setReadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open || !servesCredits) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => fetch("/api/v1/assistant/credits", { headers: HEADERS, credentials: "same-origin" }).then((response) => (response.ok ? (response.json() as Promise<AssistantCreditsResponse>) : Promise.reject(new Error(String(response.status)))));
    void load()
      .catch(() => new Promise<AssistantCreditsResponse>((settle, refuse) => (timer = setTimeout(() => void load().then(settle, refuse), 1_500))))
      .then((body) => {
        if (!live) return;
        setReadFailed(false);
        setEntries(body.entries);
        setPurchase(body.purchase ?? null);
        onChange(body.credits);
      })
      .catch(() => {
        if (live) setReadFailed(true);
      });
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [open, servesCredits, freeUsed, balance, onChange, attempt]);

  const welcome = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch("/api/v1/assistant/credits/welcome", { method: "POST", headers: HEADERS, credentials: "same-origin", body: "{}" });
      if (response.ok) {
        const body = (await response.json()) as AssistantCreditsResponse;
        setEntries(body.entries);
        onChange(body.credits);
        setNote({ text: `${word("creditsWelcomeDone")}: +${body.granted ?? 0}`, tone: "ok" });
        return;
      }
      const code = ((await response.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code;
      if (code === "WELCOME_TAKEN" || code === "WELCOME_NOT_ELIGIBLE") setAsked(true);
      setNote(code === "WELCOME_TAKEN" ? { text: word("creditsWelcomeTaken"), tone: "muted" } : code === "WELCOME_NOT_ELIGIBLE" ? { text: word("creditsWelcomeNo"), tone: "muted" } : { text: word("creditsWelcomeLater"), tone: "error" });
    } catch {
      setNote({ text: word("creditsFailed"), tone: "error" });
    } finally {
      setBusy(false);
    }
  }, [busy, onChange, word]);

  if (!credits) return null;
  const visible = (entries ?? []).filter(shown).slice(0, 8);
  const freeDaily = credits.prices.question > 0 ? Math.floor(credits.free.daily / credits.prices.question) : 0;

  /* AI-06b: the balance is at the top of the page; the tab opens with buying, then what was added and spent, then the prices. */
  return (
    <div className={styles.panelBody}>
      <p className={styles.panelLead}>
        {freeDaily > 0
          ? word("creditsWhat")
              .replace("{n}", String(freeDaily))
              .replace("{q}", questionsWord(freeDaily, locale))
          : word("creditsWhatNoFree")}{" "}
        <span className={styles.panelRate}>{word("creditsRate").replace("{n}", new Intl.NumberFormat(tag).format(1000))}</span>
      </p>
      <div className={styles.briefBody}>
        {readFailed ? (
          <p className={styles.error} role="alert">
            {word("creditsFailed")}{" "}
            <button type="button" className={styles.barButton} onClick={() => setAttempt((value) => value + 1)}>
              {word("retry")}
            </button>
          </p>
        ) : null}
        <CreditsBuy locale={locale} word={word} unit={(n) => creditUnit(n, word, locale)} purchase={purchase} onCredits={onChange} />
        {credits.welcomeOffer === "open" && !asked ? (
          <div className={styles.creditsWelcome}>
            <button type="button" className="rw-btn" onClick={() => void welcome()} disabled={busy} aria-busy={busy}>
              {word("creditsWelcome")}
            </button>
            <span className={styles.briefMeta}>{word("creditsWelcomeNote")}</span>
          </div>
        ) : null}
        <div aria-live="polite">
          {note ? (
            <p className={note.tone === "error" ? styles.error : styles.briefMeta} data-tone={note.tone} role={note.tone === "error" ? "alert" : undefined}>
              {note.text}
            </p>
          ) : null}
        </div>
        <section className={styles.section}>
          <h4 className={styles.briefPart}>{word("creditsHistory")}</h4>
          {entries === null && readFailed ? null : entries === null ? (
            <p className={styles.muted} aria-busy="true">
              {word("loadingList")}
            </p>
          ) : visible.length === 0 ? (
            <p className={styles.muted}>{word("creditsNoHistory")}</p>
          ) : (
            <ul className={styles.creditsEntries}>
              {visible.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className={styles.creditsEntry}>
                  <span>{entry.kind === "merge-out" && entry.reason === "welcome" ? word("entrySecondWelcome") : entry.kind === "grant" && entry.reason === "purchase" ? word("entryPurchase") : entry.action ? `${word(ENTRY_WORD[entry.kind])} · ${word(ACTION_WORD[entry.action])}` : word(ENTRY_WORD[entry.kind])}</span>
                  <span className={styles.muted}>{new Date(entry.at).toLocaleString(tag, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                  <span className={styles.creditsAmount} data-sign={entryCredits(entry).startsWith("+") ? "plus" : "minus"}>
                    {entryCredits(entry, (n) => new Intl.NumberFormat(tag).format(n))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={styles.section}>
          <h4 className={styles.briefPart}>{word("creditsPrices")}</h4>
          <dl className={styles.creditsPrices}>
            {PRICE_ROWS.map(([key, label]) => (
              <div key={key} className={styles.creditsPrice}>
                <dt>{word(label)}</dt>
                <dd>{credits.prices[key]}</dd>
              </div>
            ))}
          </dl>
        </section>
        <details className={styles.marksLegend}>
          <summary>{word("briefHow")}</summary>
          <p>{word("creditsWhat2")}</p>
          <p>
            {word("creditsDaily")}: {credits.dailySpend.used} / {credits.dailySpend.cap}
            {credits.holder === "account" ? ` · ${word("creditsAccount")}` : ""}
          </p>
        </details>
      </div>
    </div>
  );
}
