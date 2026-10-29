/**
 * The words of «Доручення» (AI-19) — the question a task asks the assistant,
 * and the title of the note it leaves. Two languages, one table.
 */

import type { TaskAsk, TaskRecord } from "./store.ts";
import type { TaskEvery } from "./schedule.ts";

/** The question asked on each run — the words a person would type; a typed question goes as it was typed. */
export function taskQuestion(ask: TaskAsk, locale: "en" | "uk"): string {
  switch (ask.kind) {
    case "question":
      return ask.text;
    case "news":
      return locale === "uk" ? `Які новини про ${ask.symbol}?` : `What is the news on ${ask.symbol}?`;
    case "move":
      return locale === "uk" ? `Що зрушило ціну ${ask.symbol}?` : `What moved ${ask.symbol}'s price?`;
    case "portfolio":
      return locale === "uk" ? "Що змінилось у моєму портфелі?" : "What changed in my portfolio?";
  }
}

/** A task's name as its card and note say it: «Новини SOL», «Рух JUP», «Мій портфель», or the question's first words. */
export function taskName(ask: TaskAsk, locale: "en" | "uk"): string {
  switch (ask.kind) {
    case "question":
      return ask.text.length > 60 ? `${ask.text.slice(0, 57).trimEnd()}…` : ask.text;
    case "news":
      return locale === "uk" ? `Новини ${ask.symbol}` : `${ask.symbol} news`;
    case "move":
      return locale === "uk" ? `Рух ціни ${ask.symbol}` : `${ask.symbol} price move`;
    case "portfolio":
      return locale === "uk" ? "Мій портфель" : "My portfolio";
  }
}

export function everyWords(every: TaskEvery, time: string | null, locale: "en" | "uk"): string {
  if (locale === "uk") return { "10m": "кожні 10 хв", "30m": "кожні 30 хв", "1h": "щогодини", "1d": `щодня о ${time ?? "09:00"}` }[every];
  return { "10m": "every 10 min", "30m": "every 30 min", "1h": "every hour", "1d": `daily at ${time ?? "09:00"}` }[every];
}

/** The note's title and its reason when the task ran, or when it paused for credits. */
export function taskTitle(task: Pick<TaskRecord, "ask" | "locale" | "every" | "time">, kind: "ran" | "paused-credits" | "paused-price"): Readonly<{ title: string; reason: string }> {
  const name = taskName(task.ask, task.locale);
  if (kind === "paused-price") {
    return task.locale === "uk"
      ? { title: `Доручення на паузі · ${name}`, reason: "Ціна питання змінилась і тепер вища за ту, з якою доручення було ввімкнено. «Продовжити» покаже нову ціну." }
      : { title: `Task paused · ${name}`, reason: "The price of a question rose above the one you turned the task on with. «Resume» shows the new price." };
  }
  if (kind === "paused-credits") {
    return task.locale === "uk"
      ? { title: `Доручення на паузі · ${name}`, reason: "Безкоштовні питання на сьогодні скінчились, а балансу кредитів бракує. Поповни — і «Продовжити» запустить його знову." }
      : { title: `Task paused · ${name}`, reason: "Today's free questions are used up and the credits balance is short. Top up, then «Resume» starts it again." };
  }
  return { title: name, reason: "" };
}
