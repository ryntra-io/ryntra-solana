/**
 * How a rule is said — «Щотижня · чт о 19:00», «Якщо впаде на 5 %», «Час
 * твоєї покупки: $10 в Apple», «Бюджет місяця вичерпано» — in both languages
 * (the product's words: «Автоінвест» · «Щотижня» · «Якщо впаде на 5 %» · «Бюджет
 * місяця» · «Ryntra нагадає — ти підтвердиш одним дотиком»; never DCA,
 * trigger or «купує автоматично»).
 *
 * Pure and client-safe. The reminder the tick writes, the Telegram message and
 * the sheets on the company page and Home read the same phrases, so the note a
 * person gets and the rule they set say the same thing.
 */

import type { RuleCadence, RuleSchedule } from "./schedule.ts";
import { wallClockAt } from "./schedule.ts";

export type RuleLocale = "en" | "uk";

const CADENCE: Readonly<Record<RuleCadence, Readonly<Record<RuleLocale, string>>>> = {
  daily: { en: "Every day", uk: "Щодня" },
  weekly: { en: "Every week", uk: "Щотижня" },
  monthly: { en: "Every month", uk: "Щомісяця" },
};

/** ISO weekday 1 (Monday) … 7 (Sunday), short. */
export const WEEKDAY_SHORT: Readonly<Record<RuleLocale, readonly string[]>> = {
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  uk: ["пн", "вт", "ср", "чт", "пт", "сб", "нд"],
};

export function cadenceWord(cadence: RuleCadence, locale: RuleLocale): string {
  return CADENCE[cadence][locale];
}

