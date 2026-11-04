import type { Metadata, Viewport } from "next";

import { CityDocument } from "@/city/components/pages/CityDocument";
import { PALETTE } from "@/city/lib/palette";
import { buildCityPageMetadata } from "@/app/seo";

/* `/legal/terms` — the Terms of Use as a page of the city (CITY-157): the published words exactly (`lib/legal/texts/terms.ts`), in the city's look; the same document the city's menu opens as a window. */

export const metadata: Metadata = buildCityPageMetadata("terms", "/legal/terms");

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark" };

export default function Page() {
  return <CityDocument id="terms" />;
}
