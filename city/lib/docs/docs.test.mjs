import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { FEE_POLICY_V2 } from "../../../lib/core/fee-policy.ts";
import { presetTerms } from "../../../lib/core/launch/preset-terms.ts";
import { RULE_MINIMUM_USD } from "../../../lib/autoinvest/limits.ts";
import { TRIGGER_V1_MIN_ORDER_USD } from "../../../lib/solana/limits/model.ts";
import { RYNTRA_SERVICE_FEE_POLICY } from "../../../lib/swap/service-fee.ts";
import { CITY_PAGES } from "../open/site-map.ts";
import { CITY_DEFAULT_PRESET, cityLaunchOpen } from "../launch/gate.ts";
import { PARTNER_TERMS, termsRows } from "../partners/terms.ts";
import { buildSection, docsFrame } from "./book.ts";
import { docsFacts, sayIn } from "./facts.ts";
import { DOC_IDS, SHOT_IDS, docPath, hrefOf, isDocId, parseInline, plainOf, searchHeadings, sectionHeadings, sectionLinks, sectionText } from "./model.ts";
import { navOf } from "./nav.ts";
import { OLD_CHAPTERS, oldChapterRedirects, shadowedByChapters, throughChapters } from "./old-chapters.ts";
import { DOC_GROUP, DOC_GROUPS, DOC_NAMES, GROUP_WORDS, NAV_LAYOUT, PAGE_NAMES, docArt, neighbours } from "./sections.ts";
import { CITY_DOORS, budgetOpen } from "./doors.ts";
import { docsStatus, sectionSoon } from "./status.ts";

/* CITY-180: the documentation at `ryntra.io/docs`. Every section stands in both languages with the same shape; every figure is the
   product's own; what this build keeps shut stands as «Soon» and opens by itself; the old handbook is out of sight. */

const REPO = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, REPO), "utf8");
const exists = (path) => existsSync(new URL(path, REPO));
const LANGS = ["en", "uk"];

const SHUT = { trade: false, spot: false, stops: false, earn: false, earnWindow: false, guard: false, money: false, bots: false, launch: false };
const OPEN = Object.fromEntries(Object.keys(SHUT).map((door) => [door, true]));
const NONE = { oneSentence: false, budget: false, poolLimits: false };
const ALL = { oneSentence: true, budget: true, poolLimits: true };
const facts = docsFacts();
const everyStatus = [docsStatus(SHUT, NONE), docsStatus(OPEN, ALL)];
const each = (fn) => {
  for (const status of everyStatus) for (const lang of LANGS) for (const id of DOC_IDS) fn(buildSection(id, lang, facts, status), lang, status);
};

test("thirteen sections, each with its address, its group, its name in both languages and a frame of our own city", () => {
  assert.equal(DOC_IDS.length, 13);
  for (const id of DOC_IDS) {
    assert.ok(isDocId(id));
    assert.equal(docPath(id), `/docs/${id}`);
    assert.ok(DOC_GROUPS.includes(DOC_GROUP[id]), id);
    for (const lang of LANGS) {
      assert.ok(DOC_NAMES[lang][id].title && DOC_NAMES[lang][id].line, `${id} ${lang}`);
      assert.ok(DOC_NAMES[lang][id].line.length <= 160, `${id} ${lang}: the line is a search engine's description`);
    }
    for (const file of docArt(id).files) assert.ok(exists(`public${file.src}`), file.src);
  }
  assert.deepEqual(DOC_GROUPS.flatMap((group) => NAV_LAYOUT[group].filter((ref) => typeof ref === "string")), [...DOC_IDS], "the menu lists every section in reading order");
  assert.deepEqual(neighbours("start"), { previous: null, next: "city" });
  assert.deepEqual(neighbours("help"), { previous: "guard", next: null });
});

