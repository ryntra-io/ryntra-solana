import type { Metadata, Viewport } from "next";

import { PALETTE } from "@/city/lib/palette";

import { SITE, SITE_NAME, TWITTER } from "@/app/seo";

import { TerminalFrame } from "../docs/_book/frame";
import { HelpView } from "./_view/HelpView";

/* `/support` — Help in the terminal's frame and language: one form for a question, a problem, an idea or a
   security report, on the engine's inbox (`POST /api/feedback`). The store listing names this address. */

export const dynamic = "force-static";

const TITLE = "Ryntra Help — write to us";
const DESCRIPTION = "A question, a problem, an idea or a security report about Ryntra, the AI terminal on Solana — one form, read by the team.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `${SITE}/support` },
  openGraph: { type: "website", siteName: SITE_NAME, title: TITLE, description: DESCRIPTION, url: `${SITE}/support` },
  twitter: { card: "summary_large_image", site: TWITTER, creator: TWITTER, title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark", viewportFit: "cover" };

export default function Page() {
  return (
    <TerminalFrame>
      <HelpView />
    </TerminalFrame>
  );
}
