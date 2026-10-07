/**
 * «Умова ціни» — a rule buys only when the price is not above its reference
 * by more than the person's limit and the data are fresh.
 *
 * **The reference** is the one Ryntra already reads for the company: for a
 * private company, PreStocks' own valuation of one token (`issuerMark`,
 * called so — never a fair price); for a listed one, the reference per share
 * the screener's «Відхилення» is drawn against — the issuer's quote, or the
 * market feed where one is configured. The price is the token's own on the
 * venue, on the reference's basis (per token, per share). For a token of the
 * venue's list (1.31.0) — a coin, a meme, a new token — the reference is the
 * market price when the rule was turned on (`enabled`), kept on the rule and
 * taken again whenever it is turned on after a pause: it is a fixed point, so
 * only the price now must be fresh.
 *
 * **The condition** is «Не купувати, якщо дорожче за орієнтир більш ніж на
 * N %»: the price may stand at most N % above the reference — a discount
 * always passes. The figure compared is the one a person reads, to a tenth
 * of a per cent, so «на 5,0 % дорожча» never waits on a 5 % limit.
 *
 * **Fresh or nothing.** The price and the reference each carry the time they
 * stand for; either older than `PRICE_CONDITION_MAX_AGE_MS`, a copy the
 * source itself calls stale, or a figure that is missing makes the rule wait
 * — an unknown is never a pass. The data's time is the older of the
 * two: the facts are only as new as their oldest part.
 *
 * Pure and client-safe: the rule's tick, the order route and the company
 * page's Review judge the same facts with the same function.
 */

import { PRICE_CONDITION_DEFAULT_PCT, PRICE_CONDITION_MAX_AGE_MINUTES, PRICE_CONDITION_MAX_PCT, PRICE_CONDITION_MIN_PCT, PRICE_CONDITION_PRESETS_PCT } from "./limits.ts";
import { wallClockAt } from "./schedule.ts";
import { pctWord, priceWord, type RuleLocale } from "./words.ts";

export { PRICE_CONDITION_DEFAULT_PCT, PRICE_CONDITION_MAX_PCT, PRICE_CONDITION_MIN_PCT, PRICE_CONDITION_PRESETS_PCT };
/** How old the price and its reference may be and still decide — the same half hour a fall is read within (`./dip.ts`). */
export const PRICE_CONDITION_MAX_AGE_MS = PRICE_CONDITION_MAX_AGE_MINUTES * 60_000;

/** Whose figure the price is set against: PreStocks' valuation of a token, the listed company's reference per share, or (1.31.0) a token's market price when its rule was turned on. */
export const PRICE_REFERENCES = ["prestocks", "issuer", "market", "enabled"] as const;
export type PriceReference = (typeof PRICE_REFERENCES)[number];

/** `met` the rule may offer its purchase · `above` dearer than the limit · `stale` the data are too old · `unavailable` a figure is missing. */
export const PRICE_CONDITION_VERDICTS = ["met", "above", "stale", "unavailable"] as const;
export type PriceConditionVerdict = (typeof PRICE_CONDITION_VERDICTS)[number];

export type PriceCondition = Readonly<{ limitPct: number }>;

/** 1.31.0: a token's market price when its rule was turned on — the reference a coin's condition stands against. */
export type PriceAnchor = Readonly<{ referenceUsd: number; referenceAt: string }>;

/** What the condition is judged on: the price and the reference, each with the instant it stands for. */
export type PriceFacts = Readonly<{
  reference: PriceReference | null;
  priceUsd: number | null;
  priceAtMs: number | null;
  referenceUsd: number | null;
  referenceAtMs: number | null;
  /** The source calls its own copy stale (PreStocks' catalogue served under grace, a reference judged stale). */
  referenceStale: boolean;
}>;

/** One judgement of the condition, as a rule's occurrence keeps it and the Review draws it. */
export type PriceCheck = Readonly<{
  verdict: PriceConditionVerdict;
  reference: PriceReference | null;
  limitPct: number;
  priceUsd: number | null;
  referenceUsd: number | null;
  /** How far the price stands above (+) or below (−) the reference, per cent, to a tenth. */
  deviationPct: number | null;
  /** The data's time — the older of the price's and the reference's. */
  dataAt: string | null;
  checkedAt: string;
}>;