test("each section says what it is, how to do it, what it costs and what can go wrong", () => {
  each((section) => {
    const parts = section.parts.map((part) => part.id);
    // «All fees» says what it costs part by part.
    for (const need of ["what", "how", section.id === "fees" ? "trades" : "cost", "wrong"]) assert.ok(parts.includes(need), `${section.id}: no «${need}»`);
    assert.equal(new Set(parts).size, parts.length, `${section.id}: one anchor a part`);
    assert.ok(section.lead.length > 40, `${section.id}: a lead`);
    assert.ok(section.related.length >= 2 && section.related.every(isDocId) && !section.related.includes(section.id), `${section.id}: related sections`);
    const how = section.parts.find((part) => part.id === "how");
    const hasSteps = JSON.stringify(how).includes('"steps"');
    assert.ok(hasSteps, `${section.id}: how to do it is steps`);
  });
});

test("English and Ukrainian are the same document: the same parts, headings, anchors, blocks and counts", () => {
  const shape = (blocks) =>
    blocks.map((block) => {
      if (block.kind === "sub") return ["sub", block.id, block.soon, shape(block.blocks)];
      if (block.kind === "rows") return ["rows", block.rows.length];
      if (block.kind === "steps" || block.kind === "list" || block.kind === "cards" || block.kind === "qa") return [block.kind, block.items.length];
      if (block.kind === "figure") return ["figure", block.shot];
      return [block.kind];
    });
  for (const status of everyStatus) {
    for (const id of DOC_IDS) {
      const en = buildSection(id, "en", facts, status);
      const uk = buildSection(id, "uk", facts, status);
      assert.deepEqual(en.parts.map((part) => [part.id, shape(part.blocks)]), uk.parts.map((part) => [part.id, shape(part.blocks)]), id);
      assert.deepEqual(en.related, uk.related, id);
      assert.equal(en.action.href, uk.action.href, id);
    }
  }
});

test("the sections type no figure: a percent or a dollar amount comes from the product's own modules", () => {
  const dir = new URL("city/lib/docs/content/", REPO);
  for (const name of readdirSync(dir)) {
    const source = readFileSync(new URL(name, dir), "utf8").replace(/\$\{[^}]*\}/g, "");
    assert.doesNotMatch(source, /\d\s?%/, `${name} types a percent`);
    assert.doesNotMatch(source, /\$\s?\d/, `${name} types a dollar amount`);
    assert.doesNotMatch(source, /\d\s*(відсот|percent of|bps)/i.test("") ? /$^/ : /\bbps\b/, `${name} says bps`);
  }
  assert.doesNotMatch(read("city/lib/docs/sections.ts"), /\d\s?%|\$\s?\d/, "nor do the section names");
});

test("the fees page prints the fee table the product charges by", () => {
  for (const lang of LANGS) {
    const say = sayIn(lang);
    const text = sectionText(buildSection("fees", lang, facts, everyStatus[1]));
    for (const flow of ["MEME", "TRENDING", "MAJOR", "STABLE", "XSTOCK", "ONDO", "AS_NOW"]) assert.ok(text.includes(say.pct(FEE_POLICY_V2[flow].bps)), `${flow} ${lang}`);
    assert.ok(text.includes(say.pct(RYNTRA_SERVICE_FEE_POLICY.RELAY_APP_FEE)), `bridge ${lang}`);
  }
  assert.deepEqual(facts.fees, { meme: FEE_POLICY_V2.MEME.bps, trending: FEE_POLICY_V2.TRENDING.bps, major: FEE_POLICY_V2.MAJOR.bps, stable: FEE_POLICY_V2.STABLE.bps, stock: FEE_POLICY_V2.XSTOCK.bps, otherStock: FEE_POLICY_V2.ONDO.bps, unread: FEE_POLICY_V2.AS_NOW.bps });
});

test("a fee that changes in its table reads differently on the page", () => {
  const changed = { ...facts, fees: { ...facts.fees, meme: 137 }, bridgeBps: 41 };
  for (const lang of LANGS) {
    const say = sayIn(lang);
    const text = sectionText(buildSection("fees", lang, changed, everyStatus[1]));
    assert.ok(text.includes(say.pct(137)), "the new fee");
    assert.ok(text.includes(say.pct(41)), "the new bridge fee");
  }
});

