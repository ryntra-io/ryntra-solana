import type { Metadata, Viewport } from "next";

import { CityDocument } from "@/city/components/pages/CityDocument";
import { PALETTE } from "@/city/lib/palette";
import { buildCityPageMetadata } from "@/app/seo";

/* `/legal/privacy` — the Privacy Policy as a page of the city (CITY-157): the published words exactly (`lib/legal/texts/privacy.ts`); the store listing links `#android`, which opens that section. */

export const metadata: Metadata = buildCityPageMetadata("privacy", "/legal/privacy");

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark" };

export default function Page() {
  return <CityDocument id="privacy" />;
}
