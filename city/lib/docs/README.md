# The documentation (CITY-180)

`ryntra.io/docs` — one documentation in one frame: the same menu at the left of every page, the text in the middle, the page's contents at the right. Each section stands at its own address, `/docs/start` … `/docs/help`, and Developers, AI chats, Help, About and the legal documents stand in the same frame at theirs. `/partners` stays its own selling page; the menu links to it.
English and Ukrainian, server-painted English, the person's language at once (the city's language switch and `?lang=`).

| Where | What |
| --- | --- |
| `model.ts` | A section's shape (parts, blocks), the text marks (`**bold**`, `[[where\|words]]`), the search over headings |
| `sections.ts` | The table of contents: names, lines, groups, the frame at each head. Small: the city's «Docs» window reads it (`nav.ts`) |
| `content/en.ts`, `content/uk.ts` | The words, from the product's one description. Same parts, anchors and blocks in both; the test holds them equal |
| `facts.ts` | Every figure, read from the module the product charges, splits or limits by |
| `status.ts`, `doors.ts` | What is open: this build's own switches, held to the roadmap's table by its test |
| `old-chapters.ts` | Every address of the old handbook and the section it leads to (`next.config.ts`) |
| `screens.mjs` | Films the real screens of `public/city/docs/` from the live site, with no wallet connected |
| `shots.mjs` | Every page whole on a desk and a phone, for review; says what is wider than its screen |

## Rules the test keeps

- **No figure is typed.** A percent or a dollar amount in `content/` is refused: it comes from `facts.ts` through `say`.
- **Shut is «Soon».** A section or a sub-heading takes `soon` from the status, and the page says so beside it. Opening a door in a
  release opens it here with no change. Launching from the city follows `doors.launch`.
- **Every section** says what it is, how to do it, what it costs and what can go wrong. A new section: an id in `DOC_IDS`, its name in
  `sections.ts`, its words in both files, its address in `site-map.ts` and in `old-chapters.ts`'s `SECTIONS`.
- **Words for people.** No routes, ids, task names or technical words; checks and receipts never head a section; no profit is promised;
  nothing of other products.

## Not here

The old handbook's files under `app/docs/**` are unreachable: `next.config.ts` leads their addresses away before routing. Removing them
is its own task, since several old tests still read their data.
