// Run from repo root: node --test app/docs/_book/book.test.mjs
//
// The documentation of the terminal: both languages the same shape, every frame on disk, every link a page
// that answers, every old address still landing somewhere, and none of the words Ryntra does not say.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { inDevelopmentRepository } from "../../../lib/development-repository.mjs";
import { AHEAD, CAPTIONS, GROUP_IDS, OLD_SECTIONS, QUICK, SAY_EXAMPLES, SECTION_IDS, SECTIONS, SHOT_IDS, UI, docHref, docsTabTitle, isSectionId, neighbours, quoted, sectionOf, shotSrc } from "./book.ts";

const ROOT = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const exists = (path) => existsSync(new URL(path, ROOT));

/** Every sentence the pages print, in one language. */
function printed(lang) {
  const out = [];
  for (const section of SECTIONS) {
    const w = section[lang];
    out.push(w.title, w.line, w.open, ...w.does.flatMap((d) => [d.title, d.line]), ...w.how, w.honest ?? "", ...(w.words ?? []).flatMap((d) => [d.title, d.line]), ...w.more.flatMap((m) => [m.title, ...m.text]), ...(w.coming ?? []));
    for (const part of section.parts ?? []) out.push(part[lang].title, part[lang].line, ...(part[lang].more ?? []));
  }
  for (const item of [...AHEAD[lang], ...QUICK[lang]]) out.push(item.title, item.line);
  out.push(...Object.values(CAPTIONS[lang]), ...SAY_EXAMPLES[lang]);
  for (const value of Object.values(UI[lang])) if (typeof value === "string") out.push(value);
  return out;
}

test("every section is in the list once, in a known group, in both languages of the same shape", () => {
  assert.deepEqual(SECTIONS.map((s) => s.id), [...SECTION_IDS], "the sections stand in the reading order");
  for (const section of SECTIONS) {
    assert.ok(GROUP_IDS.includes(section.group), `${section.id}: unknown group`);
    const { en, uk } = section;
    assert.equal(en.does.length, uk.does.length, `${section.id}: «what you can do» differs between the languages`);
    assert.equal(en.more.length, uk.more.length, `${section.id}: the disclosures differ`);
    assert.equal(en.coming?.length ?? 0, uk.coming?.length ?? 0, `${section.id}: «coming» differs`);
    assert.equal(en.how.length, uk.how.length, `${section.id}: the steps differ`);
    assert.equal(en.words?.length ?? 0, uk.words?.length ?? 0, `${section.id}: the words differ`);
    assert.equal(Boolean(en.honest), Boolean(uk.honest), `${section.id}: the honest line differs`);
    en.more.forEach((m, i) => assert.equal(m.text.length, uk.more[i].text.length, `${section.id}: «${m.title}» differs`));
    for (const part of section.parts ?? []) assert.equal(part.en.more?.length ?? 0, part.uk.more?.length ?? 0, `${section.id}/${part.key}`);
  }
  assert.equal(AHEAD.en.length, AHEAD.uk.length);
  assert.equal(QUICK.en.length, QUICK.uk.length);
  assert.equal(SAY_EXAMPLES.en.length, SAY_EXAMPLES.uk.length);
  for (const shot of SHOT_IDS) for (const lang of ["en", "uk"]) assert.ok(CAPTIONS[lang][shot], `${shot} ${lang}: a frame with no caption`);
  assert.deepEqual(Object.keys(UI.uk).sort(), Object.keys(UI.en).sort());
});