function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${day % 10 === 1 ? "st" : day % 10 === 2 ? "nd" : day % 10 === 3 ? "rd" : "th"}`;
}

/** When, on the rule's own clock: «чт о 19:00» · «о 19:00» · «1-го о 10:00»; «Thu at 19:00» · «at 19:00» · «on the 1st at 10:00». */
export function whenPhrase(schedule: RuleSchedule, locale: RuleLocale): string {
  const at = locale === "uk" ? `о ${schedule.time}` : `at ${schedule.time}`;
  if (schedule.cadence === "weekly" && schedule.weekday !== null) return `${WEEKDAY_SHORT[locale][schedule.weekday - 1]} ${at}`;
  if (schedule.cadence === "monthly" && schedule.monthDay !== null) return locale === "uk" ? `${schedule.monthDay}-го ${at}` : `on the ${ordinal(schedule.monthDay)} ${at}`;
  return at;
}

/** «Щотижня · чт о 19:00». */
export function ruleLine(schedule: RuleSchedule, locale: RuleLocale): string {
  return `${cadenceWord(schedule.cadence, locale)} · ${whenPhrase(schedule, locale)}`;
}

/** A per cent the way each language writes it: «5 %» (a no-break space) and «5,3 %»; «5%» and «5.3%». */
export function pctWord(pct: number, locale: RuleLocale, fractionDigits = 0): string {
  const figure = new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(pct);
  return locale === "uk" ? `${figure} %` : `${figure}%`;
}

/** «Якщо впаде на 5 %» · «If it falls 5%». */
export function dipLine(dropPct: number, locale: RuleLocale): string {
  return locale === "uk" ? `Якщо впаде на ${pctWord(dropPct, "uk")}` : `If it falls ${pctWord(dropPct, "en")}`;
}

/** The terms of a «З кожної оплати» rule, as its line reads them. */
export type PaymentsWords = Readonly<{ mode: "roundup" | "fixed" | "percent"; roundToUsd: number | null; fixedUsd: number | null; percent: number | null }>;

/**
 * «Округлення кожної оплати до $1» · «$2 з кожної оплати» · «10 % з кожного
 * надходження»; «Round every payment up to $1» · «$2 from every payment» ·
 * «10% of every incoming transfer».
 */
export function paymentsLine(payments: PaymentsWords, locale: RuleLocale): string {
  if (payments.mode === "percent") return locale === "uk" ? `${pctWord(payments.percent ?? 0, "uk")} з кожного надходження` : `${pctWord(payments.percent ?? 0, "en")} of every incoming transfer`;
  if (payments.mode === "fixed") return locale === "uk" ? `${usdWord(payments.fixedUsd ?? 0, "uk")} з кожної оплати` : `${usdWord(payments.fixedUsd ?? 0, "en")} from every payment`;
  return locale === "uk" ? `Округлення кожної оплати до ${usdWord(payments.roundToUsd ?? 1, "uk")}` : `Round every payment up to ${usdWord(payments.roundToUsd ?? 1, "en")}`;
}

/** A Ukrainian count with its noun: 1 оплата · 2 оплати · 5 оплат. */
export function ukCount(count: number, forms: readonly [string, string, string]): string {
  const tens = count % 100;
  const ones = count % 10;
  const form = tens >= 11 && tens <= 14 ? forms[2] : ones === 1 ? forms[0] : ones >= 2 && ones <= 4 ? forms[1] : forms[2];
  return `${count} ${form}`;
}

/** How many events a sum gathered: «2 оплати» · «1 надходження»; «2 payments» · «1 incoming transfer». */
export function eventsCountWord(count: number, mode: PaymentsWords["mode"], locale: RuleLocale): string {
  if (mode === "percent") return locale === "uk" ? ukCount(count, ["надходження", "надходження", "надходжень"]) : `${count} incoming transfer${count === 1 ? "" : "s"}`;
  return locale === "uk" ? ukCount(count, ["оплата", "оплати", "оплат"]) : `${count} payment${count === 1 ? "" : "s"}`;
}

/** How any rule is said in one line: its schedule, its fall, or what it takes from payments. */
export function ruleWhenLine(rule: Readonly<{ schedule: RuleSchedule | null; dip: Readonly<{ dropPct: number }> | null; payments?: PaymentsWords | null }>, locale: RuleLocale): string {
  if (rule.dip) return dipLine(rule.dip.dropPct, locale);
  if (rule.payments) return paymentsLine(rule.payments, locale);
  return rule.schedule ? ruleLine(rule.schedule, locale) : "";
}

/** «$10», «$10,50» in Ukrainian, «$10.50» in English. */
export function usdWord(amount: number, locale: RuleLocale): string {
  const whole = Math.abs(amount - Math.round(amount)) < 0.005;
  const figure = new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(whole ? Math.round(amount) : amount);
  return `$${figure}`;
}

/** A price per unit: «$335,95» · «$335.95»; under a dollar, four places. */
export function priceWord(usd: number, locale: RuleLocale): string {
  const places = usd >= 1 ? 2 : 4;
  return `$${new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", { minimumFractionDigits: places, maximumFractionDigits: places }).format(usd)}`;
}

/** A due instant on the rule's own clock: «чт, 24 вер. о 19:00» · «Thu, Sep 24 at 19:00». */
export function dueWords(dueAtMs: number, timeZone: string, locale: RuleLocale): string {
  const date = new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(new Date(dueAtMs));
  const wall = wallClockAt(dueAtMs, timeZone);
  const time = `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`;
  return locale === "uk" ? `${date} о ${time}` : `${date} at ${time}`;
}

/** A day on a clock: «24 вер.» · «Sep 24». */
export function dayWords(atMs: number, timeZone: string, locale: RuleLocale): string {
  return new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { timeZone, day: "numeric", month: "short" }).format(new Date(atMs));
}

export type ReminderWords = Readonly<Record<RuleLocale, Readonly<{ title: string; reason: string; cta: string }>>>;

/**
 * The reminder, in both languages: «Час твоєї покупки: $10 в Apple» · «Щотижня
 * · чт о 19:00. Один дотик — свіжа «Перевірка», купує лише твій підпис.» ·
 * «Купити $10». A note is never permission to trade — the words say whose
 * signature buys.
 */
export function reminderWords(input: Readonly<{ name: string; amountUsd: number; schedule: RuleSchedule }>): ReminderWords {
  const en = usdWord(input.amountUsd, "en");
  const uk = usdWord(input.amountUsd, "uk");
  return {
    en: {
      title: `Time for your purchase: ${en} of ${input.name}`,
      reason: `${ruleLine(input.schedule, "en")}. One tap opens a fresh Review — only your signature buys.`,
      cta: `Buy ${en}`,
    },
    uk: {
      title: `Час твоєї покупки: ${uk} в ${input.name}`,
      reason: `${ruleLine(input.schedule, "uk")}. Один дотик — свіжа «Перевірка», купує лише твій підпис.`,
      cta: `Купити ${uk}`,
    },
  };
}

