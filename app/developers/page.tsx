import type { Metadata, Viewport } from "next";

import { PALETTE } from "@/city/lib/palette";
import { buildCityPageMetadata } from "@/app/seo";

import { TerminalFrame } from "../docs/_book/frame";
import { DevelopersView } from "./_view/DevelopersView";

/* `/developers` — Developers in the terminal's frame and language: connect an agent in three steps; the addresses of the
   API behind «Technical details». */

export const dynamic = "force-static";

export const metadata: Metadata = buildCityPageMetadata("developers", "/developers");

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark", viewportFit: "cover" };

export default function Page() {
  return (
    <TerminalFrame>
      <DevelopersView />
    </TerminalFrame>
  );
}
