/**
 * The words of the capability and authority matrix (EXE-1; spec §13.4, §5.3, §6.1): the seven honest states, the
 * four levels of enforcement and the three modes of execution — said to a person, in Ukrainian and English. A state
 * is always a word beside its chip, never a colour alone (spec §13.3).
 *
 * Pure: no I/O. The matrix itself is `./authority-matrix.ts`.
 */

import type { Enforcement, ExecutionMode, HonestState } from "./authority-matrix.ts";

type Bi = Readonly<{ en: string; uk: string }>;
const bi = (en: string, uk: string): Bi => ({ en, uk });

export type AuthorityLocale = "en" | "uk";

/** The chip's word for each state, and one line on what it means for the person. */
export const HONEST_STATE_WORDS: Readonly<Record<HonestState, Readonly<{ chip: Bi; means: Bi }>>> = {
  LIVE: {
    chip: bi("Live", "Наживо"),
    means: bi("Open to people on mainnet; a full cycle has been checked on production.", "Відкрито людям у mainnet; повний цикл перевірено на проді."),
  },
  PAPER: {
    chip: bi("Paper", "Симуляція"),
    means: bi("Simulated: no real money moves.", "Симуляція: справжні гроші не рухаються."),
  },
  PREVIEW: {
    chip: bi("Preview", "Перегляд"),
    means: bi("Shown and built; not proven end to end, or open only to named wallets.", "Видно й зроблено; повний цикл ще не доведено або відкрито лише названим гаманцям."),
  },
  DISABLED: {
    chip: bi("Disabled", "Вимкнено"),
    means: bi("Switched off by Ryntra right now; nothing is built or sent.", "Зараз вимкнено Ryntra; нічого не збирається й не надсилається."),
  },
  UNAVAILABLE: {
    chip: bi("Unavailable", "Недоступно"),
    means: bi("Not built in Ryntra yet.", "У Ryntra цього ще немає."),
  },
  UNKNOWN: {
    chip: bi("Unknown", "Невідомо"),
    means: bi("The state could not be read; nothing is assumed.", "Стан не прочитався; нічого не припускаємо."),
  },
  RECOVERY: {
    chip: bi("Recovery", "Відновлення"),
    means: bi("An action under way is being checked against the chain; nothing new is sent.", "Дію, що вже в дорозі, звіряємо з мережею; нового нічого не надсилаємо."),
  },
};

/** Who holds the bound of an action when the person is not signing it (spec §5.3). */
export const ENFORCEMENT_WORDS: Readonly<Record<Enforcement, Bi>> = {
  PROGRAM_ENFORCED: bi("Held by the on-chain program", "Межу тримає програма в мережі"),
  PROVIDER_NATIVE: bi("Held by the venue's own mechanism", "Межу тримає сам майданчик"),
  RYNTRA_GATEWAY_ENFORCED: bi("Checked by Ryntra's server before you sign", "Перевіряє сервер Ryntra до твого підпису"),
  OBSERVE_ONLY: bi("Watched only — nothing is bound", "Лише спостереження — нічого не обмежено"),
};

/** How an action runs (spec §5.4): who signs and what goes on without the person. */
export const MODE_WORDS: Readonly<Record<ExecutionMode, Bi>> = {
  MANUAL: bi("You sign every action", "Кожну дію підписуєш ти"),
  ASSISTED: bi("You sign once; the venue does the rest", "Підписуєш раз; решту робить майданчик"),
  AUTONOMOUS: bi("Runs by itself within your bound", "Працює сам у межах твого дозволу"),
};

/** The heads of a block that says what each thing does by itself and what waits for the person. */
export const AUTHORITY_HEAD_WORDS = {
  alone: bi("Does by itself", "Робить сам"),
  you: bi("Waits for you", "Чекає на тебе"),
  bound: bi("Bound", "Межа"),
  state: bi("State", "Стан"),
} as const;

export function honestStateWord(state: HonestState, locale: AuthorityLocale): string {
  return HONEST_STATE_WORDS[state].chip[locale];
}
