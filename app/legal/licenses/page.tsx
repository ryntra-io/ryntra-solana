import type { Metadata, Viewport } from "next";

import { ChartLicenses } from "@ryntra/core/chart";

import { PALETTE } from "@/city/lib/palette";

import { TerminalFrame } from "../../docs/_book/frame";
import { LicencesView } from "../_view/LicencesView";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: { absolute: "Open-source licences — Ryntra" },
  description: "The open-source libraries Ryntra's charts draw with, their licences and the notices their terms ask to be shown.",
  alternates: { canonical: "https://ryntra.io/legal/licenses" },
};

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark", viewportFit: "cover" };

/**
 * The licences page (CH-17; the terminal's frame): the core's charts draw with open-source libraries —
 * KLineChart under Apache-2.0 — whose terms ask for their notice to be shown; the core's `ChartLicenses` gives each one
 * word for word. Both languages are drawn here, on the server, and the page shows the reader's.
 */
export default function LicensesPage() {
  return (
    <TerminalFrame>
      <LicencesView en={<ChartLicenses lang="en" />} uk={<ChartLicenses lang="uk" />} />
    </TerminalFrame>
  );
}
