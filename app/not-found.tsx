import type { Metadata, Viewport } from "next";

import { Lost } from "@/city/components/open/Lost";
import { LOST } from "@/city/components/open/words";
import { LANG_BOOT_SCRIPT } from "@/city/lib/i18n/langs";
import { PALETTE } from "@/city/lib/palette";

import { buildCityMetadata } from "./seo";

/* Every address that is not a page — one that never was, or one a page answers with `notFound()` — is the city's own
   404 (CITY-159): the island, one line, one way back to the city. Never offered to the index; a shared link to it
   carries the city's card, not a stale one. The short addresses (`/launch`, `/trade` …) and the old interface's lead
   into the city before they get here (`city/lib/open/old-addresses.ts`). */

const city = buildCityMetadata();

export const metadata: Metadata = {
  title: { absolute: LOST.en.missingTitle },
  robots: { index: false, follow: false },
  openGraph: city.openGraph,
  twitter: city.twitter,
};

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark", viewportFit: "cover" };

export default function NotFound() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: LANG_BOOT_SCRIPT }} />
      <Lost kind="missing" />
    </>
  );
}