test("short: a title, a line, one sentence or two — the rest behind a disclosure", () => {
  for (const lang of ["en", "uk"]) {
    for (const section of SECTIONS) {
      const w = section[lang];
      assert.ok(w.title.length <= 24, `${section.id} ${lang}: title «${w.title}»`);
      assert.ok(w.line.length <= 130, `${section.id} ${lang}: line of ${w.line.length}`);
      assert.ok(w.does.length <= 5, `${section.id} ${lang}: more than five things to do`);
      for (const item of w.does) assert.ok(item.line.length <= 110, `${section.id} ${lang}: «${item.line}»`);
      for (const item of w.more) for (const line of item.text) assert.ok(line.length <= 170, `${section.id} ${lang}: «${line}»`);
      // Every section of the terminal says how, in three to five steps; the honest limit is one line.
      if (section.group !== "trust" || section.id === "keys") assert.ok(w.how.length >= 3 && w.how.length <= 5, `${section.id} ${lang}: ${w.how.length} steps`);
      for (const step of w.how) assert.ok(step.length <= 130, `${section.id} ${lang}: step «${step}»`);
      if (w.honest) assert.ok(w.honest.length <= 140 && !/[.!?]\s+\S[^.]*[.!?]\s+\S/.test(w.honest), `${section.id} ${lang}: honest «${w.honest}»`);
      for (const word of w.words ?? []) assert.ok(word.line.length <= 130, `${section.id} ${lang}: word «${word.title}»`);
    }
  }
});

test("every frame is a frame of the live site on disk, and every frame on disk is used", () => {
  const used = new Set();
  for (const section of SECTIONS) {
    if (section.shot) used.add(section.shot);
    for (const part of section.parts ?? []) if (part.shot) used.add(part.shot);
  }
  used.add("pro"); // the Meteora card on the hub
  for (const shot of used) assert.ok(SHOT_IDS.includes(shot), `${shot} is not a known frame`);
  for (const shot of SHOT_IDS) {
    for (const size of ["desk", "phone"]) for (const lang of ["en", "uk"]) assert.ok(exists(`public${shotSrc(shot, size, lang)}`), `${shotSrc(shot, size, lang)} is missing`);
  }
  const unused = SHOT_IDS.filter((shot) => !used.has(shot) && shot !== "bridge");
  assert.deepEqual(unused, [], "a frame nobody shows");
  const files = readdirSync(new URL("public/docs/shots/", ROOT)).filter((name) => name.endsWith(".webp"));
  for (const name of files) assert.match(name, new RegExp(`^(${SHOT_IDS.join("|")})-(desk|phone)-(en|uk)\\.webp$`), `${name} is not a frame of the list`);
  // Cut from the live site, never drawn or generated: the script that cuts them is beside the list.
  assert.match(read("app/docs/_book/shots.mjs"), /https:\/\/ryntra\.io/);
});

test("every link leads to a page that answers", () => {
  const hrefs = new Set(["/roadmap", "/docs/start"]);
  for (const section of SECTIONS) {
    if (section.href) hrefs.add(section.href);
    for (const part of section.parts ?? []) if (part.href) hrefs.add(part.href);
  }
  const answers = (link) => {
    // A tab of a screen (`/?tab=stock`) is that screen.
    const href = link.split("?")[0];
    if (href === "/") return true;
    // A copy of the code without that
    // registry leaves the page out, and the live site still serves it.
    if (href === "/roadmap" && !inDevelopmentRepository) return true;
    const [first, ...rest] = href.slice(1).split("/");
    if (exists(`app/(terminal)/${first}/page.tsx`) && rest.length === 0) return true;
    if (first === "coin") return exists("app/(terminal)/coin/[mint]/page.tsx") && rest.length === 1;
    if (first === "pool") return exists("app/(terminal)/pool/[address]/page.tsx") || exists("app/(terminal)/pool/[pool]/page.tsx");
    if (first === "bots") return rest.length === 1 && (exists(`app/(terminal)/bots/${rest[0]}/page.tsx`) || exists("app/(terminal)/bots/[bot]/page.tsx"));
    if (first === "docs") return rest.length === 1 && isSectionId(rest[0]);
    return exists(`app/${href.slice(1)}/page.tsx`);
  };
  for (const href of hrefs) assert.ok(answers(href), `${href} answers nothing`);
  // The bots this documentation names are bots the terminal has.
  const kinds = read("terminal/bots/kinds.ts");
  for (const href of hrefs) if (href.startsWith("/bots/")) assert.match(kinds, new RegExp(`'${href.split("/")[2]}'`), href);
});

