"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import {
  DEFAULT_WORKSPACE_LOCALE,
  persistWorkspaceLocale,
  WORKSPACE_LOCALE_META,
  type WorkspaceLocale,
} from "@/app/shell/locale";
import { HOME_CATALOG, homeMessage, type HomeMessageKey } from "./catalog";
import { showPageInLanguage } from "@/lib/site/use-page-path";

export type HomeI18n = Readonly<{
  locale: WorkspaceLocale;
  setLocale(next: WorkspaceLocale): void;
  t(key: HomeMessageKey): string;
}>;

const HomeI18nContext = createContext<HomeI18n | null>(null);

const FALLBACK: HomeI18n = {
  locale: DEFAULT_WORKSPACE_LOCALE,
  setLocale: () => {},
  t: (key) => homeMessage(DEFAULT_WORKSPACE_LOCALE, key),
};

export function useHomeI18n(): HomeI18n {
  return useContext(HomeI18nContext) ?? FALLBACK;
}

export function HomeI18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: WorkspaceLocale;
  children: ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<WorkspaceLocale>(initialLocale ?? DEFAULT_WORKSPACE_LOCALE);

  useEffect(() => { setLocaleState(initialLocale); }, [initialLocale]);

  const setLocale = useCallback(
    (next: WorkspaceLocale) => {
      setLocaleState(next);
      persistWorkspaceLocale(next);
      showPageInLanguage(router, next);
    },
    [router],
  );

  useEffect(() => {
    const meta = WORKSPACE_LOCALE_META[locale];
    document.documentElement.lang = locale;
    document.documentElement.dir = meta.dir;
  }, [locale]);

  const value = useMemo<HomeI18n>(
    () => ({
      locale,
      setLocale,
      t: (key) => HOME_CATALOG[locale][key] ?? HOME_CATALOG.en[key] ?? key,
    }),
    [locale, setLocale],
  );

  return <HomeI18nContext.Provider value={value}>{children}</HomeI18nContext.Provider>;
}
