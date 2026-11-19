import type { Viewport } from "next";

import { PALETTE } from "@/city/lib/palette";

import { TerminalFrame } from "./_book/frame";

/*
 * The documentation's segment: every page of it stands in the terminal's own frame — its rail, its header
 * with the agent's line and its phone tabs — so a reader is one tap from the screen a section describes. The old
 * handbook's addresses lead to the sections before routing (`city/lib/docs/old-chapters.ts`); its styles do not load here.
 */

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark", viewportFit: "cover" };

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <TerminalFrame>{children}</TerminalFrame>;
}
