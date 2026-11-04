import type { Metadata, Viewport } from "next";

import { PALETTE } from "@/city/lib/palette";

import { LaunchesPage, launchesMetadata } from "../../launches/launches-page";

/* `/uk/launches` — «Запущено на Ryntra» in Ukrainian (CITY-185): the same city and window, its card and words in Ukrainian. */

export const metadata: Metadata = launchesMetadata("uk");

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, viewportFit: "cover", maximumScale: 1 };

export default function Page() {
  return <LaunchesPage lang="uk" />;
}
