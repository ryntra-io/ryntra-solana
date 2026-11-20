"use client";

import type { ReactNode } from "react";

import { useDocsLang } from "../../docs/_book/parts";
import { LegalPage } from "./LegalPage";
import l from "./legal.module.css";
import { LEGAL_WORDS, publishedDoors } from "./words";

/**
 * `/legal/licenses` in the terminal's frame: the notices the charts' open-source libraries ask to be shown
 * (CH-17), word for word as the charts' core gives them, in the reader's language. The page renders both on the server
 * and shows the reader's.
 */
export function LicencesView({ en, uk }: { en: ReactNode; uk: ReactNode }) {
  const lang = useDocsLang();
  const w = LEGAL_WORDS[lang];
  return (
    <LegalPage lang={lang} mark="licenses" here={w.licences} title={w.licences} titleLang={lang} docLang={lang} parts={[]} doors={publishedDoors(w, "licences")}>
      <div className={l.notices}>{lang === "uk" ? uk : en}</div>
    </LegalPage>
  );
}
