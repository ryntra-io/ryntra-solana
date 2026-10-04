/**
 * The words of Нагляд over a position, in both languages: a state's name, its
 * one line with the figures the server judged it on, and its one action.
 * Pure: a reader passes its own money and per-cent formatters, so the web and
 * the phone say the same thing in their own number style. The state itself is
 * never decided here — it arrives from the server (`watch-state.ts`).
 */

import type { WatchAction, WatchReason, WatchState } from "./watch-state.ts";

export type WatchLang = "en" | "uk";
type Bi = Readonly<{ en: string; uk: string }>;
const bi = (en: string, uk: string): Bi => ({ en, uk });

export const WATCH_STATE_WORDS: Readonly<Record<WatchState, Bi>> = {
  "on-plan": bi("On track", "Все за планом"),
  attention: bi("Attention", "Увага"),
  action: bi("Action needed", "Дія"),
  "issuer-paused": bi("Paused by the issuer", "Пауза емітента"),
  "exit-not-set": bi("Attention: bought — no exit set", "Увага: куплено — вихід не налаштований"),
  unknown: bi("Could not check", "Не вдалося перевірити"),
};

export const WATCH_ACTION_WORDS: Readonly<Record<WatchAction, Bi>> = {
  look: bi("Take a look", "Подивитись"),
  "open-sale": bi("Open the sale", "Відкрити продаж"),
  details: bi("Details", "Деталі"),
  warn: bi("Turn on “Ryntra will warn you”", "Увімкнути «Ryntra попередить»"),
  "connect-telegram": bi("Connect Telegram", "Підключи Telegram"),
};

/**
 * The same states and actions where a line has to be short — a Portfolio row:
 * the row is bought by being there and amber says «Увага», so the amber state
 * names only what is missing, and the one action is a verb of a word or two.
 */
export const WATCH_STATE_SHORT: Readonly<Record<WatchState, Bi>> = {
  ...WATCH_STATE_WORDS,
  "exit-not-set": bi("No exit set", "Вихід не налаштований"),
};

export const WATCH_ACTION_SHORT: Readonly<Record<WatchAction, Bi>> = {
  ...WATCH_ACTION_WORDS,
  warn: bi("Set it up", "Налаштувати"),
};

/** What «Деталі» of an issuer's pause says. */
export const ISSUER_PAUSED_DETAILS = bi("You can't sell right now — Ryntra waits for the issuer to lift the pause.", "Продати зараз неможливо — чекаємо, поки емітент зніме паузу.");

/** The honest limit of a warning: until the sale is signed, the loss can grow. */
export const WARN_HONEST_LIMIT = bi("Ryntra warns you; it does not sell for you. Until you sign the sale, the loss can grow.", "Ryntra попереджає, а не продає за тебе. Поки продаж не підписано, збиток може зрости.");

export const WATCH_WORDS = {
  /** Нагляд's section of positions. */
  positions: bi("Your positions", "Твої позиції"),
  positionsEmpty: bi("You hold no company yet. Buy a piece from $1 — and Ryntra watches it here.", "Ти ще не маєш жодної компанії. Купи частинку від $1 — і Ryntra стежитиме за нею тут."),
  positionsUnread: bi("Your positions could not be read just now. Ryntra reads them again in a moment.", "Позиції зараз не вдалося прочитати. Ryntra прочитає їх знову за мить."),
  positionsPartial: bi("Some of your positions could not be read just now — they are not shown until they are.", "Частину позицій зараз не вдалося прочитати — їх не показано, доки не прочитаємо."),
  limit: bi("limit", "межа"),
  target: bi("target", "ціль"),
  fromPlan: bi("by your plan", "за твоїм планом"),
  warns: bi("Ryntra will warn you", "Ryntra попередить"),
  now: bi("now", "зараз"),
  /* the sheet */
  sheetTitle: bi("Ryntra will warn you", "Ryntra попередить"),
  sheetLead: bi("Choose when Ryntra should message you.", "Обери, коли Ryntra має тобі написати."),
  priceNow: bi("Price now", "Ціна зараз"),
  careful: bi("Careful", "Обережно"),
  balanced: bi("Balanced", "Збалансовано"),
  lossLimit: bi("Loss limit", "Межа збитку"),
  sellIf: bi("Sell if it reaches", "Продати, якщо дійде"),
  channel: bi("The warning comes to Telegram", "Попередження прийде в Telegram"),
  turnOn: bi("Turn on", "Увімкнути"),
  turning: bi("Turning on…", "Вмикаємо…"),
  turnedOn: bi("Ryntra is watching", "Ryntra стежить"),
  done: bi("Done", "Готово"),
  failedChannel: bi("Connect Telegram first — Ryntra warns there.", "Спершу підключи Telegram — Ryntra попереджає там."),
  failedPrice: bi("No fresh price right now — try again in a minute.", "Свіжої ціни зараз немає — спробуй за хвилину."),
  failed: bi("It could not be turned on just now — try again.", "Зараз не вдалося увімкнути — спробуй ще раз."),
  confirmWallet: bi("Confirm the wallet to turn it on", "Підтвердь гаманець, щоб увімкнути"),
} as const;

