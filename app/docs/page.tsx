import type { Metadata, Viewport } from "next";

import { CityDocument } from "@/city/components/pages/CityDocument";
import { PALETTE } from "@/city/lib/palette";
import { buildCityPageMetadata } from "@/app/seo";

/* `/docs` — the documentation of the city (CITY-180): a short opening and every section by group, with a search through their
   headings. Each section stands at its own address (`[...slug]/page.tsx`); the old handbook's chapters lead to them
   (`city/lib/docs/old-chapters.ts`). */

export const dynamic = "force-static";

export const metadata: Metadata = buildCityPageMetadata("docs", "/docs");

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark" };

export default function Page() {
  return <CityDocument id="docs" />;
}
