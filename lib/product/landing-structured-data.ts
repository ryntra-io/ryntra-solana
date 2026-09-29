import type { LandingPublicModel } from "./public-capability-view";
import { HOMEPAGE_CATEGORY, HOMEPAGE_COPY } from "../site/homepage-copy.ts";

export function buildPublicCapabilityFeatureList(model: LandingPublicModel): string[] {
  return model.capabilities
    .filter(
      (capability) =>
        capability.maturity === "live" &&
        capability.freshness === "fresh" &&
        capability.truthTone === "positive",
    )
    .map((capability) => capability.label + ". " + capability.limitation);
}

export function buildLandingCapabilityJsonLd(model: LandingPublicModel, locale: "en" | "uk" = "en") {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": "https://ryntra.io/#software",
    name: "Ryntra",
    applicationCategory: "FinanceApplication",
    applicationSubCategory: HOMEPAGE_CATEGORY,
    operatingSystem: "Web",
    inLanguage: locale,
    description: HOMEPAGE_COPY[locale].description,
    url: locale === "uk" ? "https://ryntra.io/uk" : "https://ryntra.io",
    // Other venue proofs retain their own pages; the current homepage cannot
    // project them as Solana functionality even when their evidence is fresh.
    featureList: buildPublicCapabilityFeatureList({ ...model, capabilities: model.capabilities.filter((entry) => /\bSolana\b/i.test(entry.scopeLabel)) }),
  };
}
