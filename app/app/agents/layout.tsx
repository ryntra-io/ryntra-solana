import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { normalizeWorkspaceLocale, WORKSPACE_LOCALE_COOKIE } from "@/app/shell/locale";
import { AgentI18nProvider } from "@/app/agents/workspace/i18n/provider";
import { PassportDirectoryProvider } from "@/app/agents/workspace/passport-directory-store";
import "@/app/agents/workspace/agent-workspace.css";
export default async function AgentsLayout({children}:{children:ReactNode}) {
 const store=await cookies(); const locale=normalizeWorkspaceLocale(store.get(WORKSPACE_LOCALE_COOKIE)?.value);
 return <AgentI18nProvider initialLocale={locale}><PassportDirectoryProvider>{children}</PassportDirectoryProvider></AgentI18nProvider>;
}
