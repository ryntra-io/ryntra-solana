/**
 * The partner programme's terms — the one place the partner page `/partners` (CITY-177), «What we're building» and the city's
 * «Partners» window read them from.
 *
 * He chose option B of `docs/positioning/PARTNER-PROGRAMME-OPTIONS.md`
 * on 31 October 2026, night — decision 93. A change is a new decision: the numbers change here,
 * `decided` names it, and the next deploy prints them — nowhere else holds a copy. `registry.test.mjs` refuses a number
 * without its decision. The creator-partner share of the creators' network (D-P1) is still open and is not printed.
 *
 * Whatever the numbers, three rules are fixed by decision 88 and printed as they are: a partner's share is a share of
 * Ryntra's own fee, never of the person's money; it is paid from one revenue ledger, and every payout together is never
 * more than Ryntra received; the share is visible on the signing line and in a public table. Payouts start when the
 * revenue ledger (PRT-2) runs; until then the page says so.
 *
 * The friend's discount is taken off trades only where the deployment's switch is on (`./discount.ts`, CITY-182); off,
 * the rows say it is coming, and on they say where it reaches.
 */

import { DISCOUNT_ON } from "./discount.ts";

export type PartnerShare = Readonly<{
  /** The share of Ryntra's own fee for each brought person's first days, in basis points. */
  firstBps: number;
  /** How many days of each person the first share lasts. */
  firstDays: number;
  /** The share after those days, in basis points. */
  afterBps: number;
}>;

export type PartnerTerms = Readonly<{
  /** The partner's share of Ryntra's own fee on the launches and swaps the people they bring make. */
  share: PartnerShare | null;
  /** How long a person stays with the partner who brought them: for good, or a number of days. */
  attribution: "lifetime" | number | null;
  /** The discount on Ryntra's fee for the person a partner brings, in basis points of that fee. */
  refereeDiscountBps: number | null;
  /** The smallest payout, in US dollars. */
  minimumPayoutUsd: number | null;
  /** What a payout is paid in. */
  payoutAsset: "USDC" | "SOL" | null;
  /** How often payouts are made. */
  cadence: "weekly" | "monthly" | null;
  /** How many levels of partners share: one means only the partner who brought the person. */
  levels: number | null;
  /** The decision that set the numbers; required once any number is set. */
  decided: string | null;
}>;

export const PARTNER_TERMS: PartnerTerms = {
  share: { firstBps: 4000, firstDays: 90, afterBps: 3000 },
  attribution: "lifetime",
  refereeDiscountBps: 1000,
  minimumPayoutUsd: 5,
  payoutAsset: "USDC",
  cadence: "weekly",
  levels: 1,
  decided: "93",
};

/** The terms' numbers, in the order the page prints them. */
export function termValues(terms: PartnerTerms = PARTNER_TERMS): readonly unknown[] {
  return [terms.share, terms.attribution, terms.refereeDiscountBps, terms.minimumPayoutUsd, terms.payoutAsset, terms.cadence, terms.levels];
}

/** True once every term has a value. */
export function termsSet(terms: PartnerTerms = PARTNER_TERMS): boolean {
  return termValues(terms).every((value) => value !== null);
}

/** A percent as the page prints it: «40%» in English, «40 %» with a decimal comma in Ukrainian. */
function pct(text: string, lang: "en" | "uk"): string {
  return lang === "uk" ? text.replace(/(\d)\.(\d)/g, "$1,$2").replace(/%/g, " %") : text;
}

/**
 * The terms as rows, in the order the partner page `/partners` and the city's «Partners» window print them, with the
 * line under them. One function, so the page and the city can never disagree on a word or a number.
 */
export function termsRows(lang: "en" | "uk", terms: PartnerTerms = PARTNER_TERMS, discountOn: boolean = DISCOUNT_ON) {
  const en = lang === "en";
  const open = en ? "Opens with the programme" : "Відкривається з програмою";
  const share = terms.share;
  const first = share ? pct(`${share.firstBps / 100}%`, lang) : "";
  const after = share ? pct(`${share.afterBps / 100}%`, lang) : "";
  const value = {
    share: share === null ? open : en ? `${first} for each person's first ${share.firstDays} days, then ${after}` : `${first} перші ${share.firstDays} днів кожної людини, далі ${after}`,
    window: terms.attribution === null ? open : terms.attribution === "lifetime" ? (en ? "For good" : "Назавжди") : en ? `${terms.attribution} days` : `${terms.attribution} днів`,
    discount:
      terms.refereeDiscountBps === null
        ? open
        : `${pct(`${terms.refereeDiscountBps / 100}%`, lang)} ${en ? "off Ryntra's fee" : "від комісії Ryntra"}${discountOn ? "" : en ? " — coming soon" : " — скоро"}`,
    minimum: terms.minimumPayoutUsd === null ? open : `$${terms.minimumPayoutUsd}`,
    asset: terms.payoutAsset ?? open,
    cadence: terms.cadence === null ? open : en ? (terms.cadence === "weekly" ? "Every week" : "Every month") : terms.cadence === "weekly" ? "Щотижня" : "Щомісяця",
    levels: terms.levels === null ? open : terms.levels === 1 ? (en ? "One: the partner who brought the person" : "Один: партнер, який привів людину") : String(terms.levels),
  };
  return {
    rows: [
      { label: en ? "Your share of Ryntra's fee" : "Твоя частка комісії Ryntra", value: value.share },
      { label: en ? "How long a person stays yours" : "Скільки людина лишається твоєю", value: value.window },
      { label: en ? "For the person you bring" : "Людині, яку ти привів", value: value.discount },
      ...(discountOn && terms.refereeDiscountBps !== null
        ? [
            {
              label: en ? "Where the discount works" : "Де діє знижка",
              value: en
                ? "Swaps, buys and limit orders. Not on a coin's launch curve, on Ondo and PreStocks stocks, or on a major coin's limit order."
                : "Обміни, купівлі й лімітні ордери. Не діє на кривій запуску монети, на акціях Ondo і PreStocks і на лімітних ордерах великих монет.",
            },
          ]
        : []),
      { label: en ? "Levels" : "Рівні", value: value.levels },
      { label: en ? "Smallest payout" : "Найменша виплата", value: value.minimum },
      { label: en ? "Paid in" : "Валюта виплати", value: value.asset },
      { label: en ? "How often" : "Як часто", value: value.cadence },
    ],
    note: share
      ? en
        ? "Your share is counted from today and paid weekly in USDC."
        : "Твоя частка рахується від сьогодні й виплачується щотижня в USDC."
      : en
        ? "The numbers appear here the day the programme opens — the same numbers the payouts use."
        : "Числа з'являться тут у день відкриття програми — ті самі, за якими йдуть виплати.",
  };
}
