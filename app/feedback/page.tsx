import type { Metadata, Viewport } from "next";

import { CityDocument } from "@/city/components/pages/CityDocument";
import { PALETTE } from "@/city/lib/palette";
import { buildCityPageMetadata } from "@/app/seo";

/* `/feedback` — the same Help as `/support` (CITY-157: Support and Feedback are one form); out of the index, its canonical is `/support`. */

export const metadata: Metadata = buildCityPageMetadata("help", "/feedback");

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark" };

export default function Page() {
  return <CityDocument id="help" />;
}
