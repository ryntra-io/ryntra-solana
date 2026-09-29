import type { WorkspaceLocale } from "@/app/shell/locale";
import { formatEvidenceValue } from "@/lib/evidence/conditions";
import { evidenceMetric, type EvidenceMetricId, type EvidenceOperator, type EvidenceUnit, type EvidenceWindow } from "@/lib/evidence/metrics";

/**
 * Every word the evidence surfaces say, in both languages, and the formats
 * they share. A figure never travels without its unit or its time: the
 * volume is USD over a window, a movement is signed, an address count is
 * addresses (never people), and *asked at* is Ryntra's clock while the
 * source's lag is the source's own statement.
 */

type Bi = Readonly<{ en: string; uk: string }>;
const bi = (en: string, uk: string): Bi => ({ en, uk });

export const EVIDENCE_WORDS = {
  title: bi("Onchain activity", "Активність у мережі"),
  lead: bi("What the market did with this token on Solana — trades and movements, from an external source, on request.", "Що ринок робив із цим токеном у Solana — угоди й переміщення, із зовнішнього джерела, на запит."),
  analyse: bi("Analysis", "Аналіз"),
  loading: bi("Reading the observation…", "Читаємо спостереження…"),
  refresh: bi("Refresh", "Оновити"),
  tryAgain: bi("Try again", "Спробувати ще раз"),
  details: bi("Details", "Деталі"),
  addCondition: bi("Add a condition to the plan", "Додати умову до плану"),
  askedAt: bi("asked", "запит о"),
  sourceLag: bi("the source may be up to", "джерело може відставати до"),
  minutes: bi("min behind", "хв"),
  live: bi("live at the source", "наживо у джерела"),
  stale: bi("last observation held — the source did not answer just now", "остання збережена картина — джерело щойно не відповіло"),
  expired: bi("older than the window — refresh for the current figures", "старіше за вікно — онови для актуальних цифр"),
  noData: bi("Not enough data: the source has no figures for this token.", "Даних недостатньо: у джерела немає цифр для цього токена."),
  unavailable: bi("The analysis is not available right now.", "Аналіз зараз недоступний."),
  buys: bi("buys", "покупки"),
  sells: bi("sells", "продажі"),
  movementNote: bi("movement, not trades", "переміщення, не угоди"),
  addressesNote: bi("addresses, not people", "адреси, не люди"),
  window24h: bi("24h", "24 год"),
  window7d: bi("7d", "7 дн"),
  windowNow: bi("now", "зараз"),
  mustBe: bi("Must be", "Має бути"),
  stateRenounced: bi("renounced", "відкинуто"),
  statePresent: bi("present", "є"),
  windowLabel: bi("Window", "Вікно"),
  coverage: bi("Coverage", "Охоплення"),
  families: bi("Answered by", "Відповіли"),
  familyScreener: bi("the token screener (trades of the whole market)", "скринер токенів (угоди всього ринку)"),
  familyFlows: bi("flow intelligence (the source's labelled groups)", "розвідка потоків (позначені групи джерела)"),
  expiresAt: bi("Counted current until", "Вважається актуальним до"),
  method: bi("How to read it", "Як це читати"),
  methodText: bi(
    "DEX volume counts confirmed trades of the whole market in the window. A movement to or from a labelled group is a transfer between addresses — it may or may not be a trade, and a label is the source's classification, not a person. Nothing here is a price, a quote or advice.",
    "Обсяг DEX рахує підтверджені угоди всього ринку за вікно. Рух до позначеної групи чи з неї — це переказ між адресами: він може бути угодою, а може й не бути, а мітка — класифікація джерела, не особа. Нічого тут не є ціною, котируванням чи порадою.",
  ),
  rights: bi("Shown under the source's redistribution terms; figures are not kept beyond their window.", "Показано за умовами перепоказу джерела; цифри не зберігаються довше за своє вікно."),
  reasonPrefix: bi("Reason", "Причина"),
} as const;

export type EvidenceWord = keyof typeof EVIDENCE_WORDS;

export function evidenceWordsFor(locale: WorkspaceLocale): (word: EvidenceWord) => string {
  return (word) => EVIDENCE_WORDS[word][locale];
}

/** `$700K`, `−$9.8K`, `$1.28M` — compact USD with the sign in front of the dollar. */
export function fmtSignedCompact(value: number, locale: WorkspaceLocale): string {
  const tag = locale === "uk" ? "uk-UA" : "en-US";
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  const number = (n: number, digits: number) => new Intl.NumberFormat(tag, { maximumFractionDigits: digits }).format(n);
  if (abs >= 1_000_000_000) return `${sign}$${number(abs / 1_000_000_000, 2)}B`;
  if (abs >= 1_000_000) return `${sign}$${number(abs / 1_000_000, 2)}M`;
  if (abs >= 10_000) return `${sign}$${number(abs / 1_000, 0)}K`;
  if (abs >= 1_000) return `${sign}$${number(abs / 1_000, 1)}K`;
  return `${sign}$${number(abs, abs >= 1 ? 0 : 2)}`;
}

