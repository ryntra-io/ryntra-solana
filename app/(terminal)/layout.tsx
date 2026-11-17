import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";

import { LANG_BOOT_SCRIPT } from "@/city/lib/i18n/langs";
import { BUNDLED_CITY } from "@/city/lib/market/bundled";
import { PALETTE } from "@/city/lib/palette";
import { CITY_FONTS } from "@/city/styles/fonts";
import { terminalOpen } from "@/terminal/shell/flag";
import { TerminalShell } from "@/terminal/shell/TerminalShell";
import t from "@/terminal/styles/terminal.module.css";
import { ZERO } from "@/terminal/styles/zero";

import { buildTerminalMetadata } from "../seo";

/* The terminal's frame, around every screen of it: a route group, so it adds nothing to the address. Behind one switch
   (`terminal/shell/flag.ts`): closed — the default, and how ryntra.io is built until the terminal becomes the home page
   — every address under it answers 404 and `/` stays the city. The faces, the language's boot script and the bundled
   market are the city's own: the bundled market draws the server's page and the first paint, and the live read replaces
   it at once. The numbers' zero is the terminal's own plain one (`terminal/styles/zero.ts`). */

/* The terminal's words and card for every screen; a screen names itself before the brand (`buildTerminalMetadata`).
   Offered to the index only in the build people use (`open`), never on a stand. */
export const metadata: Metadata = buildTerminalMetadata();

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark", viewportFit: "cover" };

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  if (!terminalOpen()) notFound();
  return (
    <div className={`${t.root} ${CITY_FONTS.className} ${ZERO.variable}`} style={CITY_FONTS.style}>
      <script dangerouslySetInnerHTML={{ __html: LANG_BOOT_SCRIPT }} />
      <TerminalShell initial={BUNDLED_CITY}>{children}</TerminalShell>
    </div>
  );
}
