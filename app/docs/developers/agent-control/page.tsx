import type { Metadata } from "next";

import { sitePageMetadata } from "@/app/site/seo";
import { DocsPage } from "../../docs-page";

export const metadata: Metadata = sitePageMetadata({
  path: "/docs/developers/agent-control",
  title: "Agent Control developer reference — Ryntra",
  description: "Typed client, HTTP and local MCP reference for Ryntra Agent Control.",
  keywords: ["ryntra agent control", "action evidence sdk", "mcp"],
  /* Agent Control is not the product the site describes: reachable, not offered
     to the index (`RYN-SITE-NOW-001`, 2026-09-26). */
  index: false,
});

export default function Page() {
  return <DocsPage view={{ kind: "agent-control" }} />;
}
