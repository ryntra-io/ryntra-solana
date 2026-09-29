import type { Metadata } from "next";
import { cookies } from "next/headers";

import { Appearance } from "@/app/app/settings/appearance";
import { WorkspacePageHeader } from "@/app/shell/page-header";
import { normalizeWorkspaceLocale, WORKSPACE_LOCALE_COOKIE } from "@/app/shell/locale";
import { agentMessage } from "../i18n/catalog";

export const metadata: Metadata = {
  title: "Workspace settings",
  description: "Appearance, language and where each setting actually takes effect.",
};

export default async function AgentWorkspaceSettingsPage() {
  const store = await cookies();
  const locale = normalizeWorkspaceLocale(store.get(WORKSPACE_LOCALE_COOKIE)?.value);

  return (
    <div className="acw-page">
      <WorkspacePageHeader
        title={agentMessage(locale, "nav.settings")}
        aboutLabel={agentMessage(locale, "chrome.about")}
        lead={<p>{agentMessage(locale, "settings.appearance")}</p>}
      />
      <Appearance />
    </div>
  );
}
