import type { Metadata } from "next";
import { cookies } from "next/headers";
import { createGoldenRwaDemo } from "@/lib/agent-control/golden-rwa-demo";

import { WorkspacePageHeader } from "@/app/shell/page-header";
import { normalizeWorkspaceLocale, WORKSPACE_LOCALE_COOKIE } from "@/app/shell/locale";
import { agentMessage } from "./i18n/catalog";
import { GoldenRwaWorkspace } from "./golden-rwa-workspace";

export const metadata: Metadata = {
  /*
   * Same-segment pages do not inherit the layout's title template, so the
   * brand suffix is written out; without it the tab reads bare "Mission
   * Control" while every sibling page is branded.
   */
  title: "Mission Control · Agent Control · Ryntra",
  description:
    "Explore one synthetic Golden RWA action at Simple and Pro depth, through deterministic review to the external-wallet boundary.",
};

/* The timestamps and hashes must be current at request time. A static build
   would freeze the sample until its own evidence expired and turn the corrected
   checkpoint into a false REVIEW. */
export const dynamic = "force-dynamic";

export default async function AgentMissionControlPage() {
  const demo = createGoldenRwaDemo();
  const store = await cookies();
  const locale = normalizeWorkspaceLocale(store.get(WORKSPACE_LOCALE_COOKIE)?.value);

  return (
    <div className="acw-page">
      <WorkspacePageHeader
        title={agentMessage(locale, "mission.title")}
        aboutLabel={agentMessage(locale, "chrome.about")}
        lead={<p>{agentMessage(locale, "mission.lead")}</p>}
        badge={<span className="acw-environment">{agentMessage(locale, "mission.sample")}</span>}
      />
      <GoldenRwaWorkspace
        banner={demo.banner}
        stale={demo.stale}
        fresh={demo.fresh}
        reviewed={demo.reviewed}
      />
    </div>
  );
}
