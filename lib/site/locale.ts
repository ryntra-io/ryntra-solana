import { PUBLIC_LOCALE_CODES, PUBLIC_LOCALES as PUBLIC_LOCALE_ROWS } from "../../app/i18n/locales.ts";

/**
 * Public locale — the same cookie the Hub already writes.
 *
 * EN and UA are the published public languages. The BCP-47 code is `uk`;
 * the compact control shows `UA`. This module does not invent a third store:
 * `ryntra_hub_locale` is the Hub cookie, reused so a language chosen on the
 * public site is the language the workspace opens in.
 *
 * Nor does it invent a second list: `PUBLIC_LOCALE_CODES` in
 * `app/i18n/locales.ts` is the one switch for which languages are public,
 * and `SUPPORTED_LOCALES` there carries each language's own name and short
 * code. The header's language control (a menu of every public language, not a
 * pair — more are coming) reads `PUBLIC_LANGUAGES`, so a language added to
 * that switch appears in the menu with no edit here.
 */

export const PUBLIC_LOCALES = PUBLIC_LOCALE_CODES;
export type PublicLocale = (typeof PUBLIC_LOCALE_CODES)[number];

export type PublicLanguage = Readonly<{
  locale: PublicLocale;
  /** What the compact control shows: `EN`, `UA`. */
  code: string;
  /** The language in itself — `English`, `Українська` — so a reader finds
   *  theirs whatever language the page is in. */
  name: string;
}>;

export const PUBLIC_LANGUAGES: readonly PublicLanguage[] = PUBLIC_LOCALE_ROWS.map((row) => ({
  locale: row.code as PublicLocale,
  code: row.shortLabel,
  name: row.label,
}));

export const DEFAULT_PUBLIC_LOCALE: PublicLocale = "en";

/** Same name as `HUB_LOCALE_COOKIE` in the Hub. Do not rename one without the other. */
export const PUBLIC_LOCALE_COOKIE = "ryntra_hub_locale";

export function isPublicLocale(value: unknown): value is PublicLocale {
  return typeof value === "string" && (PUBLIC_LOCALES as readonly string[]).includes(value);
}

/**
 * The landing in a language — English at the root, Ukrainian under `/uk`: the
 * address decides the landing's language, so the wordmark and the footer lead
 * a reader to the landing in theirs.
 */
export function landingHref(locale: PublicLocale): "/" | "/uk" {
  return locale === "uk" ? "/uk" : "/";
}

export function publicLanguage(locale: PublicLocale): PublicLanguage {
  return PUBLIC_LANGUAGES.find((language) => language.locale === locale) ?? PUBLIC_LANGUAGES[0];
}

export function normalizePublicLocale(value: string | null | undefined): PublicLocale {
  if (!value) return DEFAULT_PUBLIC_LOCALE;
  const lower = value.trim().toLowerCase();
  /* The control's own code (`UA`), the locale (`uk`) and its regional forms
     (`uk-UA`, `uk_UA`) all name the same page. */
  for (const { locale, code } of PUBLIC_LANGUAGES) {
    if (lower === locale || lower === code.toLowerCase() || lower.startsWith(`${locale}-`) || lower.startsWith(`${locale}_`)) return locale;
  }
  return DEFAULT_PUBLIC_LOCALE;
}

export function writePublicLocaleCookie(locale: PublicLocale): void {
  document.cookie = `${PUBLIC_LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
  try {
    window.localStorage.setItem(PUBLIC_LOCALE_COOKIE, locale);
  } catch {
    /* Private mode can refuse storage; the cookie is enough for the next request. */
  }
}

export function readPublicLocaleClient(): PublicLocale {
  try {
    const stored = window.localStorage.getItem(PUBLIC_LOCALE_COOKIE);
    if (isPublicLocale(stored)) return stored;
  } catch {
    /* ignore */
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${PUBLIC_LOCALE_COOKIE}=([^;]*)`));
  return normalizePublicLocale(match?.[1] ?? null);
}
