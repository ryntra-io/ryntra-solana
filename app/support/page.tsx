import type { Metadata, Viewport } from "next";

import { CityDocument } from "@/city/components/pages/CityDocument";
import { PALETTE } from "@/city/lib/palette";
import { buildCityPageMetadata } from "@/app/seo";

/* `/support` — Help as a page of the city (CITY-157): one form for a question, a problem, an idea or a security report, on the engine's inbox (`POST /api/feedback`). The store listing names this address. */

export const metadata: Metadata = buildCityPageMetadata("help", "/support");

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark" };

export default function Page() {
  return <CityDocument id="help" />;
}