/**
 * A «Якщо впаде» reminder («NVIDIA −5 % · докупити $20?» →
 * «Купити»): the fall as measured from the reference point, the price, the
 * point, and the same promise — only the signature buys.
 */
export function dipReminderWords(input: Readonly<{ name: string; amountUsd: number; priceUsd: number; anchorUsd: number }>): ReminderWords {
  const fell = Math.max(0, (1 - input.priceUsd / input.anchorUsd) * 100);
  const en = usdWord(input.amountUsd, "en");
  const uk = usdWord(input.amountUsd, "uk");
  return {
    en: {
      title: `${input.name} −${pctWord(fell, "en", 1)} · buy ${en} more?`,
      reason: `The price is ${priceWord(input.priceUsd, "en")} — ${pctWord(fell, "en", 1)} below your reference point of ${priceWord(input.anchorUsd, "en")}. One tap opens a fresh Review — only your signature buys.`,
      cta: `Buy ${en}`,
    },
    uk: {
      title: `${input.name} −${pctWord(fell, "uk", 1)} · докупити ${uk}?`,
      reason: `Ціна ${priceWord(input.priceUsd, "uk")} — на ${pctWord(fell, "uk", 1)} нижча за точку відліку ${priceWord(input.anchorUsd, "uk")}. Один дотик — свіжа «Перевірка», купує лише твій підпис.`,
      cta: `Купити ${uk}`,
    },
  };
}

/**
 * A «З кожної оплати» reminder («З оплат: $1,30 → Apple» →
 * «Купити»): what gathered, from how many events and by which terms — the
 * money stayed in the wallet, and only the signature buys.
 */
export function paymentsReminderWords(input: Readonly<{ name: string; amountUsd: number; events: number; payments: PaymentsWords }>): ReminderWords {
  const en = usdWord(input.amountUsd, "en");
  const uk = usdWord(input.amountUsd, "uk");
  const source = input.payments.mode === "percent";
  return {
    en: {
      title: `From ${source ? "incoming transfers" : "payments"}: ${en} → ${input.name}`,
      reason: `${paymentsLine(input.payments, "en")} · ${eventsCountWord(input.events, input.payments.mode, "en")}. The money stayed in your wallet. One tap opens a fresh Review — only your signature buys.`,
      cta: `Buy ${en}`,
    },
    uk: {
      title: `З ${source ? "надходжень" : "оплат"}: ${uk} → ${input.name}`,
      reason: `${paymentsLine(input.payments, "uk")} · ${eventsCountWord(input.events, input.payments.mode, "uk")}. Гроші лишались у твоєму гаманці. Один дотик — свіжа «Перевірка», купує лише твій підпис.`,
      cta: `Купити ${uk}`,
    },
  };
}

/** «Бюджет місяця вичерпано» — what was spent of the ceiling, that the rules stand until the 1st, and the one action. */
export function budgetSpentWords(input: Readonly<{ capUsd: number; countedUsd: number }>): ReminderWords {
  return {
    en: {
      title: "This month's autoinvest budget is spent",
      reason: `${usdWord(input.countedUsd, "en")} of ${usdWord(input.capUsd, "en")} spent. Rules stand until the 1st — or change the budget.`,
      cta: "Change budget",
    },
    uk: {
      title: "Бюджет місяця вичерпано",
      reason: `Витрачено ${usdWord(input.countedUsd, "uk")} з ${usdWord(input.capUsd, "uk")}. Правила стоять до 1-го числа — або зміни бюджет.`,
      cta: "Змінити бюджет",
    },
  };
}

/** The Telegram message of a reminder: Ryntra's name, the words, the link; the button carries the action. */
export function reminderTelegramText(words: Readonly<{ title: string; reason: string }>, href: string): string {
  return `Ryntra\n${words.title}\n${words.reason}\n\n${href}`;
}