const positive = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const instant = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const tenth = (value: number): number => Math.round(value * 10) / 10;

/** A limit a rule may carry: whole per cent within the bounds. */
export function isPriceConditionLimit(limitPct: unknown): limitPct is number {
  return typeof limitPct === "number" && Number.isInteger(limitPct) && limitPct >= PRICE_CONDITION_MIN_PCT && limitPct <= PRICE_CONDITION_MAX_PCT;
}

/** The price against the reference, per cent to a tenth; null without both figures. */
export function deviationOf(priceUsd: number | null, referenceUsd: number | null): number | null {
  if (!positive(priceUsd) || !positive(referenceUsd)) return null;
  const deviation = tenth((priceUsd / referenceUsd - 1) * 100);
  return Object.is(deviation, -0) ? 0 : deviation;
}

/** Judge the condition now. Missing figures wait, old data wait, a price above the limit waits; only fresh data within it are met. */
export function checkPriceCondition(limitPct: number, facts: PriceFacts | null | undefined, nowMs: number): PriceCheck {
  const checkedAt = new Date(nowMs).toISOString();
  const base = {
    reference: facts?.reference ?? null,
    limitPct,
    priceUsd: positive(facts?.priceUsd) ? facts.priceUsd : null,
    referenceUsd: positive(facts?.referenceUsd) ? facts.referenceUsd : null,
    checkedAt,
  };
  const deviationPct = deviationOf(base.priceUsd, base.referenceUsd);
  /* The price when the rule was turned on is a fixed point: its age is the rule's, never staleness — only the price now must be fresh. */
  const fixed = facts?.reference === "enabled";
  const times = (fixed ? [facts?.priceAtMs] : [facts?.priceAtMs, facts?.referenceAtMs]).filter(instant);
  const dataAt = times.length > 0 ? new Date(Math.min(...times)).toISOString() : null;
  if (!facts || base.reference === null || deviationPct === null) return { ...base, deviationPct, dataAt, verdict: "unavailable" };
  const old = (at: number | null): boolean => !instant(at) || nowMs - at > PRICE_CONDITION_MAX_AGE_MS;
  if (facts.referenceStale || old(facts.priceAtMs) || (!fixed && old(facts.referenceAtMs))) return { ...base, deviationPct, dataAt, verdict: "stale" };
  return { ...base, deviationPct, dataAt, verdict: deviationPct > limitPct ? "above" : "met" };
}

/** The parts of a stock row the condition reads — the server's row and the page's row alike. */
export type PriceFactsRow = Readonly<{
  representation: Readonly<{ instrument?: Readonly<{ class: string }> | null }>;
  market: Readonly<{ priceUsd: number | null; observedAt: string | null }>;
  tokenPerShareUsd: number | null;
  reference: Readonly<{ state: string; perShare: number | null; source: Readonly<{ id: string }>; observedAt: string | null; fetchedAt: string | null }>;
  issuerMark: Readonly<{ source: Readonly<{ id: string }>; perUnit: number | null; fetchedAt: string; stale: boolean }> | null;
}>;

const parsed = (at: string | null | undefined): number | null => {
  if (!at) return null;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : null;
};

/** Which reference a company has at all: PreStocks' valuation for a private one, a reference per share for a listed one; null when none is read. */
export function referenceKindOf(row: PriceFactsRow): PriceReference | null {
  if (row.representation.instrument?.class === "pre-ipo") return row.issuerMark?.source.id === "issuer-prestocks" ? "prestocks" : null;
  if (row.reference.source.id === "issuer-xstocks") return "issuer";
  if (row.reference.source.id === "pyth") return "market";
  return null;
}

/**
 * The facts a stock row states. `marketObservedAtMs` stands in for a price
 * the row does not date itself — the universe's own read time, never the
 * clock: a price nobody dated is not fresh.
 */
