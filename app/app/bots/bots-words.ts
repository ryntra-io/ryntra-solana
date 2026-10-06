import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * The words of «Боти»: everything that runs on a person's
 * rule — the recurring-buy rules and the plans — in one list, «Мої боти», and
 * what can be set up in «Каталог». Only what is on production: Ryntra reminds,
 * the person signs every buy.
 */

type Bi = Readonly<{ en: string; uk: string }>;
const bi = (en: string, uk: string): Bi => ({ en, uk });

export const BOTS_WORDS = {
  title: bi("Bots", "Боти"),
  mine: bi("My bots", "Мої боти"),
  mineLead: bi(
    "Everything that runs on your rule — recurring buys and trade plans. Ryntra reminds you; you sign every buy.",
    "Усе, що працює за твоїм правилом, — регулярна купівля й плани угод. Ryntra нагадує, кожну купівлю підписуєш ти.",
  ),
  recurring: bi("Recurring buy", "Регулярна купівля"),
  plans: bi("Trade plans", "Плани угод"),
  plansLead: bi("A plan's result is on its card.", "Результат плану — у його картці."),
  createPlan: bi("Create a plan", "Створити план"),
  reminders: bi("Reminders", "Нагадування"),
  connect: bi("Your recurring-buy rules appear here once a wallet is connected.", "Твої правила регулярної купівлі з'являться тут, щойно під'єднаєш гаманець."),
  results: bi("Results", "Результати"),
  resultsLead: bi("What the plans did: every trade against its plan, and what Ryntra remembers.", "Що зробили плани: кожна угода проти свого плану й що пам'ятає Ryntra."),
  catalog: bi("Catalog", "Каталог"),
  catalogLead: bi("What you can set up today.", "Що можна налаштувати вже сьогодні."),
  recurringWhat: bi(
    "Buys a company every day, every week, every month, or when its price falls — within a monthly budget you set.",
    "Купує компанію щодня, щотижня, щомісяця або коли ціна впаде — у межах бюджету місяця, який ставиш ти.",
  ),
  recurringHow: bi("Ryntra reminds you; you sign each buy. Your money stays in your wallet.", "Ryntra нагадує, кожну купівлю підписуєш ти. Гроші лишаються у твоєму гаманці."),
  recurringFor: bi("For tokenized stocks today", "Сьогодні — для токенізованих акцій"),
  pickCompany: bi("Choose a company", "Обрати компанію"),
  myRules: bi("My rules", "Мої правила"),
  planWhat: bi("Your own rules for one trade: entry, size, stop and target.", "Твої правила однієї угоди: вхід, розмір, стоп і ціль."),
  planName: bi("Trade plan", "План угоди"),
} as const;

export function botsWords(locale: WorkspaceLocale) {
  return (key: keyof typeof BOTS_WORDS): string => BOTS_WORDS[key][locale];
}