export function fmtAddresses(value: number, locale: WorkspaceLocale): string {
  const n = Math.round(value);
  if (locale === "uk") {
    const last = n % 10;
    const tens = n % 100;
    const word = tens >= 11 && tens <= 14 ? "адрес" : last === 1 ? "адреса" : last >= 2 && last <= 4 ? "адреси" : "адрес";
    return `${n.toLocaleString("uk-UA")} ${word}`;
  }
  return `${n.toLocaleString("en-US")} ${n === 1 ? "address" : "addresses"}`;
}

/**
 * The source's own coverage notes in the person's language. The provider
 * writes them for developers (field names, `always 0 (not tracked)`); the
 * card says what they mean and never prints a field name. A note the card
 * does not recognise is summarised, not quoted.
 */
export function coverageWords(warnings: readonly string[], locale: WorkspaceLocale, fallback: string): string {
  const uk = locale === "uk";
  const said = new Set<string>();
  for (const warning of warnings) {
    const lower = warning.toLowerCase();
    if (lower.includes("exchange_wallet_count") || lower.includes("fresh_wallets_wallet_count")) {
      said.add(uk ? "Джерело не рахує кількість адрес бірж і нових гаманців; їхній рух порахований." : "The source does not count exchange or fresh-wallet addresses; their movement is still counted.");
    } else if (lower.includes("fresh_wallets")) {
      said.add(uk ? "Джерело не подає рух нових гаманців для цього вікна." : "The source gives no fresh-wallet movement for this window.");
    } else if (lower.includes("did not answer") || lower.includes("no movement figures") || lower.includes("no trading figures")) {
      said.add(uk ? "Частина цифр не надійшла від джерела." : "Part of the figures did not come from the source.");
    } else if (warning.trim().length > 0) {
      said.add(uk ? "Джерело зазначає обмеження щодо частини цифр." : "The source notes a limitation on part of the figures.");
    }
  }
  return said.size > 0 ? [...said].join(" ") : fallback;
}

export function fmtClock(iso: string, locale: WorkspaceLocale): string {
  return `${new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(iso))} UTC`;
}

export function windowWord(window: EvidenceWindow, locale: WorkspaceLocale): string {
  return window === "24h" ? EVIDENCE_WORDS.window24h[locale] : window === "7d" ? EVIDENCE_WORDS.window7d[locale] : EVIDENCE_WORDS.windowNow[locale];
}

/** A figure in the person's language by its unit: `$250,000`, `38,7%`, `1 016 981`, `renounced`. */
export function fmtByUnit(value: number, unit: EvidenceUnit, locale: WorkspaceLocale): string {
  const tag = locale === "uk" ? "uk-UA" : "en-US";
  if (unit === "wallets") return fmtAddresses(value, locale);
  if (unit === "usd") return fmtSignedCompact(value, locale);
  if (unit === "percent") {
    const digits = Math.abs(value) >= 10 ? 1 : 2;
    return `${new Intl.NumberFormat(tag, { maximumFractionDigits: digits }).format(Number(value.toFixed(digits)))}%`;
  }
  if (unit === "count") return new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }).format(Math.round(value));
  return value >= 1 ? EVIDENCE_WORDS.statePresent[locale] : EVIDENCE_WORDS.stateRenounced[locale];
}

const OPERATOR_WORDS: Readonly<Record<EvidenceOperator, Bi>> = {
  gte: bi("at least", "не менше ніж"),
  gt: bi("above", "більше ніж"),
  lte: bi("at most", "не більше ніж"),
  lt: bi("below", "менше ніж"),
};

export function operatorWord(operator: EvidenceOperator, locale: WorkspaceLocale): string {
  return OPERATOR_WORDS[operator][locale];
}

/** The rule as a person reads it: “24h · DEX trading volume at least $250,000”; a point-in-time figure carries no window (“share held by the top 10 holders at most 40%”); an authority reads as its state (“mint authority — renounced”). */
export function conditionSentence(condition: Readonly<{ metric: EvidenceMetricId; window: EvidenceWindow; operator: EvidenceOperator; threshold: number }>, locale: WorkspaceLocale): string {
  const metric = evidenceMetric(condition.metric);
  if (!metric) return condition.metric;
  const prefix = condition.window === "now" ? "" : `${windowWord(condition.window, locale)} · `;
  if (metric.unit === "flag") return `${prefix}${metric.words[locale].sentence} — ${fmtByUnit(condition.threshold, "flag", locale)}`;
  const figure = metric.unit === "usd" ? formatEvidenceValue(condition.threshold, "usd") : fmtByUnit(condition.threshold, metric.unit, locale);
  return `${prefix}${metric.words[locale].sentence} ${operatorWord(condition.operator, locale)} ${figure}`;
}
