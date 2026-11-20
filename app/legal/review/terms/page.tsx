import type { Metadata } from "next";

import { CANDIDATE_TERMS } from "@/lib/legal/candidate";
import { LEGAL_PACKAGE } from "@/lib/legal/release";
import { publicServerLocale } from "@/lib/site/server-locale";

import { CandidateDocument } from "../candidate-document";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await publicServerLocale();
  return {
    title: `${CANDIDATE_TERMS.title[locale]} — ${locale === "uk" ? "кандидат" : "review candidate"}`,
    description: CANDIDATE_TERMS.description[locale],
  };
}

export default function TermsPage() {
  return <CandidateDocument document={CANDIDATE_TERMS} version={LEGAL_PACKAGE.id} />;
}