test("every address of the city's documentation still lands on a section", async () => {
  const { DOC_IDS } = await import("../../../city/lib/docs/model.ts");
  for (const id of DOC_IDS) assert.ok(isSectionId(id) || id in OLD_SECTIONS, `/docs/${id} would answer 404`);
  for (const target of Object.values(OLD_SECTIONS)) assert.ok(isSectionId(target));
  const { OLD_CHAPTERS } = await import("../../../city/lib/docs/old-chapters.ts");
  for (const [from, to] of Object.entries(OLD_CHAPTERS)) {
    if (!to.startsWith("/docs/")) continue;
    const id = to.slice("/docs/".length);
    assert.ok(isSectionId(id) || id in OLD_SECTIONS, `${from} → ${to} leads nowhere`);
  }
  const slug = read("app/docs/[...slug]/page.tsx");
  assert.match(slug, /permanentRedirect\(docHref\(OLD_SECTIONS\[id\]!\)\)/, "an old address leads to its section for good");
  assert.match(slug, /\.\.\.SECTION_IDS, \.\.\.Object\.keys\(OLD_SECTIONS\)/, "every address is built with the site");
});

test("the reader walks the sections in order", () => {
  assert.equal(neighbours("start").prev, null);
  assert.equal(neighbours(SECTION_IDS.at(-1)).next, null);
  for (const id of SECTION_IDS) assert.equal(docHref(id), `/docs/${id}`);
});

