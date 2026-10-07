/**
 * The floor a rule's token stands on, and the facts of its risk (1.31.0,
 * «Регулярна купівля для всього»).
 *
 * **What a rule may name.** A tokenized stock the issuer confirms — as since
 * 1.12.0 — or any token of the venue's list with liquidity: a coin («крипта»,
 * verified by the venue and not a meme) or a meme or new token (a meme, or a
 * token the venue has not verified). A token of the list stands on the floor
 * — `RULE_FLOOR_LIQUIDITY_USD` in its pools and `RULE_FLOOR_AGE_HOURS` since
 * its first pool — when the rule is written, when it is turned on again,
 * every time the tick would remind of a purchase, and at the order itself: a
 * rule never reminds of a purchase into a thin pool and never buys into one.
 *
 * **Fresh or nothing.** The liquidity is the venue's own figure with the time
 * it was read; a figure that is missing or older than
 * `RULE_FLOOR_MAX_AGE_MINUTES`, or a first pool the venue does not date, is
 * `unavailable` — an unknown is never a pass.
 *
 * **The facts of risk** are what the venue states about the token — its age,
 * its liquidity, how much the ten largest holders keep, whether anyone can
 * still mint it or freeze it, its organic score and whether the venue
 * verified it — said before the button for a meme or a new token. They are
 * facts, never a verdict about the token.
 *
 * Pure and client-safe: the facts and the clock are arguments.
 */

import { RULE_FLOOR_AGE_HOURS, RULE_FLOOR_LIQUIDITY_USD, RULE_FLOOR_MAX_AGE_MINUTES } from "./limits.ts";

export { RULE_FLOOR_AGE_HOURS, RULE_FLOOR_LIQUIDITY_USD, RULE_FLOOR_MAX_AGE_MINUTES };

/** `stock` a tokenized stock the issuer confirms · `crypto` a token the venue verified, not a meme · `meme` a meme or a token the venue has not verified. */
export const RULE_ASSET_CLASSES = ["stock", "crypto", "meme"] as const;
export type RuleAssetClass = (typeof RULE_ASSET_CLASSES)[number];

/** `met` the token stands on the floor · `below` its liquidity or its age is under it · `unavailable` a figure is missing or old. */
export const RULE_FLOOR_VERDICTS = ["met", "below", "unavailable"] as const;
export type RuleFloorVerdict = (typeof RULE_FLOOR_VERDICTS)[number];

export const RULE_FLOOR_MAX_AGE_MS = RULE_FLOOR_MAX_AGE_MINUTES * 60_000;

/** What the floor is judged on: the venue's liquidity with its time, and the first pool's time. */
export type FloorFacts = Readonly<{
  liquidityUsd: number | null;
  /** When the venue's figures were read. */
  observedAtMs: number | null;
  /** The first pool the venue knows for the mint, ISO. */
  firstPoolAt: string | null;
}>;

/** One judgement of the floor, as a rule's occurrence keeps it and a page draws it. */
export type RuleFloorCheck = Readonly<{
  verdict: RuleFloorVerdict;
  liquidityUsd: number | null;
  floorUsd: number;
  /** Whole hours since the first pool; null when the venue does not date it. */
  ageHours: number | null;
  minAgeHours: number;
  /** When the figures were read. */
  dataAt: string | null;
  checkedAt: string;
}>;

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/** Whole hours since the first pool, or null where the venue does not date it (or dates it in the future). */
export function ageHoursOf(firstPoolAt: string | null | undefined, nowMs: number): number | null {
  if (!firstPoolAt) return null;
  const at = Date.parse(firstPoolAt);
  if (!Number.isFinite(at) || at > nowMs) return null;
  return Math.floor((nowMs - at) / 3_600_000);
}

/** Judge the floor now. A missing or old figure waits; liquidity or age under the floor is `below`; only fresh figures on it are met. */
export function checkFloor(facts: FloorFacts | null | undefined, nowMs: number): RuleFloorCheck {
  const liquidityUsd = finite(facts?.liquidityUsd) && facts.liquidityUsd >= 0 ? facts.liquidityUsd : null;
  const ageHours = ageHoursOf(facts?.firstPoolAt, nowMs);
  const base = {
    liquidityUsd,
    floorUsd: RULE_FLOOR_LIQUIDITY_USD,
    ageHours,
    minAgeHours: RULE_FLOOR_AGE_HOURS,
    dataAt: finite(facts?.observedAtMs) ? new Date(facts.observedAtMs).toISOString() : null,
    checkedAt: new Date(nowMs).toISOString(),
  };
  /* A figure under the floor is below whatever else is unknown: it cannot become a pass. */
  if ((liquidityUsd !== null && liquidityUsd < RULE_FLOOR_LIQUIDITY_USD) || (ageHours !== null && ageHours < RULE_FLOOR_AGE_HOURS)) return { ...base, verdict: "below" };
  const old = !finite(facts?.observedAtMs) || nowMs - facts.observedAtMs > RULE_FLOOR_MAX_AGE_MS;
  if (liquidityUsd === null || ageHours === null || old) return { ...base, verdict: "unavailable" };
  return { ...base, verdict: "met" };
}

