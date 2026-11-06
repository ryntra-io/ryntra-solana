import type { Lang } from '../i18n/langs.ts';

/**
 * «Learn» (CITY-202): the guide «Ryntra from A to Z» as the city's window reads it. The chapters are written once, as
 * Markdown in `docs/learn/{en,uk}/`; `scripts/learn/build.mjs` turns them into `guide.generated.ts` — plain data, so the
 * window draws every word with its own components and nothing arrives as HTML.
 */

/** A piece of a line: plain text, bold, italic, or code (a file or a function). */
export type Run = Readonly<{ t: 's' | 'b' | 'i' | 'c'; v: string }>;
export type Line = readonly Run[];

/** A paragraph, or a list (numbered or not); a paragraph is one item. */
export type Block = Readonly<{ k: 'p' | 'ul' | 'ol'; items: readonly Line[] }>;

export type Chapter = Readonly<{
  n: number;
  slug: string;
  title: string;
  short: string;
  /** One plain comparison a twelve-year-old knows. */
  analogy: string;
  /** The chapter in one row: «Sentence → Plan → Paper → Signature → Report». */
  flow: readonly string[];
  minutes: number;
  /** Real frames of the live city in this language, desk and phone. */
  desk: string | null;
  phone: string | null;
  steps: readonly Line[];
  /** «How it works inside»: the numbers, then the files and functions that do it. */
  inside: readonly Readonly<{ heading: string; blocks: readonly Block[] }>[];
  honest: readonly Block[];
}>;

export type Guide = Readonly<Record<Lang, readonly Chapter[]>>;