test("the launch's figures are the terms of the preset the city launches on", () => {
  const terms = presetTerms(CITY_DEFAULT_PRESET);
  assert.equal(facts.launch.feeBps, terms.curve.baseFeeBps);
  assert.equal(facts.launch.graduationCapUsd, terms.curve.graduationMarketCapUsd);
  assert.deepEqual(facts.launch.split, { creator: terms.curve.split.creatorBps, ryntra: terms.curve.split.ryntraBps, meteora: terms.curve.split.meteoraBps });
  assert.equal(facts.launch.graduationCreatorBps, terms.graduation.creatorBps);
  assert.equal(facts.launch.supply, terms.token.supply);
  assert.equal(facts.limitMinUsd, TRIGGER_V1_MIN_ORDER_USD);
  assert.equal(facts.recurringMinUsd, RULE_MINIMUM_USD);
  for (const lang of LANGS) {
    const say = sayIn(lang);
    const text = sectionText(buildSection("launch", lang, facts, everyStatus[1]));
    for (const value of [say.pct(terms.curve.baseFeeBps), say.pct(terms.curve.split.creatorBps), say.pct(terms.curve.split.ryntraBps), say.usdShort(terms.curve.graduationMarketCapUsd), say.count(terms.token.supply)]) {
      assert.ok(text.includes(value), `${lang} ${value}`);
    }
  }
});

test("the partner section prints the partner page's own terms, word for word", () => {
  for (const lang of LANGS) {
    const text = sectionText(buildSection("partners", lang, facts, everyStatus[1]));
    const { rows, note } = termsRows(lang, PARTNER_TERMS);
    for (const row of rows) assert.ok(text.includes(row.label) && text.includes(row.value), row.label);
    assert.ok(text.includes(note));
  }
});

test("what is shut stands as «Soon»; a door that opens opens its section, with nothing else to change", () => {
  const shut = docsStatus(SHUT, NONE);
  const open = docsStatus(OPEN, ALL);
  for (const id of ["trade", "orders", "launch", "earn", "guard"]) {
    assert.equal(sectionSoon(id, shut), true, `${id} shut`);
    assert.equal(sectionSoon(id, open), false, `${id} open`);
    assert.equal(buildSection(id, "en", facts, shut).soon, true, id);
    assert.equal(buildSection(id, "uk", facts, open).soon, false, id);
  }
  for (const id of ["start", "city", "agent", "money", "partners", "fees", "security", "help"]) assert.equal(sectionSoon(id, shut), false, `${id} always stands`);

  // Launch alone: its door, and nothing else.
  assert.equal(sectionSoon("launch", docsStatus({ ...SHUT, launch: true }, NONE)), false);
  assert.equal(sectionSoon("launch", docsStatus({ ...OPEN, launch: false }, ALL)), true);

  const sub = (section, id) => section.parts.flatMap((part) => part.blocks).find((block) => block.kind === "sub" && block.id === id);
  assert.equal(sub(buildSection("agent", "en", facts, shut), "budget").soon, true, "the agent's budget");
  assert.equal(sub(buildSection("agent", "en", facts, open), "budget").soon, false);
  assert.equal(sub(buildSection("orders", "en", facts, shut), "limit").soon, true);
  assert.equal(sub(buildSection("orders", "en", facts, open), "limit").soon, false);
  assert.equal(sub(buildSection("money", "en", facts, shut), "send").soon, true);
  assert.equal(sub(buildSection("money", "en", facts, shut), "topup").soon, false, "a top-up from Solana is always there");
  assert.deepEqual(navOf("en", shut).flatMap((g) => g.items).filter((s) => s.soon).map((s) => s.key).sort(), ["earn", "guard", "launch", "orders", "trade"]);
});

test("launching from the city follows its own switch, and the agent's budget opens only past the test network", () => {
  assert.equal(CITY_DOORS.launch, cityLaunchOpen("solana:mainnet"));
  assert.equal(cityLaunchOpen("solana:mainnet", false, true), false, "not without the word");
  assert.equal(cityLaunchOpen("solana:mainnet", true, false), false, "not without the switch");
  assert.equal(budgetOpen(undefined), false);
  assert.equal(budgetOpen("devnet"), false, "a test network is not open to people");
  assert.equal(budgetOpen("mainnet"), true);
  assert.ok(read("city/lib/docs/doors.ts").includes("launch: cityLaunchOpen('solana:mainnet')"));
});

