import type { Lang } from '../i18n/langs.ts';

/**
 * The documentation's shape (CITY-180): a section is a title, a lead and its parts; a part is blocks a person reads. Pure
 * data, no React: the server builds it, the page draws it and the tests read it in Node.
 *
 * Text is plain with two marks and nothing else: `**bold**`, and `[[where|words]]` for a link — `where` is another section
 * (`[[fees|All fees]]`, `[[fees#swap|…]]`) or an address of the site (`[[/partners|…]]`). `parseInline` reads them once, so
 * the test can hold every link to a place that answers.
 */

export const DOC_IDS = ['start', 'city', 'trade', 'orders', 'launch', 'earn', 'agent', 'money', 'partners', 'security', 'fees', 'guard', 'help'] as const;
export type DocId = (typeof DOC_IDS)[number];

export function isDocId(value: unknown): value is DocId {
  return typeof value === 'string' && (DOC_IDS as readonly string[]).includes(value);
}

export function docPath(id: DocId): string {
  return `/docs/${id}`;
}

export type Row = Readonly<{ label: string; value: string; note?: string }>;
export type Card = Readonly<{ title: string; text: string }>;
export type Qa = Readonly<{ q: string; a: string }>;

export type Block =
  | Readonly<{ kind: 'p'; text: string }>
  | Readonly<{ kind: 'steps'; items: readonly string[] }>
  | Readonly<{ kind: 'list'; items: readonly string[] }>
  | Readonly<{ kind: 'rows'; rows: readonly Row[] }>
  | Readonly<{ kind: 'cards'; items: readonly Card[] }>
  | Readonly<{ kind: 'qa'; items: readonly Qa[] }>
  | Readonly<{ kind: 'figure'; shot: ShotId; alt: string; caption: string }>
  /** A heading inside a part with its own blocks; `soon` when what it describes is not open in this build. */
  | Readonly<{ kind: 'sub'; id: string; title: string; soon: boolean; blocks: readonly Block[] }>;

/** The real screens of the city the sections show (`public/city/docs/`), filmed from the live site by `screens.mjs`. */
export const SHOT_IDS = ['city', 'tower', 'limit', 'earn', 'money', 'guard', 'ask'] as const;
export type ShotId = (typeof SHOT_IDS)[number];

export type Part = Readonly<{ id: string; title: string; blocks: readonly Block[] }>;

export type DocAction = Readonly<{ label: string; href: string }>;

export type DocSection = Readonly<{
  id: DocId;
  title: string;
  /** One or two sentences under the title: what the reader gets here. */
  lead: string;
  /** The search engines' description and the card's words. */
  summary: string;
  /** Not open in this build: the section's main thing stands as «Soon». */
  soon: boolean;
  parts: readonly Part[];
  /** Sections this one leans on, in the order a reader wants them. */
  related: readonly DocId[];
  action: DocAction;
}>;

/** A piece of a line of text, as the page draws it. */
export type Inline = Readonly<{ kind: 'text'; text: string }> | Readonly<{ kind: 'bold'; text: string }> | Readonly<{ kind: 'link'; text: string; where: string }>;

const MARK = /\*\*(.+?)\*\*|\[\[([^|\]]+)\|([^\]]+)\]\]/g;

export function parseInline(text: string): readonly Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const match of text.matchAll(MARK)) {
    if (match.index > at) out.push({ kind: 'text', text: text.slice(at, match.index) });
    if (match[1] !== undefined) out.push({ kind: 'bold', text: match[1] });
    else out.push({ kind: 'link', where: match[2]!, text: match[3]! });
    at = match.index + match[0].length;
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) });
  return out;
}

/** Where a link's `where` leads: a section with its anchor, or an address of the site as it is. */
export function hrefOf(where: string): string {
  return where.startsWith('/') ? where : `/docs/${where}`;
}

/** A line as a person reads it, without its marks. */
export function plainOf(text: string): string {
  return parseInline(text)
    .map((piece) => piece.text)
    .join('');
}

function blockText(block: Block): string[] {
  switch (block.kind) {
    case 'p':
      return [plainOf(block.text)];
    case 'steps':
    case 'list':
      return block.items.map(plainOf);
    case 'rows':
      return block.rows.flatMap((row) => [row.label, row.value, ...(row.note ? [row.note] : [])]).map(plainOf);
    case 'cards':
      return block.items.flatMap((card) => [card.title, plainOf(card.text)]);
    case 'qa':
      return block.items.flatMap((item) => [item.q, plainOf(item.a)]);
    case 'figure':
      return [block.alt, block.caption];
    case 'sub':
      return [block.title, ...block.blocks.flatMap(blockText)];
  }
}

/** Every word a section prints, for the tests. */
export function sectionText(section: DocSection): string {
  return [section.title, section.lead, section.summary, section.action.label, ...section.parts.flatMap((part) => [part.title, ...part.blocks.flatMap(blockText)])].join('\n');
}

function blockRawText(block: Block): string[] {
  switch (block.kind) {
    case 'p':
      return [block.text];
    case 'steps':
    case 'list':
      return [...block.items];
    case 'rows':
      return block.rows.flatMap((row) => [row.value, ...(row.note ? [row.note] : [])]);
    case 'cards':
      return block.items.map((card) => card.text);
    case 'qa':
      return block.items.map((item) => item.a);
    case 'figure':
      return [];
    case 'sub':
      return block.blocks.flatMap(blockRawText);
  }
}

/** Every link a section holds. */
export function sectionLinks(section: DocSection): readonly string[] {
  return section.parts.flatMap((part) => part.blocks.flatMap(blockRawText)).flatMap((text) => parseInline(text).flatMap((piece) => (piece.kind === 'link' ? [piece.where] : [])));
}

export type Heading = Readonly<{ href: string; sectionTitle: string; title: string; anchor: string | null }>;

/** The headings a reader can search: the section itself, its parts, what stands under them, and each question. */
export function sectionHeadings(section: DocSection): readonly Heading[] {
  const of = (title: string, anchor: string | null): Heading => ({ href: docPath(section.id), sectionTitle: section.title, title, anchor });
  const deep = (block: Block): Heading[] => {
    if (block.kind === 'sub') return [of(block.title, block.id), ...block.blocks.flatMap(deep)];
    if (block.kind === 'qa') return block.items.map((item) => of(item.q, null));
    if (block.kind === 'cards') return block.items.map((item) => of(item.title, null));
    return [];
  };
  return [of(section.title, null), ...section.parts.flatMap((part) => [of(part.title, part.id), ...part.blocks.flatMap(deep)])];
}

/** The search's reading of a word: lower case, no accents, and the two Ukrainian letters a hurried hand swaps. */
export function folded(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ʼ’'`]/g, '')
    .replace(/ґ/g, 'г');
}

/** The headings a query finds, the sections' own names first, at most `limit`. */
export function searchHeadings(index: readonly Heading[], query: string, limit = 12): readonly Heading[] {
  const words = folded(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const hits = index.filter((heading) => {
    const text = folded(`${heading.title} ${heading.sectionTitle}`);
    return words.every((word) => text.includes(word));
  });
  const rank = (heading: Heading) => (heading.anchor === null && heading.title === heading.sectionTitle ? 0 : folded(heading.title).includes(words[0]!) ? 1 : 2);
  return [...hits].sort((a, b) => rank(a) - rank(b)).slice(0, limit);
}

export type Localized<T> = Readonly<Record<Lang, T>>;
