import type { Metadata } from "next";

import { SITE, SITE_NAME, TWITTER } from "@/app/seo";

import { DocsHub } from "./_book/DocsHub";

/* `/docs` — the documentation of the terminal: what Ryntra is, its sections, Meteora in Ryntra, trust, and
   where it is going. The words are data (`_book/book.ts`), the frames are cut from the live site. */

export const dynamic = "force-static";

const TITLE = "Ryntra Docs — the AI terminal on Solana";
const DESCRIPTION = "What Ryntra does today and how: the Market, Swap and Bridge, Spot, Launch, Bots, Agents, Earn, Meteora DLMM Pro, Portfolio and Money. Say it. Your agent does the rest.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `${SITE}/docs` },
  openGraph: { type: "website", siteName: SITE_NAME, title: TITLE, description: DESCRIPTION, url: `${SITE}/docs` },
  twitter: { card: "summary_large_image", site: TWITTER, creator: TWITTER, title: TITLE, description: DESCRIPTION },
};

export default function Page() {
  return <DocsHub />;
}