test("every link in a section leads to a section's anchor or a page that answers", () => {
  const anchorsOf = (section) => new Set(sectionHeadings(section).flatMap((heading) => (heading.anchor ? [heading.anchor] : [])));
  each((section, lang, status) => {
    const links = [...sectionLinks(section), section.action.href];
    for (const where of links) {
      const [path, hash] = where.split("#");
      if (path.startsWith("/")) {
        const clean = path.split("?")[0];
        assert.ok(clean === "/" || exists(`app${clean}/page.tsx`) || clean === "/legal/terms", `${section.id}: ${where}`);
        continue;
      }
      assert.ok(isDocId(path), `${section.id}: ${where} is no section`);
      if (hash) assert.ok(anchorsOf(buildSection(path, lang, facts, status)).has(hash), `${section.id}: ${where} has no anchor`);
    }
  });
});

test("a figure is a real screen of the city, in both languages", () => {
  for (const shot of SHOT_IDS) for (const lang of LANGS) assert.ok(exists(`public/city/docs/${shot}-${lang}.webp`), `${shot} ${lang}`);
  const shown = new Set();
  each((section) => {
    for (const part of section.parts) for (const block of part.blocks) if (block.kind === "figure") shown.add(block.shot);
  });
  assert.deepEqual([...shown].sort(), [...SHOT_IDS].sort(), "each screen filmed is shown");
});

