"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GearSix, Moon, Sun, Translate } from "@phosphor-icons/react";

import { applyThemePref, getThemePref, type ThemePref } from "@/app/app/theme";
import { WORKSPACE_LOCALE_META, type WorkspaceLocale } from "./locale";

/**
 * Налаштування · Мова · Тема — three rows of the wallet's menu (canon v5.4
 * В31, 2026-09-24): the language and the theme left the foot of the rail for
 * the top bar's one menu, where a person looks for their own settings.
 *
 * Neither row holds a preference of its own. Language is the workspace
 * locale the caller already owns (`onLocale`, the same writer the Settings
 * page uses); theme is `app/app/theme.ts`, read on mount and watched on
 * `<html data-theme>`, so this menu, Settings → Appearance and anything else
 * that shows the theme cannot disagree.
 */

export type MenuPreferencesWords = Readonly<{
  settings: string;
  language: string;
  theme: string;
  dark: string;
  light: string;
}>;

export function MenuPreferences({
  locale,
  onLocale,
  settingsHref,
  words,
  onDone,
}: {
  locale: WorkspaceLocale;
  onLocale: (next: WorkspaceLocale) => void;
  settingsHref: string;
  words: MenuPreferencesWords;
  /** Closes the menu the rows live in when a row takes the person somewhere. */
  onDone?: () => void;
}) {
  const [theme, setTheme] = useState<ThemePref | null>(null);
  useEffect(() => {
    setTheme(getThemePref());
    const observer = new MutationObserver(() => setTheme(getThemePref()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const current = theme ?? "dark";
  const nextTheme: ThemePref = current === "dark" ? "light" : "dark";
  const nextLocale: WorkspaceLocale = locale === "en" ? "uk" : "en";
  const ThemeIcon = current === "dark" ? Moon : Sun;

  return (
    <div className="rs-menu-prefs" role="group" aria-label={words.settings}>
      <Link className="rs-menu-item" href={settingsHref} onClick={onDone} role="menuitem">
        <GearSix size={16} weight="bold" aria-hidden />
        <span className="rs-menu-item-label">{words.settings}</span>
      </Link>
      <button
        type="button"
        className="rs-menu-item"
        role="menuitem"
        onClick={() => onLocale(nextLocale)}
        aria-label={`${words.language}: ${WORKSPACE_LOCALE_META[locale].label}`}
      >
        <Translate size={16} weight="bold" aria-hidden />
        <span className="rs-menu-item-label">{words.language}</span>
        <span className="rs-menu-item-value">{WORKSPACE_LOCALE_META[locale].label}</span>
      </button>
      <button
        type="button"
        className="rs-menu-item"
        role="menuitem"
        data-pref={current}
        onClick={() => {
          applyThemePref(nextTheme);
          setTheme(nextTheme);
        }}
        aria-label={`${words.theme}: ${current === "dark" ? words.dark : words.light}`}
      >
        <ThemeIcon size={16} weight="bold" aria-hidden />
        <span className="rs-menu-item-label">{words.theme}</span>
        <span className="rs-menu-item-value">{current === "dark" ? words.dark : words.light}</span>
      </button>
    </div>
  );
}
