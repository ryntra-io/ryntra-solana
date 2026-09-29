/**
 * Text as data for the public pages: a paragraph, a list, a sentence that must
 * not be missed, a line set apart as what has not been done, a command, or the
 * way to the page that says the rest. A page's copy module is written in these
 * shapes so a test can read every sentence without rendering the page.
 */
export type Prose =
  | string
  | Readonly<{ list: readonly string[] }>
  | Readonly<{ strong: string }>
  | Readonly<{ gap: string }>
  | Readonly<{ code: string }>
  | Readonly<{ href: string; label: string }>;

/** Every sentence of a body, flattened — for the tests that read what a page says. */
export function proseText(blocks: readonly Prose[]): string {
  return blocks
    .map((block) => {
      if (typeof block === "string") return block;
      if ("list" in block) return block.list.join(" ");
      if ("strong" in block) return block.strong;
      if ("gap" in block) return block.gap;
      if ("code" in block) return block.code;
      return block.label;
    })
    .join(" ");
}