test("the words stay for people: no internal word, nothing of other products, and no promise of profit", () => {
  const INTERNAL = /CITY-\d|\bAPI\b|\bengine\b|двигун|\bendpoint\b|\bcron\b|канарк|canary|юрист|lawyer|approval layer|Mission Control|\bmainnet\b|\bdevnet\b/i;
  const OTHER = /\bRXN\b|\bArc\b|Starknet|Hyperliquid|Phoenix|perps?\b|futures|ф.ючерс|predictions?\b|прогнози\b/i;
  const PROMISE = /guaranteed (profit|return|income)|risk[- ]free|x1000|гарантован\w+ (прибут|дох)|без ризику/i;
  each((section, lang) => {
    const text = sectionText(section);
    assert.doesNotMatch(text, INTERNAL, `${section.id} ${lang}`);
    assert.doesNotMatch(text, OTHER, `${section.id} ${lang}`);
    assert.doesNotMatch(text, PROMISE, `${section.id} ${lang}`);
    // Checks and receipts never lead (decisions 91, 92).
    for (const heading of [section.title, section.lead, ...section.parts.map((part) => part.title), ...sectionHeadings(section).map((h) => h.title)]) {
      assert.doesNotMatch(heading, /receipt|proof|verdict|квитанц|доказ|вердикт/i, `${section.id}: ${heading}`);
    }
    assert.doesNotMatch(text, /\*\*|\[\[/, `${section.id}: a mark left unread`);
  });
});

test("the text marks read as they should", () => {
  assert.deepEqual(parseInline("Read **this** and [[fees#trades|the fees]]."), [
    { kind: "text", text: "Read " },
    { kind: "bold", text: "this" },
    { kind: "text", text: " and " },
    { kind: "link", where: "fees#trades", text: "the fees" },
    { kind: "text", text: "." },
  ]);
  assert.equal(plainOf("**a** [[/partners|b]]"), "a b");
  assert.equal(hrefOf("fees#trades"), "/docs/fees#trades");
  assert.equal(hrefOf("/partners"), "/partners");
});

test("the search finds a section by name and a heading inside one, in both languages, and nothing for nothing", () => {
  const frame = docsFrame(facts, everyStatus[0]);
  assert.deepEqual(searchHeadings(frame.index.en, ""), []);
  assert.equal(searchHeadings(frame.index.en, "all fees")[0].href, "/docs/fees");
  assert.equal(searchHeadings(frame.index.uk, "КОМІСІЇ")[0].href, "/docs/fees");
  assert.ok(searchHeadings(frame.index.en, "set a stop").some((hit) => hit.href === "/docs/orders" && hit.anchor === "stop"));
  assert.ok(searchHeadings(frame.index.uk, "поставити стоп").some((hit) => hit.href === "/docs/orders" && hit.anchor === "stop"));
  assert.equal(searchHeadings(frame.index.en, "connect your agent")[0].href, "/developers", "the site's own pages are found too");
  assert.equal(searchHeadings(frame.index.uk, "приватність")[0].href, "/legal/privacy");
  assert.ok(searchHeadings(frame.index.en, "recovery phrase").length > 0);
  assert.deepEqual(searchHeadings(frame.index.en, "zzzz"), []);
  assert.ok(searchHeadings(frame.index.en, "e").length <= 12, "a short list");
});

test("every address of the old handbook leads to a page that answers, in one hop, with its Ukrainian twin", () => {
  const rows = oldChapterRedirects();
  const sources = new Set(rows.map((row) => row.source));
  for (const row of rows) {
    assert.equal(row.permanent, true);
    const target = row.destination.split("?")[0];
    assert.ok(!OLD_CHAPTERS[target], `${row.source} leads to another old chapter`);
    const section = target.match(/^\/docs\/([a-z]+)$/)?.[1];
    assert.ok(target === "/docs" || target === "/docs/:section" || isDocId(section) || exists(`app${target}/page.tsx`), `${row.source} → ${row.destination}`);
  }
  for (const source of Object.keys(OLD_CHAPTERS)) {
    assert.ok(sources.has(`/uk${source}`), `${source} has its Ukrainian address`);
    assert.ok(!isDocId(source.replace("/docs/", "")), `${source} is a section now, not an old chapter`);
  }
  assert.ok(rows.some((row) => row.source === "/uk/docs" && row.destination === "/docs?lang=uk"));
  // The new sections' names, written twice because the build's config reads that file with no imports.
  assert.ok(rows.some((row) => row.source === `/uk/docs/:section(${DOC_IDS.join("|")})`), "the Ukrainian sections match the sections");
});

test("an older row of the config leads straight to the section, never through an old chapter", () => {
  assert.deepEqual(throughChapters({ source: "/x", destination: "/docs/faq", permanent: true }), { source: "/x", destination: "/docs/help", permanent: true });
  assert.equal(throughChapters({ source: "/y", destination: "/docs/developers/agent-control" }).destination, "/developers");
  assert.equal(throughChapters({ source: "/z", destination: "/roadmap" }).destination, "/roadmap");
  assert.equal(shadowedByChapters("/uk/docs/faq"), true);
  assert.equal(shadowedByChapters("/docs"), false);
});

test("no page of the old handbook is left to answer: every old route and chapter has its row", async () => {
  const sources = new Set(oldChapterRedirects().map((row) => row.source));
  const walk = (dir, at = "") =>
    readdirSync(new URL(dir, REPO), { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isDirectory()) return [];
      const path = `${at}/${entry.name}`;
      const here = existsSync(new URL(`${dir}/${entry.name}/page.tsx`, REPO)) ? [path] : [];
      return [...here, ...walk(`${dir}/${entry.name}`, path)];
    });
  for (const route of walk("app/docs").filter((path) => !path.includes("["))) assert.ok(sources.has(`/docs${route}`) || shadowedByChapters(`/docs${route}`), `/docs${route} still answers in the old interface`);
  const { DOC_PAGES } = await import("../../../app/docs/content/index.ts");
  for (const page of DOC_PAGES.filter((p) => p.slug)) assert.ok(sources.has(`/docs/${page.slug}`), `/docs/${page.slug} still answers in the old interface`);
  assert.match(read("next.config.ts"), /\.\.\.OLD_ADDRESS_REDIRECTS,[\s\S]*\.\.\.oldChapterRedirects\(\),/, "the rows lead the config");
});

test("the documentation is made of the city only, and the sitemap names every section", () => {
  const OLD = /@\/app\/site\/|@\/components\/|@ryntra\/core|app\/site\/frozen|PublicHeader|FrozenFooter|InfoPage|@\/app\/app\/|@\/app\/docs\/|\.\/content\/index|docs-page/;
  for (const file of ["app/docs/page.tsx", "app/docs/[...slug]/page.tsx", "city/components/pages/CityDocument.tsx", "city/components/docs/DocsDocument.tsx", "city/components/docs/DocsView.tsx", "city/components/docs/docs.module.css", "city/lib/docs/read.server.ts", "city/lib/docs/book.ts"]) {
    assert.doesNotMatch(read(file), OLD, file);
  }
  assert.doesNotMatch(read("city/components/docs/docs.module.css"), /#ff681c/i);
  for (const id of DOC_IDS) assert.ok(CITY_PAGES.some((page) => page.path === docPath(id)), `${id} is in the sitemap`);
  assert.doesNotMatch(read("city/lib/open/site-map.ts"), /'\/docs\/:path\+'/, "the documentation's pages are the city's now");
});

test("one menu on every page: the sections, the programme, developers, chats, help and the legal documents", () => {
  const nav = navOf("uk", everyStatus[1]);
  assert.deepEqual(nav.map((group) => group.title), ["Початок", "Торгівля", "Запуск монети", "Заробіток", "Агент", "Гроші", "Партнерська програма", "Розробникам", "Безпека й комісії", "Допомога"]);
  const hrefs = nav.flatMap((group) => group.items.map((item) => item.href));
  for (const href of ["/docs/start", "/docs/partners", "/partners", "/developers", "/connector", "/support", "/about", "/legal/terms", "/legal/privacy"]) assert.ok(hrefs.includes(href), href);
  for (const lang of LANGS) {
    for (const group of DOC_GROUPS) {
      assert.ok(GROUP_WORDS[lang][group], group);
      // A group's one row never just repeats the group's name.
      const items = navOf(lang, everyStatus[1]).find((g) => g.id === group).items;
      for (const item of items) assert.notEqual(item.title, GROUP_WORDS[lang][group], `${group} ${lang}`);
    }
    for (const name of Object.values(PAGE_NAMES[lang])) assert.ok(name.title && name.line);
  }
  // The pages stand in the frame at their address; the partner page stays its own selling page and is linked.
  assert.match(read("city/components/pages/DocumentPage.tsx"), /<DocsFrameView /);
  assert.match(read("city/components/pages/CityDocument.tsx"), /readDocsFrame\(\)/);
  assert.doesNotMatch(read("app/partners/page.tsx"), /DocsFrameView/);
  // On a phone, the same menu behind one button.
  const frame = read("city/components/docs/Frame.tsx");
  assert.match(frame, /data-docs-menu/);
  assert.equal((frame.match(/<NavList /g) ?? []).length, 2, "one list, in the side and in the sheet");
});

test("the partner section is the programme in full: how it works, the link, the terms, payouts and the rules", () => {
  for (const lang of LANGS) {
    const section = buildSection("partners", lang, facts, everyStatus[1]);
    assert.deepEqual(section.parts.map((part) => part.id), ["what", "how", "cost", "payouts", "rules", "wrong"]);
    assert.ok(sectionLinks(section).includes("/partners"), "it links to the partner page");
    assert.equal(section.action.href, "/partners");
    const say = sayIn(lang);
    const text = sectionText(section);
    assert.ok(text.includes(say.pct(PARTNER_TERMS.share.firstBps)) && text.includes(say.pct(PARTNER_TERMS.share.afterBps)));
  }
});

test("the city's own window lists the sections and loads none of their words", () => {
  const body = read("city/components/pages/InfoBodies.tsx");
  assert.match(body, /navOf\(lang, CITY_STATUS\)/);
  assert.doesNotMatch(body, /docs\/book|docs\/content/, "only the table of contents reaches the city's bundle");
  for (const file of ["city/lib/docs/nav.ts", "city/lib/docs/sections.ts", "city/lib/docs/status.ts", "city/lib/docs/model.ts"]) assert.doesNotMatch(read(file), /from '.*content\//, file);
});
