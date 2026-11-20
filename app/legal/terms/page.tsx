import type { Metadata, Viewport } from "next";

import { PALETTE } from "@/city/lib/palette";
import { buildCityPageMetadata } from "@/app/seo";

import { TerminalFrame } from "../../docs/_book/frame";
import { PublishedView } from "../_view/PublishedView";

/* `/legal/terms` — the Terms of Use in the terminal's frame and language: the published words exactly
   (`lib/legal/texts/terms.ts`), every part open to read, «Contents» beside them. */

export const dynamic = "force-static";

export const metadata: Metadata = buildCityPageMetadata("terms", "/legal/terms");

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark", viewportFit: "cover" };

export default function Page() {
  return (
    <TerminalFrame>
      <PublishedView id="terms" />
    </TerminalFrame>
  );
}
