import type { LegalDocument } from "@/lib/legal/candidate";
import type { PublicLocale } from "@/lib/site/locale";

import { LegalReviewNotice } from "../review-notice";

/**
 * One review-candidate document, rendered from `lib/legal/candidate.ts` in the
 * reader's language: the title, the candidate's version, the notice that it
 * is not in force, the lead and the numbered sections. A table sits in a
 * focusable, labelled region that scrolls sideways on its own, with its
 * caption read aloud and not drawn.
 */
export function CandidateDocument({ document, locale, version }: { document: LegalDocument; locale: PublicLocale; version: string }) {
  return (
    <>
      <h1>{document.title[locale]}</h1>
      <p className="legal-updated">{locale === "uk" ? "Кандидат на перегляд" : "Review candidate"} · {version}</p>
      <LegalReviewNotice locale={locale} />
      <p className="legal-lead">{document.lead[locale]}</p>
      {document.sections.map((section) => (
        <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`}>
          <h2 id={`${section.id}-heading`}>{section.heading[locale]}</h2>
          {section.blocks.map((block, index) => {
            if ("p" in block) return <p key={index}>{block.p[locale]}</p>;
            if ("list" in block) return <ul key={index}>{block.list[locale].map((item) => <li key={item}>{item}</li>)}</ul>;
            const table = block.table;
            return (
              <div key={index} className="legal-table-wrap" role="region" aria-label={table.caption[locale]} tabIndex={0}>
                <table>
                  <caption className="sr-only">{table.caption[locale]}</caption>
                  <thead>
                    <tr>{table.head[locale].map((cell) => <th key={cell} scope="col">{cell}</th>)}</tr>
                  </thead>
                  <tbody>
                    {table.rows[locale].map((row) => <tr key={row.join("|")}>{row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`}>{cell}</td>)}</tr>)}
                  </tbody>
                </table>
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}
