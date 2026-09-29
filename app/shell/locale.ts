/**
 * One UI language for every workspace.
 *
 * One hub already persisted `ryntra_hub_locale`. Home and Agent Control write the
 * same cookie rather than inventing a second store — a language change in one
 * cabinet is a language change everywhere. The BCP-47 code is `uk`; the compact
 * control shows `UA`.
 */

export type WorkspaceLocale = "en" | "uk";

export const WORKSPACE_LOCALES = ["en", "uk"] as const;

export const DEFAULT_WORKSPACE_LOCALE: WorkspaceLocale = "en";

export const WORKSPACE_LOCALE_COOKIE = "ryntra_hub_locale";

export function isWorkspaceLocale(value: unknown): value is WorkspaceLocale {
  return value === "en" || value === "uk";
}

export function normalizeWorkspaceLocale(value: string | null | undefined): WorkspaceLocale {
  if (!value) return DEFAULT_WORKSPACE_LOCALE;
  const lower = value.trim().toLowerCase();
  if (lower === "ua" || lower === "uk" || lower.startsWith("uk-") || lower.startsWith("uk_")) return "uk";
  if (lower === "en" || lower.startsWith("en-") || lower.startsWith("en_")) return "en";
  return DEFAULT_WORKSPACE_LOCALE;
}

export function persistWorkspaceLocale(locale: WorkspaceLocale): void {
  try {
    window.localStorage.setItem(WORKSPACE_LOCALE_COOKIE, locale);
  } catch {
    /* Storage can be disabled. The cookie below is the load-bearing one. */
  }
  document.cookie = `${WORKSPACE_LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}

export const WORKSPACE_LOCALE_META: Readonly<
  Record<WorkspaceLocale, { label: string; short: string; dir: "ltr" | "rtl" }>
> = {
  en: { label: "English", short: "EN", dir: "ltr" },
  uk: { label: "Українська", short: "UA", dir: "ltr" },
};
