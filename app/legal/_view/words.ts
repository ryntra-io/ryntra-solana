/**
 * The words around the legal documents, English and Ukrainian: the pages' names, the contents, the other
 * documents and the line under them. The documents' own words are not here — they are the published texts
 * (`lib/legal/texts/*`), the drafts for review (`lib/legal/candidate.ts`) and the charts' notices, word for word.
 */
export const LEGAL_WORDS = {
  en: {
    terms: "Terms of Use",
    privacy: "Privacy Policy",
    licences: "Open-source licences",
    contents: "Contents",
    legal: "Legal",
    questions: "Questions about these documents",
    candidate: "Review candidate",
    candidateTerms: "Candidate Terms",
    candidatePrivacy: "Candidate Privacy",
    candidateDisclosures: "Candidate Disclosures",
  },
  uk: {
    terms: "Умови використання",
    privacy: "Політика приватності",
    licences: "Ліцензії відкритого коду",
    contents: "Зміст",
    legal: "Правове",
    questions: "Питання щодо цих документів",
    candidate: "Кандидат на перегляд",
    candidateTerms: "Умови — кандидат",
    candidatePrivacy: "Приватність — кандидат",
    candidateDisclosures: "Розкриття — кандидат",
  },
} as const;

export type LegalWords = (typeof LEGAL_WORDS)[keyof typeof LEGAL_WORDS];

/** One entry of the «Legal» list beside a document. */
export type LegalDoor = Readonly<{ href: string; label: string; current: boolean }>;

/** The published documents and the charts' notices, the one in view marked. */
export function publishedDoors(w: LegalWords, here: "terms" | "privacy" | "licences"): LegalDoor[] {
  return [
    { href: "/legal/terms", label: w.terms, current: here === "terms" },
    { href: "/legal/privacy", label: w.privacy, current: here === "privacy" },
    { href: "/legal/licenses", label: w.licences, current: here === "licences" },
  ];
}

/** The drafts for review, the one in view marked. */
export function candidateDoors(w: LegalWords, here: "terms" | "privacy" | "disclosures"): LegalDoor[] {
  return [
    { href: "/legal/review/terms", label: w.candidateTerms, current: here === "terms" },
    { href: "/legal/review/privacy", label: w.candidatePrivacy, current: here === "privacy" },
    { href: "/legal/review/disclosures", label: w.candidateDisclosures, current: here === "disclosures" },
  ];
}