export function priceFactsOf(row: PriceFactsRow, marketObservedAtMs: number | null = null): PriceFacts {
  const reference = referenceKindOf(row);
  const priceAtMs = parsed(row.market.observedAt) ?? marketObservedAtMs;
  if (reference === "prestocks") {
    return {
      reference,
      priceUsd: row.market.priceUsd,
      priceAtMs,
      referenceUsd: row.issuerMark?.perUnit ?? null,
      referenceAtMs: parsed(row.issuerMark?.fetchedAt),
      referenceStale: row.issuerMark?.stale === true,
    };
  }
  return {
    reference,
    /* A listed token on the reference's basis: its price per share, which the row draws only when the chain stated the multiplier. */
    priceUsd: row.tokenPerShareUsd,
    priceAtMs,
    referenceUsd: row.reference.perShare,
    /* The source's own observation time where it states one (a feed's publish time), else Ryntra's fetch. */
    referenceAtMs: parsed(row.reference.observedAt ?? row.reference.fetchedAt),
    referenceStale: row.reference.state === "stale",
  };
}

/**
 * The facts a token of the venue's list states (1.31.0): its market price
 * now, with the time it was read, against the price when its rule was turned
 * on. No anchor, no price — `unavailable`.
 */
export function anchorFactsOf(anchor: PriceAnchor | null | undefined, price: Readonly<{ usd: number | null; atMs: number | null }> | null): PriceFacts {
  return {
    reference: "enabled",
    priceUsd: price?.usd ?? null,
    priceAtMs: price?.atMs ?? null,
    referenceUsd: anchor?.referenceUsd ?? null,
    referenceAtMs: anchor ? parsed(anchor.referenceAt) : null,
    referenceStale: false,
  };
}

/* ------------------------------------------------------------ words */

/**
 * The reference in the form a sentence needs: `name` on its own («Оцінка
 * PreStocks» · «PreStocks' valuation»), `against` after «дорожча за» / «above»
 * («оцінку PreStocks»), `of` after «до» («+2,1 % до оцінки PreStocks» · «+2.1%
 * against PreStocks' valuation»). PreStocks' figure is its valuation — never a
 * fair price.
 */
const REFERENCE_PHRASES: Readonly<Record<PriceReference, Readonly<Record<RuleLocale, Readonly<{ name: string; against: string; of: string }>>>>> = {
  prestocks: {
    en: { name: "PreStocks' valuation", against: "PreStocks' valuation", of: "PreStocks' valuation" },
    uk: { name: "Оцінка PreStocks", against: "оцінку PreStocks", of: "оцінки PreStocks" },
  },
  issuer: {
    en: { name: "Issuer's reference", against: "the issuer's reference", of: "the issuer's reference" },
    uk: { name: "Орієнтир емітента", against: "орієнтир емітента", of: "орієнтира емітента" },
  },
  market: {
    en: { name: "Market reference", against: "the market reference", of: "the market reference" },
    uk: { name: "Біржовий орієнтир", against: "біржовий орієнтир", of: "біржового орієнтира" },
  },
  enabled: {
    en: { name: "Price when turned on", against: "the price when the rule was turned on", of: "the price when the rule was turned on" },
    uk: { name: "Ціна при ввімкненні", against: "ціну при ввімкненні правила", of: "ціни при ввімкненні правила" },
  },
};

export function referencePhrase(reference: PriceReference | null, locale: RuleLocale, form: "name" | "against" | "of"): string {
  return REFERENCE_PHRASES[reference ?? "issuer"][locale][form];
}

/** Whose figure, as a sentence ends: «оцінку PreStocks» · «PreStocks' valuation». */
function referenceWords(reference: PriceReference | null, locale: RuleLocale): string {
  return referencePhrase(reference, locale, "against");
}

/** The reference named on its own: «Оцінка PreStocks» · «Орієнтир емітента». */
export function referenceName(reference: PriceReference | null, locale: RuleLocale): string {
  return referencePhrase(reference, locale, "name");
}

/** A deviation the way a person reads it: a whole per cent from ten up, one decimal below. */
export function deviationWord(deviationPct: number, locale: RuleLocale): string {
  const size = Math.abs(deviationPct);
  return pctWord(size, locale, size >= 9.95 ? 0 : 1);
}

/** The rule's condition in one line: «Не купувати, якщо дорожче за оцінку PreStocks більш ніж на 5 %». */
export function conditionLine(limitPct: number, reference: PriceReference | null, locale: RuleLocale): string {
  return locale === "uk"
    ? `Не купувати, якщо дорожче за ${referenceWords(reference, "uk")} більш ніж на ${pctWord(limitPct, "uk")}`
    : `Don't buy if it costs more than ${pctWord(limitPct, "en")} above ${referenceWords(reference, "en")}`;
}

