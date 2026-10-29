import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * The bell's words, in both languages: what a person reads in the top bar's
 * notifications panel. The notes themselves arrive in the reader's language
 * from the monitoring surface.
 */

type Bi = Readonly<{ en: string; uk: string }>;
const bi = (en: string, uk: string): Bi => ({ en, uk });

export const BELL_WORDS = {
  title: bi("Notifications", "Сповіщення"),
  all: bi("All notifications", "Усі сповіщення"),
  unread: bi("unread", "непрочитаних"),
  guest: bi("Connect wallet — reminders of your recurring buys and news about your rules will appear here.", "Підключи гаманець — тут з'являться нагадування регулярної купівлі й новини твоїх правил."),
  unproven: bi("Confirm your wallet with one signature so only you can read its notifications.", "Підтвердь гаманець одним підписом — так сповіщення бачиш лише ти."),
  confirm: bi("Confirm wallet", "Підтвердити гаманець"),
  confirming: bi("Confirming…", "Підтверджуємо…"),
  loading: bi("Reading notifications…", "Читаємо сповіщення…"),
  empty: bi("Nothing yet. Reminders to buy by a rule and changes worth your attention will appear here.", "Поки нічого. Тут з'являться нагадування купити за правилом і зміни, що варті уваги."),
  failed: bi("Notifications could not be read right now.", "Сповіщення зараз не вдалося прочитати."),
  tryAgain: bi("Try again", "Спробувати ще раз"),
} as const;

export type BellWord = keyof typeof BELL_WORDS;

export function bellWords(locale: WorkspaceLocale): (key: BellWord) => string {
  return (key) => BELL_WORDS[key][locale === "uk" ? "uk" : "en"];
}
