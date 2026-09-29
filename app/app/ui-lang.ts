import { cookies } from "next/headers";

import { CB_COPY } from "./copy";
import { normalizeWorkspaceLocale, WORKSPACE_LOCALE_COOKIE } from "@/app/shell/locale";

/** UI copy for Home pages: the workspace locale cookie, not the Telegram bot language. */
export async function cabinetUiCopy() {
  const store = await cookies();
  const lang = normalizeWorkspaceLocale(store.get(WORKSPACE_LOCALE_COOKIE)?.value);
  return { lang, c: CB_COPY[lang] ?? CB_COPY.en };
}
