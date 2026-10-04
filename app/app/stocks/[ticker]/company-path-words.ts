/**
 * «Шлях компанії» in words: the steps' names, the line under each, what each
 * token is, the swap's deadline and the issuer's rule — in the reader's
 * language, from the path the server read (`lib/stocks/company-path.ts`). A
 * day is written as the page writes days: «12.06.2026» in Ukrainian, «Jun 12,
 * 2026» in English; the deadline carries the issuer's own minute in UTC. No
 * judgement, no advice. Pure.
 */

import type { CompanyPath, CompanyPathStep, CompanyPathStepId } from "../../../../lib/stocks/company-path.ts";
import type { PathSource } from "../../../../lib/stocks/lifecycle-events.ts";

type Lang = "en" | "uk";

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** «12.06.2026» · «Jun 12, 2026» — a recorded day, `YYYY-MM-DD` or a full ISO time read in UTC. */
export function pathDay(iso: string, lang: Lang): string {
  const at = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00.000Z` : iso);
  const day = at.getUTCDate();
  const month = at.getUTCMonth();
  const year = at.getUTCFullYear();
  if (lang === "uk") return `${String(day).padStart(2, "0")}.${String(month + 1).padStart(2, "0")}.${year}`;
  return `${EN_MONTHS[month]} ${day}, ${year}`;
}

/** «12.03.2027, 23:59 UTC» — the issuer's cut-off with its minute. */
export function pathDeadline(iso: string, lang: Lang): string {
  const at = new Date(iso);
  return `${pathDay(iso, lang)}, ${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")} UTC`;
}

export const PATH_WORDS = {
  title: { uk: "Шлях компанії", en: "The company's path" },
  thisToken: { uk: "цей токен", en: "this token" },
  sources: { uk: "Джерела", en: "Sources" },
  notAnnounced: { uk: "ще не оголошено", en: "not announced yet" },
  now: { uk: "зараз", en: "now" },
} as const satisfies Record<string, Readonly<Record<Lang, string>>>;

const STEP_NAMES: Readonly<Record<CompanyPathStepId, Readonly<Record<Lang, string>>>> = {
  private: { uk: "Приватна · PreStocks", en: "Private · PreStocks" },
  ipo: { uk: "IPO", en: "IPO" },
  exchange: { uk: "Біржа", en: "Exchange" },
  solana: { uk: "Solana", en: "Solana" },
};

export function stepName(step: CompanyPathStepId, lang: Lang): string {
  return STEP_NAMES[step][lang];
}

const usd = (value: number, lang: Lang): string => `$${new Intl.NumberFormat(lang === "uk" ? "uk-UA" : "en-US", { maximumFractionDigits: 2 }).format(value)}`;

/**
 * The line under a step: its day and what happened on it — «з 16.09.2025»
 * for the private token, «12.06.2026» and «$135 за акцію» for the IPO, «Nasdaq · SPCX»
 * for the exchange, «з 12.06.2026» for the token on Solana; «ще не
 * оголошено» for a step nobody announced; «зараз» for the step the company
 * stands at without a recorded day.
 */
export function stepLines(step: CompanyPathStep, lang: Lang): readonly string[] {
  if (step.state === "unannounced") return [PATH_WORDS.notAnnounced[lang]];
  const since = step.date ? (lang === "uk" ? `з ${pathDay(step.date, lang)}` : `since ${pathDay(step.date, lang)}`) : null;
  switch (step.step) {
    case "ipo":
      return [step.date ? pathDay(step.date, lang) : null, step.priceUsd !== null ? (lang === "uk" ? `${usd(step.priceUsd, lang)} за акцію` : `${usd(step.priceUsd, lang)} a share`) : null].filter((part): part is string => part !== null);
    case "exchange":
      return [[step.exchange, step.ticker].filter((part): part is string => !!part).join(" · "), ...(since ? [since] : [])];
    default:
      return [since ?? (step.state === "current" ? PATH_WORDS.now[lang] : "")].filter((line) => line !== "");
  }
}

/**
 * What a token is, in the fewest words: a private company's token
 * is not a share and pays the issuer's fee on every transfer; a listed
 * share's token on Solana is backed one to one and carries no vote.
 */
export function tokenNature(step: "private" | "solana", lang: Lang, feeBps: number | null): string {
  if (step === "solana") return lang === "uk" ? "1:1 до акції · без голосу" : "backed 1:1 · no vote";
  const fee = feeBps !== null && Number.isFinite(feeBps) && feeBps > 0 ? `${new Intl.NumberFormat(lang === "uk" ? "uk-UA" : "en-US", { maximumFractionDigits: 2 }).format(feeBps / 100)}%` : null;
  if (lang === "uk") return fee ? `не акція · комісія ${fee}` : "не акція";
  return fee ? `not a share · ${fee} fee` : "not a share";
}

/**
 * The line under the strip about the private token's swap: its deadline with
 * the issuer's minute, and what happens after it. A holder is told to swap;
 * everyone else reads what SPACEX holders do. A closed window says so.
 */
export function swapLines(swap: NonNullable<CompanyPath["swap"]>, lang: Lang): Readonly<{ holder: string; everyone: string }> {
  const from = swap.from.symbol;
  const into = swap.into?.symbol ?? null;
  if (!swap.open) {
    const line = lang === "uk" ? `Строк обміну ${from} минув ${pathDay(swap.deadline, lang)} — емітент більше не підтримує токен.` : `The swap deadline for ${from} passed on ${pathDay(swap.deadline, lang)} — the issuer no longer supports the token.`;
    return { holder: line, everyone: line };
  }
  const by = pathDeadline(swap.deadline, lang);
  if (lang === "uk") {
    const target = into ? ` на ${into}` : "";
    return { holder: `Обміняй ${from}${target} до ${by} — після строку токен згорить.`, everyone: `Власникам ${from}: обміняти${target} до ${by} — після строку ${from} згорить.` };
  }
  const target = into ? ` for ${into}` : "";
  return { holder: `Swap your ${from}${target} by ${by} — after the deadline the token expires worthless.`, everyone: `${from} holders: swap${target} by ${by} — after the deadline ${from} expires worthless.` };
}

/** «Після IPO — до 9 місяців, щоб обміняти токен.» — the issuer's rule while the company is private. */
export function swapRuleLine(months: number, lang: Lang): string {
  if (lang === "uk") return `Після IPO — до ${months} ${months === 1 ? "місяця" : "місяців"}, щоб обміняти токен.`;
  return `After an IPO — up to ${months} month${months === 1 ? "" : "s"} to swap the token.`;
}

/** A source's line: its name, the document's own day where it has one, and the day Ryntra read it. */
export function sourceLine(source: PathSource, lang: Lang): string {
  const published = source.publishedAt ? pathDay(source.publishedAt, lang) : null;
  const read = lang === "uk" ? `прочитано ${pathDay(source.readAt, lang)}` : `read ${pathDay(source.readAt, lang)}`;
  return [source.label, published, read].filter((part): part is string => part !== null).join(" · ");
}
