"use client";

import type { LegalDocument } from "@/lib/legal/candidate";

import { useDocsLang } from "../../docs/_book/parts";
import { LegalPage } from "../_view/LegalPage";
import l from "../_view/legal.module.css";
import { LEGAL_WORDS, candidateDoors } from "../_view/words";
import { LegalReviewNotice } from "../review-notice";

/**
 * One review-candidate document in the terminal's frame, rendered from `lib/legal/candidate.ts` in the
 * reader's language: the title, the candidate's version, the notice that it is not in force, the lead and the numbered
 * sections. A table sits in a focusable, labelled region that scrolls sideways on its own, with its caption read aloud
 * and not drawn.
 */
export function CandidateDocument({ document, version }: { document: LegalDocument; version: string }) {
  const lang = useDocsLang();
  const w = LEGAL_WORDS[lang];
  const doors = candidateDoors(w, document.id);
  return (
    <LegalPage
      lang={lang}
      mark={`review-${document.id}`}
      here={doors.find((door) => door.current)?.label ?? document.title[lang]}
      title={document.title[lang]}
      titleLang={lang}
      docLang={lang}
      date={`${w.candidate} · ${version}`}
      notice={<LegalReviewNotice locale={lang} className={l.notice} />}
      intro={<p>{document.lead[lang]}</p>}
      parts={document.sections.map((section) => ({
        id: section.id,
        heading: section.heading[lang],
        body: section.blocks.map((block, index) => {
          if ("p" in block) return <p key={index}>{block.p[lang]}</p>;
          if ("list" in block) return <ul key={index}>{block.list[lang].map((item) => <li key={item}>{item}</li>)}</ul>;
          const table = block.table;
          return (
            <div key={index} className={l.tableWrap} role="region" aria-label={table.caption[lang]} tabIndex={0}>
              <table>
                <caption className={l.srOnly}>{table.caption[lang]}</caption>
                <thead>
                  <tr>{table.head[lang].map((cell) => <th key={cell} scope="col">{cell}</th>)}</tr>
                </thead>
                <tbody>
                  {table.rows[lang].map((row) => <tr key={row.join("|")}>{row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`}>{cell}</td>)}</tr>)}
                </tbody>
              </table>
            </div>
          );
        }),
      }))}
      doors={doors}
    />
  );
}
