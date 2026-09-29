"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { applyThemePref, getThemePref, type ThemePref } from "../theme";
import {
  normalizeWorkspaceLocale,
  persistWorkspaceLocale,
  WORKSPACE_LOCALE_COOKIE,
  WORKSPACE_LOCALE_META,
  type WorkspaceLocale,
} from "@/app/shell/locale";
import { SHELL_CHROME_COPY } from "@/app/shell/chrome-copy";
import { showPageInLanguage } from "@/lib/site/use-page-path";

/**
 * Appearance — theme and UI language, both device preferences.
 *
 * Theme writes `app/app/theme.ts` only. Language writes the same
 * `ryntra_hub_locale` cookie the hubs already use, so a change here is a change
 * in every workspace.
 */

const THEME: readonly { pref: ThemePref; hint: { en: string; uk: string } }[] = [
  { pref: "dark", hint: { en: "Midnight ground. The product default.", uk: "Midnight. Типовий вигляд продукту." } },
  { pref: "light", hint: { en: "Mineral paper — never a pure-white page.", uk: "Мінеральний папір — ніколи не чиста біла сторінка." } },
];

function readLocale(): WorkspaceLocale {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${WORKSPACE_LOCALE_COOKIE}=([^;]*)`));
    return normalizeWorkspaceLocale(match?.[1] ? decodeURIComponent(match[1]) : null);
  } catch {
    return "en";
  }
}

export function Appearance() {
  const router = useRouter();
  const [theme, setTheme] = useState<ThemePref | null>(null);
  const [locale, setLocale] = useState<WorkspaceLocale | null>(null);

  useEffect(() => {
    const pref = getThemePref();
    setTheme(pref);
    applyThemePref(pref);
    setLocale(readLocale());
  }, []);

  const chooseTheme = (pref: ThemePref) => {
    setTheme(pref);
    applyThemePref(pref);
  };

  const chooseLocale = (next: WorkspaceLocale) => {
    setLocale(next);
    persistWorkspaceLocale(next);
    document.documentElement.lang = next;
    showPageInLanguage(router, next);
  };

  const ui = locale ?? "en";
  const chrome = SHELL_CHROME_COPY[ui];
  const title = ui === "uk" ? "Вигляд" : "Appearance";
  const themeLabel = ui === "uk" ? "Тема" : "Theme";
  const languageLabel = ui === "uk" ? "Мова" : "Language";
  const hint =
    ui === "uk"
      ? "Одна перевага для кожного робочого простору. Кольори ризику зафіксовані дизайном і тема їх ніколи не змінює."
      : "One preference for every workspace. Risk colours are locked by design and are never restyled by the theme.";

  return (
    <section className="cb-card">
      <div className="cb-card-head"><h2>{title}</h2></div>
      <label className="cb-field">
        <span>{themeLabel}</span>
        <div className="cb-seg" role="radiogroup" aria-label={themeLabel}>
          {THEME.map(({ pref, hint: themeHint }) => (
            <button
              key={pref}
              type="button"
              role="radio"
              aria-checked={theme === pref}
              title={themeHint[ui]}
              className={theme === pref ? "on" : ""}
              onClick={() => chooseTheme(pref)}
            >
              {pref === "dark" ? chrome.theme.dark : chrome.theme.light}
            </button>
          ))}
        </div>
      </label>
      <label className="cb-field">
        <span>{languageLabel}</span>
        <div className="cb-seg" role="radiogroup" aria-label={languageLabel}>
          {(["en", "uk"] as const).map((code) => (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={locale === code}
              className={locale === code ? "on" : ""}
              onClick={() => chooseLocale(code)}
            >
              {WORKSPACE_LOCALE_META[code].label}
            </button>
          ))}
        </div>
      </label>
      <p className="cb-hint">{hint}</p>
    </section>
  );
}
