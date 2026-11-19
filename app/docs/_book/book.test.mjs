// Run from repo root: node --test app/docs/_book/book.test.mjs
//
// The documentation of the terminal: both languages the same shape, every frame on disk, every link a page
// that answers, every old address still landing somewhere, and none of the words Ryntra does not say.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { inDevelopmentRepository } from "../../../lib/development-repository.mjs";
import { AHEAD, GROUP_IDS, OLD_SECTIONS, SECTION_IDS, SECTIONS, SHOT_IDS, UI, docHref, isSectionId, neighbours, shotSrc } from "./book.ts";

const ROOT = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const exists = (path) => existsSync(new URL(path, ROOT));

/** Every sentence the pages print, in one language. */
function printed(lang) {
  const out = [];
  for (const section of SECTIONS) {
    const w = section[lang];
    out.push(w.title, w.line, w.open, ...w.does.flatMap((d) => [d.title, d.line]), ...w.more.flatMap((m) => [m.title, ...m.text]), ...(w.coming ?? []));
    for (const part of section.parts ?? []) out.push(part[lang].title, part[lang].line, ...(part[lang].more ?? []));
  }
  for (const item of AHEAD[lang]) out.push(item.title, item.line);
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
    en.more.forEach((m, i) => assert.equal(m.text.length, uk.more[i].text.length, `${section.id}: «${m.title}» differs`));
    for (const part of section.parts ?? []) assert.equal(part.en.more?.length ?? 0, part.uk.more?.length ?? 0, `${section.id}/${part.key}`);
  }
  assert.equal(AHEAD.en.length, AHEAD.uk.length);
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
    }
  }
});

test("every frame is a frame of the live site on disk, and every frame on disk is used", () => {
  const used = new Set();
  for (const section of SECTIONS) {
    if (section.shot) used.add(section.shot);
    for (const part of section.parts ?? []) if (part.shot) used.add(part.shot);
  }
  used.add("market").add("pro"); // the hub's hero and the Meteora card
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
  const answers = (href) => {
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
  const allowed = new Set(["SOL", "JUP", "MET", "USDC", "AI", "DLMM", "DAMM", "DEX", "QR", "UA", "EN", "IPO"]);
  for (const lang of ["en", "uk"]) {
    for (const text of printed(lang)) {
      for (const [word] of text.matchAll(/\b[A-Z]{2,6}\b/g)) assert.ok(allowed.has(word), `«${word}» in «${text}»`);
    }
  }
});

test("a figure only where the site shows it", () => {
  for (const lang of ["en", "uk"]) {
    for (const text of printed(lang)) {
      for (const [figure] of text.matchAll(/\d[\d.,\s]*\s?%/g)) assert.match(figure.replace(/\s/g, ""), /^(25|50|75)%$/, `«${text}»: a share the site does not show`);
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
