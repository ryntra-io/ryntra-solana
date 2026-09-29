/**
 * A company page's words for a search result and a share (the plan of
 * `RYN-SITE-V5-001` §3): the company's name first, never the token's; what the
 * token is in its issuer's words; only the blocks the page actually draws —
 * «key figures from SEC filings» only where the page has them — and never a
 * price, which caches would keep for days, nor «from $1», since each company's
 * minimum is its own. The title within 60 characters, the description within
 * 160, each falling back to a shorter form rather than being cut.
 */

import type { CompanyPath } from "../stocks/company-path.ts";

export type CompanySeoLocale = "en" | "uk";

export type CompanySeoInput = Readonly<{
  /** The company as a person names it (`companyDisplayName`). */
  name: string;
  /** The token. */
  symbol: string;
  issuer: "xstocks" | "backpack" | "ondo" | "prestocks";
  instrumentClass: "listed-equity" | "pre-ipo";
  /** The company's filed facts, where Ryntra has read them: a fund, an operating company, a foreign filer. */
  facts: Readonly<{ kind: "operating" | "fund" | "other"; foreign: boolean }> | null;
  path: CompanyPath | null;
}>;

export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 160;

function first(candidates: readonly string[], max: number): string {
  return candidates.find((text) => text.length <= max) ?? candidates[candidates.length - 1];
}

/** The private token's swap window after an IPO, while it is open, with the exchange the company now trades on. */
function openSwap(input: CompanySeoInput): Readonly<{ into: string | null; deadline: string; exchange: string | null }> | null {
  const swap = input.path?.swap;
  if (!swap || !swap.open || input.path?.at !== "private") return null;
  const exchange = input.path.steps.find((step) => step.step === "exchange")?.exchange ?? null;
  return { into: swap.into?.symbol ?? null, deadline: swap.deadline, exchange };
}

function listedExchange(input: CompanySeoInput): string | null {
  if (input.path?.at !== "solana") return null;
  return input.path.steps.find((step) => step.step === "exchange")?.exchange ?? null;
}

const pad = (value: number): string => String(value).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function deadlineWords(iso: string, locale: CompanySeoLocale): string {
  const at = new Date(iso);
  const time = `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`;
  return locale === "uk"
    ? `${pad(at.getUTCDate())}.${pad(at.getUTCMonth() + 1)}.${at.getUTCFullYear()}, ${time}`
    : `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}, ${time}`;
}

/** What the token is, for the title: a tokenized stock or fund, a pre-IPO token, a pre-IPO token after its company's IPO. */
function kindWords(input: CompanySeoInput, locale: CompanySeoLocale): string {
  const uk = locale === "uk";
  if (input.instrumentClass === "pre-ipo") {
    if (openSwap(input)) return uk ? "токен PreStocks після IPO" : "PreStocks token after the IPO";
    return uk ? "токен до IPO від PreStocks" : "pre-IPO token by PreStocks";
  }
  if (input.facts?.kind === "fund") return uk ? "токенізований фонд" : "tokenized fund";
  return uk ? "токенізована акція" : "tokenized stock";
}

export function companySearchTitle(input: CompanySeoInput, locale: CompanySeoLocale): string {
  const kind = kindWords(input, locale);
  return first([`${input.name} (${input.symbol}) — ${kind} · Ryntra`, `${input.name} (${input.symbol}) — ${kind}`, `${input.name} — ${kind}`, `${input.name} (${input.symbol})`], TITLE_MAX);
}

