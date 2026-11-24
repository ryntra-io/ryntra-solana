import type { Metadata, Viewport } from "next";

import { PALETTE } from "@/city/lib/palette";
import { buildCityPageMetadata } from "@/app/seo";

import { TerminalFrame } from "../docs/_book/frame";
import { ConnectorView } from "./_view/ConnectorView";

/* `/connector` — Ryntra in AI chats in the terminal's frame and language: connect in three steps, what it
   reads and checks, what it never does; the addresses behind «Technical details». The connector's documentation for a
   person, a search engine and a directory's reviewer. */

export const dynamic = "force-static";

export const metadata: Metadata = buildCityPageMetadata("connector", "/connector");

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark", viewportFit: "cover" };

export default function Page() {
  return (
    <TerminalFrame>
      <ConnectorView />
    </TerminalFrame>
  );
}