/** The data's time on the rule's clock: «10:32» the same day, «24 вер. о 10:32» · «Sep 24 at 10:32» another. */
export function dataTimeWords(atMs: number, nowMs: number, timeZone: string, locale: RuleLocale): string {
  const wall = wallClockAt(atMs, timeZone);
  const today = wallClockAt(nowMs, timeZone);
  const time = `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`;
  if (wall.year === today.year && wall.month === today.month && wall.day === today.day) return time;
  const day = new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { timeZone, day: "numeric", month: "short" }).format(new Date(atMs));
  return locale === "uk" ? `${day} о ${time}` : `${day} at ${time}`;
}

/** How far the price stands from the reference: «на 30 % дорожча за оцінку PreStocks» · «30% above PreStocks' valuation»; «на рівні …» within a twentieth. */
export function standingWords(check: Pick<PriceCheck, "deviationPct" | "reference">, locale: RuleLocale): string | null {
  if (check.deviationPct === null) return null;
  const whose = referenceWords(check.reference, locale);
  if (Math.abs(check.deviationPct) < 0.05) return locale === "uk" ? `на рівні: ${whose}` : `level with ${whose}`;
  const figure = deviationWord(check.deviationPct, locale);
  if (locale === "uk") return `на ${figure} ${check.deviationPct > 0 ? "дорожча" : "дешевша"} за ${whose}`;
  return `${figure} ${check.deviationPct > 0 ? "above" : "below"} ${whose}`;
}

export type DeferralWords = Readonly<Record<RuleLocale, Readonly<{ title: string; reason: string; cta: string }>>>;

/**
 * «Купівлю відкладено» — the reason, the figure and the data's time:
 * «Купівлю відкладено: OpenAI на 30 % дорожча за оцінку PreStocks (твій
 * ліміт 5 %)»; the rule checks again; the one action is to look.
 */
export function deferralWords(input: Readonly<{ name: string; check: PriceCheck; timeZone: string; nowMs: number }>): DeferralWords {
  const { name, check } = input;
  const at = (locale: RuleLocale): string | null => {
    const ms = parsed(check.dataAt);
    return ms === null ? null : dataTimeWords(ms, input.nowMs, input.timeZone, locale);
  };
  const figures = (locale: RuleLocale): string => {
    const parts: string[] = [];
    if (check.priceUsd !== null) parts.push(`${locale === "uk" ? "Ціна" : "Price"} ${priceWord(check.priceUsd, locale)}`);
    if (check.referenceUsd !== null) parts.push(`${referenceName(check.reference, locale)} ${priceWord(check.referenceUsd, locale)}`);
    const time = at(locale);
    if (time) parts.push(locale === "uk" ? `дані ${time}` : `data at ${time}`);
    return parts.join(" · ");
  };
  const again = { en: "The rule checks again.", uk: "Правило перевірить знову." };
  const cta = { en: "View", uk: "Подивитись" };
  if (check.verdict === "above" && check.deviationPct !== null) {
    return {
      en: { title: `Purchase deferred: ${name} is ${standingWords(check, "en")} (your limit ${pctWord(check.limitPct, "en")})`, reason: `${figures("en")}. ${again.en}`, cta: cta.en },
      uk: { title: `Купівлю відкладено: ${name} ${standingWords(check, "uk")} (твій ліміт ${pctWord(check.limitPct, "uk")})`, reason: `${figures("uk")}. ${again.uk}`, cta: cta.uk },
    };
  }
  if (check.verdict === "stale") {
    const en = at("en");
    const uk = at("uk");
    return {
      en: { title: `Purchase deferred: ${name} — price data out of date`, reason: `${en ? `Latest data at ${en}. ` : ""}A rule never buys on old data. ${again.en}`, cta: cta.en },
      uk: { title: `Купівлю відкладено: ${name} — дані про ціну застаріли`, reason: `${uk ? `Останні дані — ${uk}. ` : ""}На старих даних правило не купує. ${again.uk}`, cta: cta.uk },
    };
  }
  return {
    en: { title: `Purchase deferred: ${name} — no reference right now`, reason: `A rule never buys without its reference. ${again.en}`, cta: cta.en },
    uk: { title: `Купівлю відкладено: ${name} — зараз немає орієнтира`, reason: `Без орієнтира правило не купує. ${again.uk}`, cta: cta.uk },
  };
}
