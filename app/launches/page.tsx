import type { Metadata, Viewport } from "next";

import { PALETTE } from "@/city/lib/palette";

import { LaunchesPage, launchesMetadata } from "./launches-page";

/* `/launches` — every coin launched on Ryntra (CITY-185): the city, opened on «Launched on Ryntra». */

export const metadata: Metadata = launchesMetadata("en");

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, viewportFit: "cover", maximumScale: 1 };

export default function Page() {
  return <LaunchesPage lang="en" />;
}
