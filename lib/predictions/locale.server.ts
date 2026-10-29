import { cookies } from "next/headers";

import { normalizeWorkspaceLocale, WORKSPACE_LOCALE_COOKIE, type WorkspaceLocale } from "@/app/shell/locale";

/**
 * The person's language for the prediction pages and routes: the one
 * language cookie every Ryntra product writes, read without loading any
 * product's own word catalogue. Server only.
 */
export async function predictionsLocale(): Promise<WorkspaceLocale> {
  const store = await cookies();
  return normalizeWorkspaceLocale(store.get(WORKSPACE_LOCALE_COOKIE)?.value);
}
