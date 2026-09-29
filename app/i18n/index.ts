/* Live i18n surface: locale metadata and helpers only.
   The old full-landing dictionary corpus (schema.ts + dictionaries/*) was dead code —
   nothing rendered it (the live landing copy is app/landing/content.ts) — and was
   removed by RYN-CANON-001 so unshipped copy can never bypass the claim gate. */

export {
  ENABLED_LOCALE_CODES,
  ENABLED_LOCALES,
  PUBLIC_LOCALE_CODES,
  PUBLIC_LOCALES,
  SUPPORTED_LOCALES,
  isLocaleCode,
  isPublicLocale,
  localeDir,
  normalizeLocale,
} from "./locales";
export type { LocaleCode, LocaleDir, LocaleMeta, PublicLocaleCode } from "./locales";
