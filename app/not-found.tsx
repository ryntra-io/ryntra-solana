import type { Metadata, Viewport } from "next";

import { PALETTE } from "@/city/lib/palette";
import { LOST_WORDS } from "@/terminal/shell/lost/words";
import { Lost } from "@/terminal/shell/lost/Lost";

import { TerminalFrame } from "./docs/_book/frame";
import { buildTerminalMetadata } from "./seo";

/* Every address that is not a page — one that never was, or one a page answers with `notFound()` — is the terminal's
   own page in its frame (the eyes' pass of 19.11): its name, a coin search, one way back to the Market and the sections as
   quiet doors (`terminal/shell/lost/`). Never offered to the index; a shared link to it carries the terminal's card.
   The short addresses (`/launch`, `/trade` …) and the old interface's lead to their sections before they get here
   (`city/lib/open/old-addresses.ts`, `terminal/shell/home.ts`). */

const terminal = buildTerminalMetadata();

export const metadata: Metadata = {
  title: { absolute: LOST_WORDS.en.tab },
  robots: { index: false, follow: false },
  openGraph: terminal.openGraph,
  twitter: terminal.twitter,
};

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark", viewportFit: "cover" };

export default function NotFound() {
  return (
    <TerminalFrame>
      <Lost />
    </TerminalFrame>
  );
}
