import type { Metadata } from "next";

import { sitePageMetadata } from "@/app/site/seo";

import { PublicSurfaceRole } from "../public-role";

import { AgentPassportExplorer } from "./passport-explorer";

export const metadata: Metadata = {
  ...sitePageMetadata({
    path: "/agents/passport",
    title: "Read-only Agent Passport — Ryntra",
    description:
      "Inspect source-labelled public Agentverse declarations, Ryntra read observations, conflicts and unknowns without a trust score, registration or chat.",
    audience: "guard",
  }),
  robots: { index: false, follow: false },
};

export default function AgentPassportPage() {
  return (
    <main id="main" className="ag-agent-passport-route" tabIndex={-1}>
      <PublicSurfaceRole
        what="A point-in-time, source-labelled read of one exact Agentverse address."
        workspaceHref="/agents/workspace/passport"
      />
      <AgentPassportExplorer />
    </main>
  );
}
