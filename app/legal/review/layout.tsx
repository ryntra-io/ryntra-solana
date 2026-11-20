import type { Metadata, Viewport } from "next";

import { PALETTE } from "@/city/lib/palette";

import { TerminalFrame } from "../../docs/_book/frame";

export const metadata: Metadata = {
  title: { default: "Legal review candidate", template: "%s — Ryntra" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark", viewportFit: "cover" };

/*
 * The review candidates, out of the index and apart from the published documents, in the terminal's frame and the reader's language: each
 * draft lists the three beside it (`../_view/words.ts`, `candidateDoors`).
 */
export default function LegalReviewLayout({ children }: { children: React.ReactNode }) {
  return <TerminalFrame>{children}</TerminalFrame>;
}
