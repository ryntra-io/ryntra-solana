import type { Locale } from "./engine.ts";

type Bi = Readonly<{ en: string; uk: string }>;
const bi = (en: string, uk: string): Bi => ({ en, uk });

export const MONITORING_WORDS = {
  title: bi("Monitoring", "Нагляд"),
  lead: bi("Ryntra watches your rules. Nothing trades on its own.", "Ryntra стежить за твоїми правилами. Нічого не торгує само."),
  needsAttention: bi("Needs attention", "Потребує уваги"),
  watching: bi("Watching", "Стежимо"),
  paused: bi("Paused", "Пауза"),
  unavailable: bi("Data unavailable", "Немає даних"),
  recent: bi("Recent", "Нещодавні"),
  emptyAttention: bi("Nothing needs you right now.", "Зараз нічого не потребує тебе."),
  emptyWatching: bi("When you activate a plan, Ryntra watches it here.", "Коли активуєш план, Ryntra стежитиме за ним тут."),
  emptyRecent: bi("No notes yet.", "Нотаток ще немає."),
  connect: bi("Connect a wallet to see what needs attention.", "Підключи гаманець, щоб побачити, що потребує уваги."),
  noWallet: bi("Phantom, Solflare and Backpack all work.", "Phantom, Solflare і Backpack підходять."),
  confirm: bi("Confirm this wallet to see its monitoring.", "Підтверди гаманець, щоб побачити його моніторинг."),
  confirmWallet: bi("Confirm wallet", "Підтвердити гаманець"),
  reviewPlan: bi("Review plan", "Переглянути план"),
  reviewPrediction: bi("Review paper plan", "Переглянути паперовий план"),
  openPlan: bi("Open plan", "Відкрити план"),
  openPrediction: bi("Open paper plan", "Відкрити паперовий план"),
  /* 1.21.0: «Ryntra попередить» on a position — its note opens the sale, its card the company. */
  openSale: bi("Open the sale", "Відкрити продаж"),
  openPosition: bi("Open the position", "Відкрити позицію"),
  watchingSection: bi("Watching", "Стежимо"),
  notes: bi("Where notes go", "Куди йдуть нотатки"),
  telegramOn: bi("Telegram notes on", "Нотатки в Telegram увімкнено"),
  telegramOffPref: bi("Telegram notes off", "Нотатки в Telegram вимкнено"),
  pushOn: bi("Phone notes on", "Нотатки на телефон увімкнено"),
  pushOff: bi("Phone notes off", "Нотатки на телефон вимкнено"),
  quietOff: bi("No quiet hours", "Без тихих годин"),
  quietOn: bi("Quiet hours", "Тихі години"),
  saveQuiet: bi("Save quiet hours", "Зберегти тихі години"),
  connectTelegram: bi("Connect Telegram in Settings", "Підключити Telegram у Налаштуваннях"),
  attentionBanner: bi("Something in this plan changed. Review it on today's figures — a note is not permission to trade.", "У цьому плані щось змінилось. Переглянь його на сьогоднішніх цифрах — нотатка не є дозволом торгувати."),
  markRead: bi("Mark as read", "Позначити прочитаним"),
  lastChecked: bi("Last checked", "Остання перевірка"),
  paper: bi("Paper", "Папір"),
  justNow: bi("just now", "щойно"),
  minutesAgo: bi("min ago", "хв тому"),
  hoursAgo: bi("h ago", "год тому"),
  daysAgo: bi("d ago", "д тому"),
  deliveryFailed: bi("We couldn't send this alert. It is still available in Ryntra.", "Не вдалося надіслати це сповіщення. Воно лишається в Ryntra."),
  telegramOff: bi("Telegram is not connected.", "Telegram не підключено."),
  quiet: bi("Quiet hours. The note is waiting in Ryntra.", "Тихі години. Нотатка чекає в Ryntra."),
  channels: bi("Where notes go", "Куди йдуть нотатки"),
  inboxOn: bi("In Ryntra", "У Ryntra"),
  telegram: bi("Telegram", "Telegram"),
  push: bi("This device", "Цей пристрій"),
  quietHours: bi("Quiet hours", "Тихі години"),
  revokeDevice: bi("Stop this device", "Зупинити цей пристрій"),
  noDevices: bi("No phone is registered for notes yet.", "Жоден телефон ще не зареєстровано для нотаток."),
  couldNotLoad: bi("Monitoring could not be read right now.", "Нагляд зараз не вдалося прочитати."),
  tryAgain: bi("Try again", "Спробувати ще раз"),
  loading: bi("Reading your plans…", "Читаємо твої плани…"),
  /* «Автоінвест» on the surface (canon §11): a reminder's state, and the month's budget spent */
  ruleDue: bi("Time to buy by your rule", "Час покупки за правилом"),
  rulePending: bi("Purchase on its way", "Купівля в дорозі"),
  ruleBought: bi("Bought", "Куплено"),
  ruleMissed: bi("Missed", "Пропущено"),
  /* 1.18.0: the price condition held the purchase back; the rule judges it again. */
  ruleDeferred: bi("Purchase deferred", "Купівлю відкладено"),
  budgetSpent: bi("Budget spent", "Бюджет вичерпано"),
} as const;

export function words(locale: Locale): { [K in keyof typeof MONITORING_WORDS]: string } {
  const out: Record<string, string> = {};
  for (const key of Object.keys(MONITORING_WORDS) as (keyof typeof MONITORING_WORDS)[]) {
    out[key] = MONITORING_WORDS[key][locale];
  }
  return out as { [K in keyof typeof MONITORING_WORDS]: string };
}

export function relativeTime(iso: string | null, nowMs: number, locale: Locale): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "—";
  const delta = Math.max(0, nowMs - then);
  const w = words(locale);
  if (delta < 45_000) return w.justNow;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)} ${w.minutesAgo}`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)} ${w.hoursAgo}`;
  return `${Math.round(delta / 86_400_000)} ${w.daysAgo}`;
}

export function telegramText(input: Readonly<{ label: string; reason: string; href: string; paper: boolean }>): string {
  const paper = input.paper ? "Paper\n" : "";
  return `Ryntra\n${paper}Your ${input.label} plan needs attention.\n${input.reason}\n\nReview plan\n${input.href}`;
}
