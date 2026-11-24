import type { Metadata } from "next";

import { SITE, SITE_NAME, TWITTER, cardImageFor } from "@/app/seo";

import { docsTabTitle } from "./_book/book";
import { DocsHub } from "./_book/DocsHub";

/* `/docs` — the documentation of the terminal: what Ryntra is, its sections, Meteora in Ryntra, trust, and
   where it is going. The words are data (`_book/book.ts`), the frames are cut from the live site. The title is the
   English one; the page names the tab in the reader's language once it knows it (`useDocsTabTitle`). */

export const dynamic = "force-static";

const TITLE = docsTabTitle(null, "en");
const DESCRIPTION = "What Ryntra does today and how: the Market, Swap and Bridge, Spot, Launch, Bots, Agents, Earn, Meteora DLMM Pro, Portfolio and Money. Say it. Your agent does the rest.";

/* The docs' share card: a frame of the docs, the mark and the line (`terminal/share/cards.ts`). */
const CARD = cardImageFor("/docs");

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `${SITE}/docs` },
  openGraph: { type: "website", siteName: SITE_NAME, title: TITLE, description: DESCRIPTION, url: `${SITE}/docs`, images: [CARD] },
  twitter: { card: "summary_large_image", site: TWITTER, creator: TWITTER, title: TITLE, description: DESCRIPTION, images: [CARD.url] },
};

export default function Page() {
  return <DocsHub />;
}
