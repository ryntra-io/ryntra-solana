/**
 * The app's two languages and the choice between them, with nothing native
 * behind them so a test can hold them: English until the person chooses
 * Ukrainian, or the system's language, in «Налаштування» — the phone opens in English,
 * as ryntra.io does (2026-09-28).
 */

export type Locale = 'en' | 'uk'
export type LocalePreference = Locale | 'system'

export const LOCALE_PREFERENCES = ['en', 'uk', 'system'] as const

/** What the phone speaks before the person has chosen. */
export const DEFAULT_LOCALE_PREFERENCE: LocalePreference = 'en'

/** The device's own language, as the two the app speaks: Ukrainian when the system says so, English otherwise. */
export function systemLocale(): Locale {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale ?? ''
    return tag.toLowerCase().startsWith('uk') ? 'uk' : 'en'
  } catch {
    return 'en'
  }
}

/** The preference resolved into a language the screens can use. */
export function resolveLocale(preference: LocalePreference, system: Locale = systemLocale()): Locale {
  return preference === 'system' ? system : preference
}
