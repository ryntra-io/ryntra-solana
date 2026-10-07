/**
 * How the price condition is said on the company page: in the rule's sheet,
 * over the rule's purchase and in the Review. The figures are the
 * judgement's own — the rule's tick, the order route and this page judge the
 * same facts with the same function (`lib/autoinvest/price-condition.ts`);
 * these are only its words.
 *
 * Pure and client-safe.
 */

import { dataTimeWords, referencePhrase, standingWords, type PriceCheck, type PriceReference } from "../../../lib/autoinvest/price-condition.ts";
import { pctWord, priceWord, type RuleLocale } from "../../../lib/autoinvest/words.ts";

/** The data's time on a clock, or null when the judgement has none. */
function at(check: Pick<PriceCheck, "dataAt">, nowMs: number, timeZone: string, lang: RuleLocale): string | null {
  const ms = check.dataAt ? Date.parse(check.dataAt) : Number.NaN;
  return Number.isFinite(ms) ? dataTimeWords(ms, nowMs, timeZone, lang) : null;
}

/** «ліміт 5 %» · «limit 5%». */
export function limitWords(limitPct: number, lang: RuleLocale): string {
  return lang === "uk" ? `ліміт ${pctWord(limitPct, "uk")}` : `limit ${pctWord(limitPct, "en")}`;
}

/** The rule's condition as a short fact: «не дорожче за оцінку PreStocks більш ніж на 5 %» · «at most 5% above PreStocks' valuation». */
export function conditionShort(limitPct: number, reference: PriceReference | null, lang: RuleLocale): string {
  return lang === "uk"
    ? `не дорожче за ${referencePhrase(reference, "uk", "against")} більш ніж на ${pctWord(limitPct, "uk")}`
    : `at most ${pctWord(limitPct, "en")} above ${referencePhrase(reference, "en", "against")}`;
}

/**
 * The condition judged now, under the chips of a rule being written: «Зараз
 * ціна на 30 % дорожча за оцінку PreStocks — купівлю буде відкладено» · «…
 * у межах умови» · «Свіжих даних зараз немає — правило чекатиме на них».
 */
export function conditionNowLine(check: PriceCheck, lang: RuleLocale): string {
  const standing = standingWords(check, lang);
  if (check.verdict === "stale" || check.verdict === "unavailable" || standing === null) {
    return lang === "uk" ? "Свіжих даних зараз немає — правило чекатиме на них." : "No fresh data right now — the rule would wait for them.";
  }
  if (check.verdict === "above") return lang === "uk" ? `Зараз ціна ${standing} — купівлю буде відкладено.` : `Now the price is ${standing} — the purchase would be deferred.`;
  return lang === "uk" ? `Зараз ціна ${standing} — у межах умови.` : `Now the price is ${standing} — within the condition.`;
}

/**
 * The condition's line in the Review and over a rule's purchase: «+2,1 % до
 * оцінки PreStocks $1 000,00 · ліміт 5 % · дані 10:32» — the deviation, the
 * reference and its figure, the limit, the data's time.
 */
export function conditionReviewLine(check: PriceCheck, nowMs: number, timeZone: string, lang: RuleLocale): string {
  const time = at(check, nowMs, timeZone, lang);
  const parts: string[] = [];
  const figure = check.referenceUsd !== null ? priceWord(check.referenceUsd, lang) : null;
  if (check.deviationPct !== null) {
    const sign = check.deviationPct > 0 ? "+" : check.deviationPct < 0 ? "−" : "";
    const size = pctWord(Math.abs(check.deviationPct), lang, 1);
    const reference = referencePhrase(check.reference, lang, "of");
    parts.push(lang === "uk" ? `${sign}${size} до ${reference}${figure ? ` ${figure}` : ""}` : `${sign}${size} against ${reference}${figure ? ` of ${figure}` : ""}`);
  } else if (figure) {
    parts.push(`${referencePhrase(check.reference, lang, "name")} ${figure}`);
  }
  parts.push(limitWords(check.limitPct, lang));
  if (time) parts.push(lang === "uk" ? `дані ${time}` : `data at ${time}`);
  return parts.join(" · ");
}

/**
 * Why a rule's purchase waits, said on the page: «OpenAI на 30 % дорожча за
 * оцінку PreStocks (твій ліміт 5 %) · дані 18:56» · «OpenAI — дані про ціну
 * застаріли · останні — 17:00» · «OpenAI — зараз немає орієнтира».
 */
export function deferralLine(check: PriceCheck, name: string, nowMs: number, timeZone: string, lang: RuleLocale): string {
  const time = at(check, nowMs, timeZone, lang);
  if (check.verdict === "above" && check.deviationPct !== null) {
    const standing = standingWords(check, lang);
    const limit = lang === "uk" ? `(твій ліміт ${pctWord(check.limitPct, "uk")})` : `(your limit ${pctWord(check.limitPct, "en")})`;
    const head = lang === "uk" ? `${name} ${standing} ${limit}` : `${name} is ${standing} ${limit}`;
    return time ? `${head} · ${lang === "uk" ? `дані ${time}` : `data at ${time}`}` : head;
  }
  if (check.verdict === "stale") {
    const head = lang === "uk" ? `${name} — дані про ціну застаріли` : `${name} — price data out of date`;
    return time ? `${head} · ${lang === "uk" ? `останні — ${time}` : `latest at ${time}`}` : head;
  }
  return lang === "uk" ? `${name} — зараз немає орієнтира` : `${name} — no reference right now`;
}

/**
 * A token's condition while its rule is written (1.31.0): the reference is
 * the price now, kept when the rule is turned on, so the line says the
 * ceiling it makes — «Орієнтир — ціна зараз $150,00: правило не купить
 * дорожче за $157,50».
 */
export function anchorNowLine(priceUsd: number, limitPct: number, lang: RuleLocale): string {
  const ceiling = priceWord(priceUsd * (1 + limitPct / 100), lang);
  return lang === "uk"
    ? `Орієнтир — ціна зараз ${priceWord(priceUsd, "uk")}: правило не купить дорожче за ${ceiling}.`
    : `The reference is the price now, ${priceWord(priceUsd, "en")}: the rule won't buy above ${ceiling}.`;
}

/** A token rule's anchor as it stands: «$150,00 · до $157,50» · «$150.00 · up to $157.50». */
export function anchorStandingLine(referenceUsd: number, limitPct: number, lang: RuleLocale): string {
  const ceiling = priceWord(referenceUsd * (1 + limitPct / 100), lang);
  return lang === "uk" ? `${priceWord(referenceUsd, "uk")} · купує до ${ceiling}` : `${priceWord(referenceUsd, "en")} · buys up to ${ceiling}`;
}
