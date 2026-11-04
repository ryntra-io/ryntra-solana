import type { DocsFacts, Say } from '../facts.ts';
import type { Block, DocAction, DocId, Part, Row } from '../model.ts';
import type { DocsStatus } from '../status.ts';

/**
 * What a section's words are written with (CITY-180). A section is a function of the facts, the build's status and the
 * language's way of writing a figure; it types no percent and no dollar figure of its own (`docs.test.mjs`).
 */
export type Ctx = Readonly<{ f: DocsFacts; s: DocsStatus; say: Say }>;

export type SectionWords = Readonly<{
  lead: string;
  parts: readonly Part[];
  related: readonly DocId[];
  action: DocAction;
}>;

export type Sections = Readonly<Record<DocId, (ctx: Ctx) => SectionWords>>;

export const p = (text: string): Block => ({ kind: 'p', text });
export const steps = (...items: string[]): Block => ({ kind: 'steps', items });
export const list = (...items: string[]): Block => ({ kind: 'list', items });
export const rows = (...items: Row[]): Block => ({ kind: 'rows', rows: items });
export const row = (label: string, value: string, note?: string): Row => (note ? { label, value, note } : { label, value });
export const cards = (...items: (readonly [string, string])[]): Block => ({ kind: 'cards', items: items.map(([title, text]) => ({ title, text })) });
export const qa = (...items: (readonly [string, string])[]): Block => ({ kind: 'qa', items: items.map(([q, a]) => ({ q, a })) });
export const sub = (id: string, title: string, soon: boolean, ...blocks: Block[]): Block => ({ kind: 'sub', id, title, soon, blocks });
export const part = (id: string, title: string, ...blocks: Block[]): Part => ({ id, title, blocks });
