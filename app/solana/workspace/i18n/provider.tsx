"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import {
  persistWorkspaceLocale,
  WORKSPACE_LOCALE_META,
  type WorkspaceLocale,
} from "@/app/shell/locale";
import { translateSolana, translateSolanaMeaning, translateSolanaRuntime } from "./catalog.ts";
import { showPageInLanguage } from "@/lib/site/use-page-path";

type SolanaI18n = Readonly<{
  locale: WorkspaceLocale;
  setLocale(next: WorkspaceLocale): void;
  text(english: string): string;
  meaning(english: string): string;
  runtime(english: string): string;
}>;

const Context = createContext<SolanaI18n | null>(null);

export function SolanaI18nProvider({ initialLocale, children }: { initialLocale: WorkspaceLocale; children: ReactNode }) {
  const router = useRouter();
  const [locale, setLocaleState] = useState(initialLocale);

  useEffect(() => { setLocaleState(initialLocale); }, [initialLocale]);

  const setLocale = useCallback((next: WorkspaceLocale) => {
    setLocaleState(next);
    persistWorkspaceLocale(next);
    showPageInLanguage(router, next);
  }, [router]);

  useEffect(() => {
    const meta = WORKSPACE_LOCALE_META[locale];
    document.documentElement.lang = locale;
    document.documentElement.dir = meta.dir;
  }, [locale]);

  const value = useMemo<SolanaI18n>(() => ({
    locale,
    setLocale,
    text: (english) => translateSolana(locale, english),
    meaning: (english) => translateSolanaMeaning(locale, english),
    runtime: (english) => translateSolanaRuntime(locale, english),
  }), [locale, setLocale]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSolanaI18n(): SolanaI18n {
  const value = useContext(Context);
  if (!value) throw new Error("SolanaI18nProvider is missing above the workspace.");
  return value;
}