test("honest words: privately not anonymously, no promise, no other product, no proof as a headline", () => {
  const forbidden = [
    [/anonym|анонім/i, "privately, never anonymously"],
    [/private stock|приватн\S* акці/i, "no private stocks"],
    [/\barc\b|starknet/i, "another product"],
    [/futures|perps?\b|phoenix|predict|ф[’']ючерс|прогноз|\brxn\b/i, "a product of RXN"],
    [/guarantee|гарант|risk-free|без ризику|\b\d+x\b|x\d{2,}|іксів|profit|прибут|passive income|moon/i, "a promise"],
    [/receipt|квитанц|proof|доказ|approval layer|evidence/i, "proof is never the headline"],
    [/\b(api|mcp|sdk|endpoint|json)\b|двигун|ендпоінт/i, "a technical word"],
    [/claude|chatgpt|openai/i, "a vendor"],
    [/\bsoon\b|скоро|незабаром|deadline|дедлайн|\bq[1-4]\b/i, "a time"],
    [/autopilot trades for you|AI trades by itself|AI торгує сам/i, "an AI that trades by itself is not on the site"],
  ];
  for (const lang of ["en", "uk"]) {
    for (const text of printed(lang)) for (const [pattern, why] of forbidden) assert.doesNotMatch(text, pattern, `«${text}»: ${why}`);
  }
});

test("examples name SOL, JUP and MET only", () => {
  const allowed = new Set(["SOL", "JUP", "MET", "USDC", "AI", "DLMM", "DAMM", "DEX", "QR", "UA", "EN", "IPO", "US"]);
  for (const lang of ["en", "uk"]) {
    for (const text of printed(lang)) {
      for (const [word] of text.matchAll(/\b[A-Z]{2,6}\b/g)) assert.ok(allowed.has(word), `«${word}» in «${text}»`);
    }
  }
});

test("a figure only where the site shows it", () => {
  for (const lang of ["en", "uk"]) {
    for (const text of printed(lang)) {
      // The quick amounts of Swap and the Grid's quick bands: the only shares the site prints that the pages repeat.
      for (const [figure] of text.matchAll(/±?\d[\d.,\s]*\s?%/g)) assert.match(figure.replace(/\s/g, ""), /^((25|50|75)|±(5|10|20))%$/, `«${text}»: a share the site does not show`);
      assert.doesNotMatch(text, /\$\s?\d/, `«${text}»: a sum`);
    }
  }
});

test("the pages are the terminal's: its frame, its kit, its tokens", () => {
  assert.match(read("app/docs/layout.tsx"), /<TerminalFrame>/);
  assert.match(read("app/docs/_book/frame.tsx"), /<TerminalShell initial=\{BUNDLED_CITY\}>/);
  assert.match(read("app/docs/page.tsx"), /<DocsHub \/>/);
  for (const file of ["app/docs/_book/DocsHub.tsx", "app/docs/_book/DocsSection.tsx"]) {
    const source = read(file);
    assert.match(source, /from "@\/terminal\/ui"/, `${file} is made of the terminal's kit`);
    assert.doesNotMatch(source, /@\/components\/|@\/app\/site\/|@ryntra\/core|@\/app\/app\//, `${file} takes nothing of the old interface`);
  }
  const css = read("app/docs/_book/book.module.css");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(/i, "a colour written as a number");
  for (const [, corner] of css.matchAll(/border-radius:\s*([^;]+);/g)) assert.match(corner.trim(), /^(0|50%|var\(--r-ctl\))$/, `a corner the terminal does not have: ${corner}`);
});

test("Help and About: the terminal's frame, both languages the same, no word of the city", async () => {
  const { HELP_WORDS } = await import("../../support/_view/HelpView.tsx").catch(() => ({}));
  const sources = { help: read("app/support/_view/HelpView.tsx"), about: read("app/about/_view/AboutView.tsx") };
  for (const page of ["app/support/page.tsx", "app/about/page.tsx"]) {
    const source = read(page);
    assert.match(source, /<TerminalFrame>/, `${page} stands in the terminal's frame`);
    assert.match(source, /export const dynamic = "force-static"/);
  }
  for (const [name, source] of Object.entries(sources)) {
    assert.match(source, /from "@\/terminal\/ui"/, `${name} is made of the terminal's kit`);
    assert.doesNotMatch(source, /@\/components\/|@\/app\/site\/|@ryntra\/core|@\/app\/app\/|CityDocument|city\/components\/pages/, `${name} takes nothing of the old pages`);
    // Every word a person reads: the two word tables.
    const table = /_WORDS = (\{[\s\S]*?\n\}) as const;/.exec(source)?.[1] ?? "";
    assert.ok(table.length > 200, `${name}: its words are one table`);
    assert.doesNotMatch(table, /\bcity\b|tower|місто|міст[аі]\b|веж|квартал|anonym|анонім/i, `${name}: a word of the city`);
    const en = /\n  en: \{([\s\S]*?)\n  \},/.exec(table)?.[1] ?? "";
    const uk = /\n  uk: \{([\s\S]*?)\n  \},/.exec(table)?.[1] ?? "";
    const keys = (block) => [...block.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]).sort();
    assert.deepEqual(keys(uk), keys(en), `${name}: both languages carry the same words`);
  }
  // Help sends on the engine's inbox, by its own rules, with one amber action.
  assert.match(sources.help, /sendHelp\(helpPayload\(/);
  assert.equal((sources.help.match(/<Action\b/g) ?? []).length, 1, "one amber action on Help");
  assert.ok(exists("app/legal/privacy/page.tsx"), "the phone's facts answer");
  void HELP_WORDS;
});

test("the eyes' pass of 20.11 (G13): one axis for the head, links that read as links, each language its own quotes", () => {
  const sources = {
    hub: read("app/docs/_book/DocsHub.tsx"),
    section: read("app/docs/_book/DocsSection.tsx"),
    help: read("app/support/_view/HelpView.tsx"),
    about: read("app/about/_view/AboutView.tsx"),
  };
  // No trail over the head: the docs, Help and About stand their heads where every screen's head stands.
  for (const [name, source] of Object.entries(sources)) assert.doesNotMatch(source, /<DocsBar[^>]*\bhere=/, `${name}: a trail over the head`);
  assert.match(sources.section, /<Link href="\/docs" className=\{b\.tocLink\}>/, "a section keeps its way back to the docs' first page");
  // The hub's first card is words and one action; no whole screen shrunk into half a card.
  const hero = /className=\{b\.hero\}>([\s\S]*?)<\/Panel>/.exec(sources.hub)?.[1] ?? "";
  assert.ok(hero.includes("<OpenLink"), "the hub's first card keeps its one action");
  assert.doesNotMatch(hero, /<Shot\b/, "a frame in the hub's first card");
  // Help: the form and the side start on one line — nothing above the form's panel in the main column.
  assert.match(sources.help, /<div className=\{b\.mainStack\}>\s*<Panel tone="hi"/, "Help: a line above the form pushes it under the side's top");
  // About: no amber action while the reader is already in the terminal, the line said once, no file's name for a word.
  assert.doesNotMatch(sources.about, /<OpenLink|<Action\b|className=\{b\.openPanel\}/, "About: an amber action");
  assert.equal((sources.about.match(/\{w\.line\}/g) ?? []).length, 1, "About: the line twice");
  assert.doesNotMatch(sources.about, /security\.txt/, "About: a file's name in place of a word");
  // Doors read as doors: Help and About list theirs with the arrowed rows, not the docs' quiet list of sections.
  for (const name of ["help", "about"]) {
    assert.match(sources[name], /<LinkList\b/, `${name}: its doors as rows with an arrow`);
    assert.doesNotMatch(sources[name], /b\.tocLink/, `${name}: pale rows with no arrow`);
  }
  // One name for the docs in each language, wherever they are named.
  const aboutDocs = (lang) => new RegExp(`\\n  ${lang}: \\{[\\s\\S]*?\\n    docs: "([^"]+)"`).exec(sources.about)?.[1];
  for (const lang of ["en", "uk"]) assert.equal(aboutDocs(lang), UI[lang].docs, `${lang}: About names the docs «${aboutDocs(lang)}», the docs call themselves «${UI[lang].docs}»`);
  // Quotes: “…” in English, «…» in Ukrainian — in every sentence the pages print and in the hub's chips.
  for (const text of printed("en")) assert.doesNotMatch(text, /[«»]/, `«${text}»: Ukrainian quotes in English`);
  for (const text of printed("uk")) assert.doesNotMatch(text, /[“”]/, `«${text}»: English quotes in Ukrainian`);
  assert.equal(quoted("Buy JUP for 1 SOL", "en"), "“Buy JUP for 1 SOL”");
  assert.equal(quoted("Купи JUP на 1 SOL", "uk"), "«Купи JUP на 1 SOL»");
  assert.match(sources.hub, /\{quoted\(sentence, lang\)\}/, "the hub's sentences are quoted in the reader's language");
});

test("the browser's tab names a page in the reader's language: English from the server, the reader's own once known", () => {
  // The first page and a section, in English as the server names them, and in Ukrainian — never the English twice.
  assert.equal(docsTabTitle(null, "en"), "Ryntra Docs — the AI terminal on Solana");
  assert.equal(docsTabTitle(null, "uk"), "Документація Ryntra — AI-термінал на Solana");
  for (const id of SECTION_IDS) {
    assert.equal(docsTabTitle(id, "en"), `${sectionOf(id).en.title} — Ryntra Docs`, id);
    assert.equal(docsTabTitle(id, "uk"), `${sectionOf(id).uk.title} — Документація Ryntra`, id);
  }
  // The server's English title is the same function's, so the two cannot part.
  assert.match(read("app/docs/page.tsx"), /const TITLE = docsTabTitle\(null, "en"\);/);
  assert.match(read("app/docs/[...slug]/page.tsx"), /const title = docsTabTitle\(id, "en"\);/);
  // Both pages put the reader's name in the tab, in the plain frame too (the terminal's own hook runs in its shell alone).
  assert.match(read("app/docs/_book/DocsHub.tsx"), /useDocsTabTitle\(null, lang\);/);
  assert.match(read("app/docs/_book/DocsSection.tsx"), /useDocsTabTitle\(id, lang\);/);
  const hook = read("app/docs/_book/parts.tsx");
  assert.match(hook, /const want = docsTabTitle\(id, lang\);/);
  assert.match(hook, /new MutationObserver\(put\)/, "the router's English title is put back");
});
