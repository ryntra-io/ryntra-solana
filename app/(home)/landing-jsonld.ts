import { HOMEPAGE_CATEGORY } from "../../lib/site/homepage-copy.ts";
import { SITE } from "../seo.ts";
import { landingCopy, type LandingLocale } from "./landing-copy.ts";

/**
 * The landing's structured data: the app and the page's own questions, in
 * the page's language.
 *
 * `SoftwareApplication` says what the app is and that it is free to open —
 * Ryntra's fee is a line of the Review, not a price of the app. No
 * `aggregateRating`: Ryntra has no ratings, and none is invented, so no rich
 * result for an app is claimed. The feature list is the page's own «Працює
 * зараз», each item of which `landing.test.mjs` ties to the code that does it —
 * the graph can say no more than the page. `FAQPage` is the questions the page
 * shows, word for word; Google stopped drawing FAQ results in May 2026, so it
 * describes the page and promises nothing.
 */
export function landingJsonLd(locale: LandingLocale) {
  const copy = landingCopy(locale);
  const url = locale === "uk" ? `${SITE}/uk` : SITE;
  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "@id": `${SITE}/#software`,
      name: "Ryntra",
      applicationCategory: "FinanceApplication",
      applicationSubCategory: HOMEPAGE_CATEGORY,
      operatingSystem: "Web",
      inLanguage: locale,
      url,
      description: copy.meta.description,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      featureList: copy.status.now.items.map((item) => item.text),
      publisher: { "@id": `${SITE}/#organization` },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "@id": `${url}#questions`,
      inLanguage: locale,
      url,
      mainEntity: copy.faq.items.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ];
}

/** The graph as the page writes it: `<` escaped, so no string in it can close the script. */
export function landingJsonLdScript(locale: LandingLocale): string {
  return JSON.stringify(landingJsonLd(locale)).replace(/</g, "\\u003c");
}
