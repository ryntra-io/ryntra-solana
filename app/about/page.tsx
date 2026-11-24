import type { Metadata, Viewport } from "next";

import { PALETTE } from "@/city/lib/palette";

import { SITE, SITE_NAME, TWITTER, cardImageFor } from "@/app/seo";

import { TerminalFrame } from "../docs/_book/frame";
import { AboutView } from "./_view/AboutView";

/* `/about` — About in the terminal's frame and language: Ryntra in one line, three facts, how to reach it. */

export const dynamic = "force-static";

const TITLE = "About Ryntra — the AI terminal on Solana";
const DESCRIPTION = "Ryntra is an AI terminal on Solana: say what to do, your agent does the rest. Your wallet signs every move.";

/* The page's share card by its address (`terminal/share/cards.ts`). */
const CARD = cardImageFor("/about");

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `${SITE}/about` },
  openGraph: { type: "website", siteName: SITE_NAME, title: TITLE, description: DESCRIPTION, url: `${SITE}/about`, images: [CARD] },
  twitter: { card: "summary_large_image", site: TWITTER, creator: TWITTER, title: TITLE, description: DESCRIPTION, images: [CARD.url] },
};

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark", viewportFit: "cover" };

export default function Page() {
  return (
    <TerminalFrame>
      <AboutView />
    </TerminalFrame>
  );
}
