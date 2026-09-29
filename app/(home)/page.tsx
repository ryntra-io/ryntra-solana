import type { Metadata } from "next";

import { buildLandingMetadata } from "../seo";
import { Homepage } from "./homepage";
import { landingJsonLdScript } from "./landing-jsonld";

/* The route entry for `/` — the landing in English. The address decides the
   language, never a cookie (plan §4): a search engine carries none, and one
   address answering in two languages is a page it cannot index honestly.
   `/uk` is the same page in Ukrainian (`uk/page.tsx`); the header's language
   menu moves between the two. The structured data is the page's own
   (`landing-jsonld.ts`). */
export const metadata: Metadata = buildLandingMetadata("en");

export default function Page() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.lang="en";document.documentElement.dir="ltr";` }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: landingJsonLdScript("en") }} />
      <Homepage locale="en" />
    </>
  );
}
