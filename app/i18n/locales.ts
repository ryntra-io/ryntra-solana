export const ENABLED_LOCALE_CODES = [
  "en",
  "uk",
  "ru",
  "es",
  "pt-BR",
  "fr",
  "tr",
  "vi",
  "id",
  "zh",
  "ko",
  "ar",
] as const;

export type LocaleCode = (typeof ENABLED_LOCALE_CODES)[number];
export type LocaleDir = "ltr" | "rtl";

/**
 * The locales the public surface actually exposes.
 *
 * This list is the single switch for public locale availability: hreflang, the
 * sitemap, the sub-locale routes and the header language control all derive
 * from it. Nothing else decides which locales are public.
 *
 * English and Ukrainian are public. Every other locale stays translated in the
 * repository and reachable through a temporary 307 to its English URL —
 * parked, not deleted. Restoring a locale means adding its code back here and
 * running its copy QA.
 *
 * Interface language has never gated anything. It does not affect eligibility,
 * readiness, or any trading gate, and that stays true with one locale or twelve.
 */
export const PUBLIC_LOCALE_CODES = ["en", "uk"] as const;
export type PublicLocaleCode = (typeof PUBLIC_LOCALE_CODES)[number];

export function isPublicLocale(value: string): value is PublicLocaleCode {
  return (PUBLIC_LOCALE_CODES as readonly string[]).includes(value);
}

export const SUPPORTED_LOCALES = [
  { code: "en", label: "English", shortLabel: "EN", dir: "ltr", enabled: true },
  { code: "uk", label: "Українська", shortLabel: "UA", dir: "ltr", enabled: true },
  { code: "ru", label: "Русский", shortLabel: "RU", dir: "ltr", enabled: true },
  { code: "es", label: "Español", shortLabel: "ES", dir: "ltr", enabled: true },
  { code: "pt-BR", label: "Português", shortLabel: "PT", dir: "ltr", enabled: true },
  { code: "fr", label: "Français", shortLabel: "FR", dir: "ltr", enabled: true },
  { code: "tr", label: "Türkçe", shortLabel: "TR", dir: "ltr", enabled: true },
  { code: "vi", label: "Tiếng Việt", shortLabel: "VI", dir: "ltr", enabled: true },
  { code: "id", label: "Bahasa Indonesia", shortLabel: "ID", dir: "ltr", enabled: true },
  { code: "zh", label: "中文", shortLabel: "ZH", dir: "ltr", enabled: true },
  { code: "ko", label: "한국어", shortLabel: "KO", dir: "ltr", enabled: true },
  { code: "ar", label: "العربية", shortLabel: "AR", dir: "rtl", enabled: true },
  { code: "hi", label: "हिन्दी", shortLabel: "HI", dir: "ltr", enabled: false },
  { code: "pl", label: "Polski", shortLabel: "PL", dir: "ltr", enabled: false },
] as const;

export type LocaleMeta = (typeof SUPPORTED_LOCALES)[number];

export const ENABLED_LOCALES = SUPPORTED_LOCALES.filter((locale) =>
  (ENABLED_LOCALE_CODES as readonly string[]).includes(locale.code)
);

export const PUBLIC_LOCALES = SUPPORTED_LOCALES.filter((locale) =>
  (PUBLIC_LOCALE_CODES as readonly string[]).includes(locale.code),
);

export function isLocaleCode(value: string): value is LocaleCode {
  return (ENABLED_LOCALE_CODES as readonly string[]).includes(value);
}

export function normalizeLocale(value?: string | null): LocaleCode {
  if (!value) return "en";

  const raw = value.trim();
  const lower = raw.toLowerCase();

  if (lower === "ua") return "uk";
  if (lower === "pt" || lower === "pt-br" || lower === "pt_br") return "pt-BR";
  if (lower.startsWith("zh")) return "zh";
  if (lower.startsWith("ko")) return "ko";
  if (lower.startsWith("fr")) return "fr";

  const exact = ENABLED_LOCALE_CODES.find((code) => code.toLowerCase() === lower);
  if (exact) return exact;

  const primary = lower.split(/[-_]/)[0];
  if (primary === "uk") return "uk";
  if (primary === "ru") return "ru";
  if (primary === "es") return "es";
  if (primary === "tr") return "tr";
  if (primary === "vi") return "vi";
  if (primary === "id") return "id";
  if (primary === "ar") return "ar";

  return "en";
}

export function localeDir(locale: LocaleCode): LocaleDir {
  return locale === "ar" ? "rtl" : "ltr";
}
