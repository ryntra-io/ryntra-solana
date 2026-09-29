import { cookies } from "next/headers";

import { normalizeWorkspaceLocale, WORKSPACE_LOCALE_COOKIE, type WorkspaceLocale } from "@/app/shell/locale";

/**
 * The workspace locale for a server component, from the one shared cookie.
 *
 * Every Agent Control server page reads this rather than re-deriving the
 * cookie name — the same seam `app/app/ui-lang.ts` gives Ryntra Home.
 */
export async function agentWorkspaceLocale(): Promise<WorkspaceLocale> {
  const store = await cookies();
  return normalizeWorkspaceLocale(store.get(WORKSPACE_LOCALE_COOKIE)?.value);
}
