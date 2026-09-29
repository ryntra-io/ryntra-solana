import type { Metadata } from "next";

import { agentWorkspaceLocale } from "../i18n/server";
import { WorkspaceSurfacePage } from "../surface-page";
import { workspaceSurface } from "../surfaces";

/* The tab title follows the workspace language, exactly like every other
   migrated Agent Control route: the registry (with its Ukrainian overlay) is
   the one source for both the page heading and the metadata. */
export async function generateMetadata(): Promise<Metadata> {
  const surface = workspaceSurface("evidence", await agentWorkspaceLocale());
  return { title: surface.title, description: surface.lede };
}

export default function AgentWorkspaceEvidencePage() {
  return <WorkspaceSurfacePage id="evidence" />;
}
