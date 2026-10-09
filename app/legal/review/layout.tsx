import type { Metadata } from "next";

import { publicServerLocale } from "@/lib/site/server-locale";

export const metadata: Metadata = {
  title: { default: "Legal review candidate", template: "%s — Ryntra" },
  robots: { index: false, follow: false },
};

/*
 * The review candidates, out of the index and apart from the published
 * documents, in the reader's language.
 */
export default async function LegalReviewLayout({ children }: { children: React.ReactNode }) {
  const locale = await publicServerLocale();
  const uk = locale === "uk";
  return (
    <section className="legal-candidate" lang={locale} dir="ltr">
      <nav className="legal-review-nav" aria-label={uk ? "Документи-кандидати" : "Legal review candidate documents"}>
        <a href="/legal/review/terms">{uk ? "Умови — кандидат" : "Candidate Terms"}</a>
        <a href="/legal/review/privacy">{uk ? "Приватність — кандидат" : "Candidate Privacy"}</a>
        <a href="/legal/review/disclosures">{uk ? "Розкриття — кандидат" : "Candidate Disclosures"}</a>
      </nav>
      {children}
    </section>
  );
}
