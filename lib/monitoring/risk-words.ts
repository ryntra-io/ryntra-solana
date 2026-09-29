/**
 * The words of «Ризик портфеля», in both languages (canon v5 §11;
 * `RYN-PROTECT-SIGNAL-001`, subtask 2): the state's name, the reason «Увага»
 * names with the figures the server judged it on, what could not be read, and
 * the one action. Pure: a reader passes its own per-cent formatter. The state
 * itself is never decided here — it arrives from the server
 * (`portfolio-risk.ts`).
 */

import type { RiskFinding, RiskGap, RiskState } from "./portfolio-risk.ts";

export type RiskLang = "en" | "uk";
type Bi = Readonly<{ en: string; uk: string }>;
const bi = (en: string, uk: string): Bi => ({ en, uk });

export const RISK_STATE_WORDS: Readonly<Record<RiskState, Bi>> = {
  normal: bi("Normal", "Нормальний"),
  attention: bi("Attention", "Увага"),
  unknown: bi("Could not check", "Не вдалося перевірити"),
};

export const RISK_WORDS = {
  title: bi("Portfolio risk", "Ризик портфеля"),
  look: bi("Take a look", "Подивитись"),
  openSale: bi("Open the sale", "Відкрити продаж"),
  setUp: bi("Set it up", "Налаштувати"),
  tryAgain: bi("Try again", "Спробувати ще раз"),
  /** «Увага» on what was read, while something else was not: said, so no one reads the rest as checked. */
  restUnread: bi("The rest could not be checked", "Решту не вдалося перевірити"),
  checking: bi("Checking…", "Перевіряємо…"),
  unproven: bi("Confirm the wallet to check it", "Підтвердь гаманець, щоб перевірити"),
  confirm: bi("Confirm", "Підтвердити"),
  confirming: bi("Confirming…", "Підтверджуємо…"),
  unread: bi("Could not be read just now", "Зараз не вдалося прочитати"),
} as const;

export type RiskWord = keyof typeof RISK_WORDS;

export function riskWord(key: RiskWord, lang: RiskLang): string {
  return RISK_WORDS[key][lang];
}

export function riskStateWord(state: RiskState, lang: RiskLang): string {
  return RISK_STATE_WORDS[state][lang];
}

/** «N more» — the reasons after the first, a tap away. */
export function riskMoreWord(count: number, lang: RiskLang): string {
  return lang === "uk" ? `ще ${count}` : `${count} more`;
}

/** What could not be read, most basic first: the wallet, the companies' market, the positions' limits, the SOL balance, a price. */
const GAP_ORDER: readonly RiskGap[] = ["holdings", "market", "exits", "balance", "prices"];

const GAP_WORDS: Readonly<Record<RiskGap, Bi>> = {
  holdings: bi("part of the wallet is unread", "частину гаманця не прочитано"),
  market: bi("company prices are unread", "ціни компаній не прочитано"),
  exits: bi("the positions' limits are unread", "межі позицій не прочитано"),
  balance: bi("the SOL balance is unread", "баланс SOL не прочитано"),
  prices: bi("a fresh price is missing", "бракує свіжої ціни"),
};

/** Why «Не вдалося перевірити», in a few words — the first gap that stands behind the rest. */
export function riskGapLine(gaps: readonly RiskGap[], lang: RiskLang): string | null {
  const first = GAP_ORDER.find((gap) => gaps.includes(gap));
  return first ? GAP_WORDS[first][lang] : null;
}

/**
 * The reason «Увага» names, with the figures it stands on: a position at its
 * limit or target, a company with no loss limit over the weekend, one asset
 * above its cap, the private companies above theirs. No verb that takes a
 * gender — a company's name leads, the fact follows.
 */
export function riskFindingLine(finding: Pick<RiskFinding, "reason" | "name" | "symbol" | "sharePct" | "capPct" | "watchReason">, lang: RiskLang, pct: (value: number) => string, capPct: (value: number) => string = pct): string {
  const w = (en: string, uk: string) => (lang === "uk" ? uk : en);
  const name = finding.name || finding.symbol || w("A position", "Позиція");
  const share = finding.sharePct !== null ? pct(finding.sharePct) : null;
  const cap = finding.capPct !== null ? capPct(finding.capPct) : null;
  switch (finding.reason) {
    case "action":
      return finding.watchReason === "target" ? w(`${name}: the price reached your target`, `${name}: ціна дійшла до цілі`) : w(`${name}: the price reached your loss limit`, `${name}: ціна дійшла до межі збитку`);
    case "weekend-no-limit":
      return w(`${name}: no loss limit over the weekend`, `${name}: без межі збитку на вихідні`);
    case "concentration":
      return share && cap ? w(`${name} is ${share} of the wallet — above ${cap}`, `${name} — ${share} гаманця, понад ${cap}`) : w(`${name}: too large a share of the wallet`, `${name}: завелика частка гаманця`);
    case "private-share":
      return share && cap ? w(`Private companies are ${share} of the wallet — above ${cap}`, `Приватні компанії — ${share} гаманця, понад ${cap}`) : w("Private companies: too large a share of the wallet", "Приватні компанії: завелика частка гаманця");
  }
}