export type WatchWord = keyof typeof WATCH_WORDS;

export function watchWord(key: WatchWord, lang: WatchLang): string {
  return WATCH_WORDS[key][lang];
}

export function watchStateWord(state: WatchState, lang: WatchLang, short = false): string {
  return (short ? WATCH_STATE_SHORT : WATCH_STATE_WORDS)[state][lang];
}

export function watchActionWord(action: WatchAction, lang: WatchLang, short = false): string {
  return (short ? WATCH_ACTION_SHORT : WATCH_ACTION_WORDS)[action][lang];
}

export type WatchLineInput = Readonly<{
  reason: WatchReason;
  price: number | null;
  exit: Readonly<{ limit: number; target: number | null }> | null;
  toLimitPct: number | null;
  deviationPct: number | null;
  /** The issuer's event in one short line, where the reason is one (`shortEventLine`). */
  eventLine?: string | null;
}>;

export type WatchFormat = Readonly<{ money: (usd: number) => string; pct: (value: number) => string }>;

/**
 * The state's one line, with the figures the state stands on: where the
 * limit and the target are, how near the limit is, why a closed exchange or
 * a premium matters. Null where the state's name says it all («вихід не
 * налаштований»).
 */
export function watchLine(input: WatchLineInput, lang: WatchLang, format: WatchFormat): string | null {
  const w = (en: string, uk: string) => (lang === "uk" ? uk : en);
  const exit = input.exit;
  const limit = exit ? `${watchWord("limit", lang)} ${format.money(exit.limit)}` : null;
  const target = exit && exit.target !== null ? `${watchWord("target", lang)} ${format.money(exit.target)}` : null;
  const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  switch (input.reason) {
    case "between":
      return [limit, target].filter(Boolean).map((part, index) => (index === 0 ? capital(part as string) : part)).join(" · ") || null;
    case "near-limit":
      return input.toLimitPct !== null && limit
        ? w(`${format.pct(input.toLimitPct)} above your loss limit · ${limit}`, `До межі ${format.pct(input.toLimitPct)} · ${limit}`)
        : limit;
    case "issuer-event":
      return input.eventLine ?? w("The issuer opened a swap window.", "Емітент відкрив вікно обміну.");
    case "above-exchange":
      return input.deviationPct !== null ? w(`${format.pct(input.deviationPct)} dearer than the exchange`, `На ${format.pct(input.deviationPct)} дорожче за біржу`) : w("Dearer than the exchange", "Дорожче за біржу");
    case "exchange-closed":
      return w("The exchange is closed — the price can jump when it opens", "Біржа зачинена — ціна може стрибнути на відкритті");
    case "limit":
      return exit && input.price !== null
        ? w(`The price ${format.money(input.price)} reached your loss limit ${format.money(exit.limit)}`, `Ціна ${format.money(input.price)} дійшла до межі збитку ${format.money(exit.limit)}`)
        : w("The price reached your loss limit", "Ціна дійшла до межі збитку");
    case "target":
      return exit && exit.target !== null && input.price !== null
        ? w(`The price ${format.money(input.price)} reached your target ${format.money(exit.target)}`, `Ціна ${format.money(input.price)} дійшла до цілі ${format.money(exit.target)}`)
        : w("The price reached your target", "Ціна дійшла до цілі");
    case "issuer-paused":
      return w("The issuer paused the token", "Емітент призупинив токен");
    case "no-price":
      return w("No fresh price right now — Ryntra checks again", "Свіжої ціни зараз немає — Ryntra перевірить знову");
    case "no-exit":
      return null;
  }
}

/** The tone a state is drawn in: amber for what needs a look, the action's own for «Дія», quiet for the rest. */
export function watchTone(state: WatchState): "calm" | "caution" | "act" | "quiet" {
  if (state === "action") return "act";
  if (state === "attention" || state === "exit-not-set") return "caution";
  if (state === "on-plan") return "calm";
  return "quiet";
}
