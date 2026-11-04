import type { Metadata, Viewport } from "next";

import { CityDocument } from "@/city/components/pages/CityDocument";
import { PALETTE } from "@/city/lib/palette";
import { buildCityPageMetadata } from "@/app/seo";

/* `/about` — About as a page of the city (CITY-157): Ryntra in one line, what it stands on, how to reach it. */

export const metadata: Metadata = buildCityPageMetadata("about", "/about");

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark" };

export default function Page() {
  return <CityDocument id="about" />;
}
