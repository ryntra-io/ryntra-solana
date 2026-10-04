import type { Metadata } from "next";

import { buildLandingMetadata } from "../../seo";
import { Homepage } from "../homepage";
import { landingJsonLdScript } from "../landing-jsonld";

/* The route entry for `/uk` — the landing in Ukrainian, the same page as `/`
   (English at the root, Ukrainian under `/uk`, the address deciding the
   language). The header, handed the page's language, writes it to the
   language cookie on arrival (`PublicHeader`'s `locale`), so a visit to `/uk`
   sets Ukrainian — and «Відкрити застосунок» opens the app in the language
   of the page it was pressed on. */
export const metadata: Metadata = buildLandingMetadata("uk");

export default function Page() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.lang="uk";document.documentElement.dir="ltr";` }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: landingJsonLdScript("uk") }} />
      <Homepage locale="uk" />
    </>
  );
}
