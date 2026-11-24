import type { Metadata, Viewport } from "next";

import { PALETTE } from "@/city/lib/palette";
import { buildCityPageMetadata } from "@/app/seo";

import { TerminalFrame } from "../docs/_book/frame";
import { HelpView } from "../support/_view/HelpView";

/* `/feedback` — the same Help as `/support` (Support and Feedback are one form), in the terminal's frame; out
   of the index, its canonical is `/support`. */

export const dynamic = "force-static";

export const metadata: Metadata = buildCityPageMetadata("help", "/feedback");

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark", viewportFit: "cover" };

export default function Page() {
  return (
    <TerminalFrame>
      <HelpView />
    </TerminalFrame>
  );
}
