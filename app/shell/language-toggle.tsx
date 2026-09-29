"use client";

import { Translate } from "@phosphor-icons/react";

import {
  WORKSPACE_LOCALE_META,
  type WorkspaceLocale,
} from "./locale";

/**
 * Language, drawn as the same chrome as Theme and Layout.
 *
 * One hub already pins this in `viewExtras`. Home and Agent Control reuse the same
 * quiet button rather than growing a second control in the rail or the page.
 */
export function ShellLanguageToggle({
  locale,
  onChange,
  groupLabel,
}: {
  locale: WorkspaceLocale;
  onChange: (next: WorkspaceLocale) => void;
  groupLabel: string;
}) {
  const current = WORKSPACE_LOCALE_META[locale];
  const next: WorkspaceLocale = locale === "en" ? "uk" : "en";

  return (
    <button
      type="button"
      className="rs-view-theme"
      data-kind="language"
      onClick={() => onChange(next)}
      aria-label={`${groupLabel}: ${current.label}`}
      title={`${groupLabel}: ${current.label}`}
    >
      <Translate size={17} weight="bold" aria-hidden />
      <span className="rs-view-theme-label">{current.short}</span>
    </button>
  );
}
