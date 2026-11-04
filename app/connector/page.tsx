import type { Metadata, Viewport } from "next";

import { CityDocument } from "@/city/components/pages/CityDocument";
import { PALETTE } from "@/city/lib/palette";
import { buildCityPageMetadata } from "@/app/seo";

/* `/connector` — Ryntra in AI chats as a page of the city (CITY-170): connect in three steps, what it reads and checks,
   what it keeps and never does, help; the addresses behind «Technical details». The connector's documentation for a
   person, a search engine and a directory's reviewer. */

export const metadata: Metadata = buildCityPageMetadata("connector", "/connector");

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark" };

export default function Page() {
  return <CityDocument id="connector" />;
}
