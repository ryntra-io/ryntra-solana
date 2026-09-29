import { cookies } from "next/headers";

import {
  normalizeWorkspaceLocale,
  WORKSPACE_LOCALE_COOKIE,
  type WorkspaceLocale,
} from "@/app/shell/locale";
import { translateSolana, translateSolanaMeaning, translateSolanaRuntime } from "./catalog.ts";

export async function solanaServerLocale(): Promise<WorkspaceLocale> {
  const store = await cookies();
  return normalizeWorkspaceLocale(store.get(WORKSPACE_LOCALE_COOKIE)?.value);
}

export async function solanaServerText() {
  const locale = await solanaServerLocale();
  return {
    locale,
    text: (english: string) => translateSolana(locale, english),
    meaning: (english: string) => translateSolanaMeaning(locale, english),
    runtime: (english: string) => translateSolanaRuntime(locale, english),
  } as const;
}
