/**
 * The published legal documents as data: the words of `/legal/terms` and `/legal/privacy` exactly as they were
 * published (effective 7 October 2026), so any page — the city's document page at the address, the same document in a
 * window of the city — draws them without owning a word of them. Their wording is legal content and moves only through
 * its own reviewed task; a new look never touches it.
 *
 * No React here: the documents are runs of text, so the tests read them in Node and a page draws them as it likes.
 */

/** The two languages a part of a document can be written in. */
export type LegalLang = "en" | "uk";

/** A run of a sentence: plain words, words in bold, or a link (an address of the site, a page's own anchor, an email). */
export type LegalRun = string | Readonly<{ strong: string }> | Readonly<{ link: string; href: string }>;

/** One sentence or paragraph, as its runs. */
export type LegalLine = readonly LegalRun[];

/** A paragraph, or a list of items. */
export type LegalBlock = Readonly<{ kind: "p"; line: LegalLine }> | Readonly<{ kind: "list"; items: readonly LegalLine[] }>;

/** One numbered section: its anchor, its heading and the language it is written in. */
export type LegalSection = Readonly<{
  id: string;
  heading: string;
  lang: LegalLang;
  blocks: readonly LegalBlock[];
}>;

export type LegalDocumentId = "terms" | "privacy";

export type LegalDocument = Readonly<{
  id: LegalDocumentId;
  /** The address the document is published at. */
  path: string;
  title: string;
  /** «Effective date: …», as published. */
  effective: string;
  /** What stands before the first section (in the reader's language where a part is written in theirs). */
  intro: readonly (LegalBlock & Readonly<{ lang?: LegalLang }>)[];
  sections: readonly LegalSection[];
}>;

export const p = (...line: LegalRun[]): LegalBlock => ({ kind: "p", line });
export const list = (...items: LegalLine[]): LegalBlock => ({ kind: "list", items });
export const strong = (text: string): LegalRun => ({ strong: text });
export const link = (text: string, href: string): LegalRun => ({ link: text, href });

/** The plain words of a line, as a reader sees them. */
export function lineText(line: LegalLine): string {
  return line.map((run) => (typeof run === "string" ? run : "strong" in run ? run.strong : run.link)).join("");
}

/** Every line of a document, in reading order: the title, the date, the intro, each heading and its blocks. */
export function documentLines(doc: LegalDocument): string[] {
  const lines: string[] = [doc.title, doc.effective];
  const block = (b: LegalBlock) => (b.kind === "p" ? lines.push(lineText(b.line)) : b.items.forEach((item) => lines.push(lineText(item))));
  doc.intro.forEach(block);
  for (const section of doc.sections) {
    lines.push(section.heading);
    section.blocks.forEach(block);
  }
  return lines;
}
