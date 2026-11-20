import type { Metadata } from "next";

import { CANDIDATE_PRIVACY } from "@/lib/legal/candidate";
import { LEGAL_PACKAGE } from "@/lib/legal/release";
import { publicServerLocale } from "@/lib/site/server-locale";

import { CandidateDocument } from "../candidate-document";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await publicServerLocale();
  return {
    title: `${CANDIDATE_PRIVACY.title[locale]} — ${locale === "uk" ? "кандидат" : "review candidate"}`,
    description: CANDIDATE_PRIVACY.description[locale],
  };
}

export default function PrivacyPage() {
  return <CandidateDocument document={CANDIDATE_PRIVACY} version={LEGAL_PACKAGE.id} />;
}
