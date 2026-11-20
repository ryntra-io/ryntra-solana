import type { Metadata, Viewport } from "next";

import { PALETTE } from "@/city/lib/palette";
import { buildCityPageMetadata } from "@/app/seo";

import { TerminalFrame } from "../../docs/_book/frame";
import { PublishedView } from "../_view/PublishedView";

/* `/legal/privacy` — the Privacy Policy in the terminal's frame and language: the published words exactly
   (`lib/legal/texts/privacy.ts`); the store listing links `#android`, which brings that part into view. */

export const dynamic = "force-static";

export const metadata: Metadata = buildCityPageMetadata("privacy", "/legal/privacy");

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark", viewportFit: "cover" };

export default function Page() {
  return (
    <TerminalFrame>
      <PublishedView id="privacy" />
    </TerminalFrame>
  );
}
