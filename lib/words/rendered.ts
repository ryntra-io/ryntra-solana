/**
 * What a page actually draws (audit card UX-953, task SOL-C17).
 *
 * The old guard — `scripts/public-claims-scan.mjs` — read the source of nine
 * directories line by line. It is a leak gate and stays one, but as a guard
 * over the words a person reads it was looking in the wrong place twice over:
 *
 *   - it read what nobody is shown. A comment, an identifier, a key in a
 *     dictionary — `poolTitle`, `signals`, `profitIfRight` — are code. The scan
 *     masked comments and still reported lines nobody can see.
 *   - it never read what everybody is shown. `app/app`, `app/(home)` and
 *     `lib/**` were not in its list at all, so «Заробляй у пулі», «Згенеровані
 *     сигнали» and «Заробляй із кваліфікованої активності…» were live on
 *     ryntra.io while the gate reported clean. Three waves of the package
 *     passed over them.
 *
 * So this reads the page. `collectRenderedText` runs inside the browser, after
 * the client has composed the screen, and returns the text in the order a
 * person meets it: the tab's title, then every text node of the body, then the
 * names a screen reader speaks — `aria-label`, `alt`, `title`, `placeholder`.
 *
 * What it leaves out is exactly what is not drawn: HTML comments, `<script>`,
 * `<style>`, `<template>`, `<noscript>` and the head. What it keeps in is
 * everything a click can reveal — the contents of a closed `<details>`, a
 * collapsed panel, a tab not in front. The audit's own card UX-954 settles
 * that: a name three disclosures deep was already in the page's HTML, and the
 * search engines and the screen readers had it. A word a person can reach in
 * one click is a word the product said.
 *
 * Nothing here signs, sends or writes anything.
 */

/** One line of what the page shows, with where it came from. */
export type RenderedLine = Readonly<{
  /** `title` (the tab), `text` (a text node), or the attribute's name. */
  source: string;
  /** The tag the text sits in, for the report. */
  tag: string;
  text: string;
}>;

/**
 * Collect the page's drawn text. Runs in the page (`page.evaluate`), so it
 * closes over nothing and uses no import: everything it needs is on `document`.
 */
export function collectRenderedText(): RenderedLine[] {
  const out: RenderedLine[] = [];
  const skip = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "HEAD", "META", "LINK"]);
  const push = (source: string, tag: string, value: string | null) => {
    const text = (value ?? "").replace(/\s+/g, " ").trim();
    if (text) out.push({ source, tag, text });
  };

  push("title", "title", document.title);

  const body = document.body;
  if (!body) return out;

  /* Text nodes rather than `innerText`: `innerText` drops what a closed
     disclosure holds, and that is the half of the page the audit found the
     offensive pool name in. A `TreeWalker` with the skip list reads the words
     and never the code. */
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (skip.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return (node.nodeValue ?? "").trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    push("text", node.parentElement?.tagName.toLowerCase() ?? "", node.nodeValue);
  }

  /* The names a screen reader speaks are drawn too — the audit measured a
     forbidden word that lived only in an `aria-label` (UX-953) and a label in
     the wrong language that only a reader met (UX-960). */
  for (const element of Array.from(body.querySelectorAll<HTMLElement>("[aria-label],[alt],[title],[placeholder],[aria-placeholder],[aria-description]"))) {
    if (skip.has(element.tagName)) continue;
    const tag = element.tagName.toLowerCase();
    for (const name of ["aria-label", "alt", "title", "placeholder", "aria-placeholder", "aria-description"]) {
      if (element.hasAttribute(name)) push(name, tag, element.getAttribute(name));
    }
  }
  return out;
}

