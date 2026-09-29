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
import { AGENT_CATALOG, agentMessage, type AgentMessageKey } from "./catalog";

export type AgentI18n = Readonly<{
  locale: WorkspaceLocale;
  setLocale(next: WorkspaceLocale): void;
  t(key: AgentMessageKey): string;
}>;

const AgentI18nContext = createContext<AgentI18n | null>(null);

const FALLBACK: AgentI18n = {
  locale: DEFAULT_WORKSPACE_LOCALE,
  setLocale: () => {},
  t: (key) => agentMessage(DEFAULT_WORKSPACE_LOCALE, key),
};

export function useAgentI18n(): AgentI18n {
  return useContext(AgentI18nContext) ?? FALLBACK;
}

export function AgentI18nProvider({
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
      router.refresh();
    },
    [router],
  );

  useEffect(() => {
    const meta = WORKSPACE_LOCALE_META[locale];
    document.documentElement.lang = locale;
    document.documentElement.dir = meta.dir;
  }, [locale]);

  const value = useMemo<AgentI18n>(
    () => ({
      locale,
      setLocale,
      t: (key) => AGENT_CATALOG[locale][key] ?? AGENT_CATALOG.en[key] ?? key,
    }),
    [locale, setLocale],
  );

  return <AgentI18nContext.Provider value={value}>{children}</AgentI18nContext.Provider>;
}
