import type { Metadata, Viewport } from "next";

import { CityDocument } from "@/city/components/pages/CityDocument";
import { PALETTE } from "@/city/lib/palette";
import { buildCityPageMetadata } from "@/app/seo";

/* `/developers` — Developers as a page of the city (CITY-157): connect an agent in three steps; the addresses of the API behind «Technical details». */

export const metadata: Metadata = buildCityPageMetadata("developers", "/developers");

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark" };

export default function Page() {
  return <CityDocument id="developers" />;
}
