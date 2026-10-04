import type { Metadata } from "next";

import { sitePageMetadata } from "@/app/site/seo";
import { DocsPage } from "../docs-page";

export const metadata: Metadata = sitePageMetadata({
  path: "/docs/developers",
  title: "Developer documentation — Ryntra",
  description: "Choose the Ryntra API or SDK contract that matches your integration.",
  keywords: ["ryntra api", "ryntra sdk", "openapi"],
  /* Reachable for whoever holds the link, not offered to the index: the two
     contracts it lists have no public access, and the site describes the
     product people use (since 2026-09-26). */
  index: false,
});

export default function Page() {
  return <DocsPage view={{ kind: "developers" }} />;
}