/** The facts of a token's risk the venue states — said before the button for a meme or a new token. */
export type RuleRiskFacts = Readonly<{
  /** Whether the venue verified the token. */
  verified: boolean;
  ageHours: number | null;
  liquidityUsd: number | null;
  /** Per cent of the supply the ten largest holders keep, the venue's figure. */
  topHoldersPct: number | null;
  /** True: nobody can mint more; false: somebody still can; null: not stated. */
  mintAuthorityDisabled: boolean | null;
  /** True: nobody can freeze a holder's tokens; false: somebody still can; null: not stated. */
  freezeAuthorityDisabled: boolean | null;
  /** The venue's organic score, 0–100: how much of the trading looks like people rather than bots. */
  organicScore: number | null;
}>;

/** Whether a rule's asset is a token of the venue's list (a coin, a meme or a new token) rather than a stock. */
export function isListedToken(asset: Readonly<{ kind?: string | null }>): boolean {
  return asset.kind === "crypto" || asset.kind === "meme";
}

/* ------------------------------------------------------------ words */

type Locale = "en" | "uk";

const usd = (value: number, locale: Locale): string => `$${new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", { maximumFractionDigits: 0 }).format(Math.round(value))}`;

/** «від $25 000 ліквідності й від 24 годин» · «$25,000 of liquidity and 24 hours on the market». */
export function floorTerms(locale: Locale): string {
  return locale === "uk"
    ? `ліквідність від ${usd(RULE_FLOOR_LIQUIDITY_USD, "uk")} і від ${RULE_FLOOR_AGE_HOURS} годин на ринку`
    : `${usd(RULE_FLOOR_LIQUIDITY_USD, "en")} of liquidity and ${RULE_FLOOR_AGE_HOURS} hours on the market`;
}

/** An age the way a person reads it: «5 год» · «3 дн.» · «5 h» · «3 d». */
export function ageWord(hours: number, locale: Locale): string {
  if (hours < 48) return locale === "uk" ? `${hours} год` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return locale === "uk" ? `${new Intl.NumberFormat("uk-UA").format(days)} дн.` : `${new Intl.NumberFormat("en-US").format(days)} d`;
}

/**
 * Why a token stands below the floor, or why it cannot be judged, in one
 * sentence — after the token's name where a note needs it («BONK:
 * ліквідність …»); with an empty name, where the token is already on the
 * screen, the sentence starts itself («Ліквідність …»).
 */
export function floorLine(check: RuleFloorCheck, name: string, locale: Locale): string {
  const said = (sentence: string): string => (name ? `${name}: ${sentence}` : `${sentence.charAt(0).toLocaleUpperCase(locale === "uk" ? "uk-UA" : "en-US")}${sentence.slice(1)}`);
  if (check.verdict === "below") {
    const thin = check.liquidityUsd !== null && check.liquidityUsd < check.floorUsd;
    if (locale === "uk") {
      return said(thin ? `ліквідність ${usd(check.liquidityUsd as number, "uk")} — нижче порогу ${usd(check.floorUsd, "uk")}` : `на ринку ${ageWord(check.ageHours ?? 0, "uk")} — поріг ${check.minAgeHours} годин`);
    }
    return said(thin ? `liquidity ${usd(check.liquidityUsd as number, "en")} — below the floor of ${usd(check.floorUsd, "en")}` : `on the market for ${ageWord(check.ageHours ?? 0, "en")} — the floor is ${check.minAgeHours} hours`);
  }
  if (check.verdict === "unavailable") return said(locale === "uk" ? "ліквідність зараз не прочитати" : "liquidity cannot be read right now");
  return locale === "uk" ? `Поріг виконано: ${floorTerms("uk")}` : `On the floor: ${floorTerms("en")}`;
}

/** A floor that is met, with what the token stands on: «Виконано · $7,2 млн · 1 022 дн. на ринку» · «Met · $7.2M · 1,022 d on the market». */
export function floorMetLine(check: RuleFloorCheck, locale: Locale): string {
  const tag = locale === "uk" ? "uk-UA" : "en-US";
  const liquidity = check.liquidityUsd === null ? null : `$${new Intl.NumberFormat(tag, { notation: "compact", maximumFractionDigits: 1 }).format(check.liquidityUsd)}`;
  const age = check.ageHours === null ? null : `${ageWord(check.ageHours, locale)} ${locale === "uk" ? "на ринку" : "on the market"}`;
  return [locale === "uk" ? "Виконано" : "Met", liquidity, age].filter(Boolean).join(" · ");
}

/** The note that a purchase is deferred by the floor: «Купівлю відкладено: BONK — ліквідність $18 400, нижче порогу $25 000». */
export function floorDeferralWords(input: Readonly<{ name: string; check: RuleFloorCheck }>): Readonly<Record<Locale, Readonly<{ title: string; reason: string; cta: string }>>> {
  const { name, check } = input;
  const reason = {
    en: "A rule never buys into a thin pool. The rule checks again.",
    uk: "У тонкий пул правило не купує. Правило перевірить знову.",
  };
  if (check.verdict === "unavailable") {
    return {
      en: { title: `Purchase deferred: ${name} — liquidity cannot be read right now`, reason: reason.en, cta: "View" },
      uk: { title: `Купівлю відкладено: ${name} — ліквідність зараз не прочитати`, reason: reason.uk, cta: "Подивитись" },
    };
  }
  const line = (locale: Locale) => floorLine(check, name, locale).replace(`${name}: `, `${name} — `);
  return {
    en: { title: `Purchase deferred: ${line("en")}`, reason: reason.en, cta: "View" },
    uk: { title: `Купівлю відкладено: ${line("uk")}`, reason: reason.uk, cta: "Подивитись" },
  };
}