export function companySearchDescription(input: CompanySeoInput, locale: CompanySeoLocale): string {
  const { name, symbol } = input;
  const uk = locale === "uk";
  const swap = openSwap(input);
  if (swap) {
    const when = deadlineWords(swap.deadline, locale);
    const into = swap.into ?? (uk ? "токен на біржі" : "the listed token");
    const where = swap.exchange;
    return first(
      uk
        ? [`${symbol} — токен PreStocks, не акція. ${name} ${where ? `уже на ${where}` : "уже на біржі"}: обміняй ${symbol} на ${into} до ${when}, інакше токен згорить.`, `${symbol} — токен PreStocks, не акція. Обміняй ${symbol} на ${into} до ${when}, інакше токен згорить.`]
        : [`${symbol} is a PreStocks token, not a share. ${name} is ${where ? `listed on ${where}` : "now public"}: swap ${symbol} for ${into} by ${when}, or the token expires.`, `${symbol} is a PreStocks token, not a share. Swap ${symbol} for ${into} by ${when}, or the token expires.`],
      DESCRIPTION_MAX,
    );
  }
  if (input.instrumentClass === "pre-ipo") {
    return first(
      uk
        ? [`${symbol} — токен PreStocks з економічною експозицією на ${name}, не акція. Ціна до оцінки PreStocks, шлях до IPO і ризики.`, `${symbol} — токен PreStocks на ${name}, не акція. Ціна до оцінки PreStocks і ризики.`]
        : [`${symbol} is PreStocks' token of economic exposure to ${name} — not a share. The price against PreStocks' valuation, the path to an IPO, and the risks.`, `${symbol} is PreStocks' token on ${name} — not a share. The price against PreStocks' valuation and the risks.`],
      DESCRIPTION_MAX,
    );
  }
  const filed = input.facts?.kind === "operating" && !input.facts.foreign;
  if (input.issuer === "backpack") {
    return first(
      uk
        ? [`${symbol} — токен Backpack, що відстежує ціну акції ${name}. Ціна в $, ${filed ? "ключові показники зі звітів SEC" : "про компанію"} і що ти купуєш.`, `${symbol} — токен Backpack, що відстежує ціну акції ${name}. Ціна в $ і що ти купуєш.`]
        : [`${symbol} is a Backpack token that tracks the share price of ${name}. The price in $, ${filed ? "key figures from SEC filings" : "about the company"} and what you buy.`, `${symbol} is a Backpack token that tracks the share price of ${name}. The price in $ and what you buy.`],
      DESCRIPTION_MAX,
    );
  }
  if (input.issuer === "ondo") {
    return first(
      uk
        ? [`${symbol} — токен Ondo, що відстежує ціну акції ${name} разом із дивідендами. Ціна в $ і що ти купуєш.`, `${symbol} — токен Ondo на ${name}. Ціна в $ і що ти купуєш.`]
        : [`${symbol} is an Ondo token that tracks ${name}'s share price with its dividends. The price in $ and what you buy.`, `${symbol} is an Ondo token on ${name}. The price in $ and what you buy.`],
      DESCRIPTION_MAX,
    );
  }
  const exchange = listedExchange(input);
  if (exchange) {
    return first(
      uk
        ? [`${symbol} — токен, що відстежує ціну акції ${name} на ${exchange} (xStocks). Ціна в $, шлях компанії від PreStocks до ${exchange} і що ти купуєш.`, `${symbol} — токен, що відстежує ціну акції ${name} на ${exchange} (xStocks). Ціна в $ і що ти купуєш.`]
        : [`${symbol} is a token that tracks ${name}'s share price on ${exchange} (xStocks). The price in $, the company's path from PreStocks to ${exchange}, and what you buy.`, `${symbol} is a token that tracks ${name}'s share price on ${exchange} (xStocks). The price in $ and what you buy.`],
      DESCRIPTION_MAX,
    );
  }
  if (input.facts?.kind === "fund") {
    return first(
      uk
        ? [`${symbol} — токен, що відстежує ${name} (xStocks). Ціна в $, що це за фонд, що ти купуєш — і купівля в доларах.`, `${symbol} — токен, що відстежує ${name} (xStocks). Ціна в $ і що ти купуєш.`]
        : [`${symbol} is a token that tracks the ${name} (xStocks). The price in $, what the fund is, what you buy — and a purchase in dollars.`, `${symbol} is a token that tracks the ${name} (xStocks). The price in $ and what you buy.`],
      DESCRIPTION_MAX,
    );
  }
  const about = uk ? (filed ? "ключові показники зі звітів SEC" : "про компанію") : filed ? "key figures from SEC filings" : "about the company";
  return first(
    uk
      ? [`${symbol} — токен, що відстежує ціну акції ${name} (xStocks). Ціна в $, ${about}, що ти купуєш — і купівля в доларах.`, `${symbol} — токен, що відстежує ціну акції ${name} (xStocks). Ціна в $, ${about} і що ти купуєш.`, `${symbol} — токен, що відстежує ціну акції ${name} (xStocks). Ціна в $ і що ти купуєш.`]
      : [`${symbol} is a token that tracks ${name}'s share price (xStocks). The price in $, ${about}, what you buy — and a purchase in dollars.`, `${symbol} is a token that tracks ${name}'s share price (xStocks). The price in $, ${about} and what you buy.`, `${symbol} is a token that tracks ${name}'s share price (xStocks). The price in $ and what you buy.`],
    DESCRIPTION_MAX,
  );
}
