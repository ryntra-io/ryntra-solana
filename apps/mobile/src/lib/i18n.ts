/**
 * The app's language — English or Ukrainian — as a preference on the device:
 * English by default, Ukrainian or the system's language when the person
 * chooses (`./locale`). A screen keeps its words in a small dictionary typed
 * against the English one, so a key missing in Ukrainian is a type error,
 * never an English line on a Ukrainian screen. Figures, times and addresses
 * are formatted by the helpers in `utils/format`, which take the same locale.
 */

import { useSyncExternalStore } from 'react'

import {
  DEFAULT_LOCALE_PREFERENCE,
  LOCALE_PREFERENCES,
  resolveLocale,
  type Locale,
  type LocalePreference,
} from './locale'
import { readPreference, writePreference } from './preferences'

export {
  DEFAULT_LOCALE_PREFERENCE,
  LOCALE_PREFERENCES,
  resolveLocale,
  systemLocale,
  type Locale,
  type LocalePreference,
} from './locale'

const STORAGE_KEY = 'locale'

const listeners = new Set<() => void>()

export function getLocalePreference(): LocalePreference {
  return readPreference<LocalePreference>(STORAGE_KEY, LOCALE_PREFERENCES, DEFAULT_LOCALE_PREFERENCE)
}

export function getLocale(): Locale {
  return resolveLocale(getLocalePreference())
}

export function setLocalePreference(preference: LocalePreference) {
  writePreference(STORAGE_KEY, preference)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The language in effect, live: a change in More re-renders every screen that reads it. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale)
}

export function useLocalePreference(): LocalePreference {
  return useSyncExternalStore(subscribe, getLocalePreference, getLocalePreference)
}

/** A dictionary in both languages; the Ukrainian one must carry every key the English one has. */
export type Copy<T> = Readonly<Record<Locale, T>>

/** The words of one screen in the language in effect. */
export function useCopy<T>(copy: Copy<T>): T {
  return copy[useLocale()]
}

/** The words of one screen in a given language — for code outside React. */
export function copyIn<T>(copy: Copy<T>, locale: Locale): T {
  return copy[locale]
}

/** One place for the words every screen shares. */
const SHARED_EN = {
  tryAgain: 'Try again',
  refresh: 'Refresh',
  noConnection: 'No connection',
  needsNetwork: 'This screen needs the network. Try again when you are back online.',
  didNotLoad: 'Did not load',
  refreshFailed: 'Refresh failed · last read shown',
  offline: 'No connection',
  loading: 'Loading',
  close: 'Close',
  back: 'Back',
  details: 'Details',
  unknown: '—',
  today: 'today',
  yesterday: 'yesterday',
  connectWallet: 'Connect wallet',
  connectTitle: 'Connect your wallet',
  connectDetail: (what: string) => `${what} follows the wallet you connect. Keys never leave it.`,
  signInTitle: 'Sign in with your wallet',
  signInDetail: (what: string) =>
    `${what} is private to this wallet. Signing a message proves it is yours and moves nothing.`,
  signIn: 'Sign in with your wallet',
} as const

type SharedCopy = {
  readonly [K in keyof typeof SHARED_EN]: (typeof SHARED_EN)[K] extends (...args: infer A) => string
    ? (...args: A) => string
    : string
}

const SHARED_UK: SharedCopy = {
  tryAgain: 'Спробувати ще раз',
  refresh: 'Оновити',
  noConnection: 'Немає з’єднання',
  needsNetwork: 'Цьому екрану потрібна мережа. Спробуй ще раз, коли з’явиться зв’язок.',
  didNotLoad: 'Не завантажилось',
  refreshFailed: 'Оновлення не вдалося · показано останнє прочитане',
  offline: 'Немає з’єднання',
  loading: 'Завантаження',
  close: 'Закрити',
  back: 'Назад',
  details: 'Деталі',
  unknown: '—',
  today: 'сьогодні',
  yesterday: 'вчора',
  connectWallet: 'Підключити гаманець',
  connectTitle: 'Підключи гаманець',
  connectDetail: (what: string) => `${what} іде за гаманцем, який ти підключиш. Ключі його не покидають.`,
  signInTitle: 'Увійди гаманцем',
  signInDetail: (what: string) =>
    `${what} приватні для цього гаманця. Підпис повідомлення доводить, що він твій, і нічого не переміщує.`,
  signIn: 'Увійти гаманцем',
}

export const SHARED_COPY: Copy<SharedCopy> = { en: SHARED_EN, uk: SHARED_UK }

export function useSharedCopy(): SharedCopy {
  return useCopy(SHARED_COPY)
}
