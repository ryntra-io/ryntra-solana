import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { CONTACTS } from "../../../lib/site/contacts.ts";
import { API_BASE, DEV_ROWS } from "./developers.ts";
import { HELP_MAX, HELP_MIN, helpPayload, helpReady, sendHelp } from "./help.ts";
import { MENU_LEGAL, MENU_PAGES, MENU_SITE_DOCS, PAGE_ART, PAGE_IDS, PAGE_PATHS, SITE_DOC_PATHS, SITE_DOCS, isPageId, pageOfHref, pagePath } from "./pages.ts";
import { CITY_PAGES } from "../open/site-map.ts";
import { openPage, usePages } from "./store.ts";

/* CITY-157: the menu's six old pages — Docs, Developers, Support, Feedback, Terms, Privacy — became the city's own
   windows, and the same addresses answer with the city's pages. Nothing of the old site's pages stands behind them,
   and no link of the menu leads to an old page. */

const REPO = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, REPO), "utf8");
const exists = (path) => existsSync(new URL(path, REPO));

/** The old site's chrome and shells: a city page imports none of them. */
const OLD = /@\/app\/site\/|@\/components\/|@ryntra\/core|app\/site\/frozen|PublicHeader|FrozenFooter|InfoPage|@\/app\/app\/|@\/app\/docs\//;

test("every page has its address, and the first one is its own", () => {
  assert.deepEqual([...PAGE_IDS].sort(), Object.keys(PAGE_PATHS).sort());
  assert.equal(pagePath("help"), "/support");
  assert.deepEqual(PAGE_PATHS.help, ["/support", "/feedback"], "Support and Feedback are one Help");
  assert.equal(pagePath("terms"), "/legal/terms");
  assert.equal(pagePath("privacy"), "/legal/privacy");
  assert.ok(isPageId("about") && !isPageId("support"));
  assert.deepEqual(pageOfHref("/legal/privacy#android"), { id: "privacy", hash: "android" });
  assert.deepEqual(pageOfHref("/feedback"), { id: "help", hash: "" });
  assert.equal(pageOfHref("/app/home"), null);
});

test("each address answers with the city's page, not the old site's", () => {
  for (const id of PAGE_IDS) {
    for (const path of PAGE_PATHS[id]) {
      const file = `app${path}/page.tsx`;
      assert.ok(exists(file), `${path} has a route`);
      const source = read(file);
      assert.match(source, /from "@\/city\/components\/pages\/CityDocument"/, `${file} renders the city's page`);
      assert.match(source, new RegExp(`<CityDocument id="${id}" />`), `${file} is ${id}`);
      assert.match(source, new RegExp(`buildCityPageMetadata\\("${id}", "${path.replace(/\//g, "\\/")}"\\)`), `${file} names its address`);
      assert.doesNotMatch(source, OLD, `${file} imports nothing of the old site`);
    }
  }
});

test("no old chrome wraps the city's pages", () => {
  // The old legal shell stands only over the pages it still serves (the licences, the review drafts), in its own group.
  assert.ok(!exists("app/legal/layout.tsx"), "no layout above /legal/terms and /legal/privacy");
  assert.ok(exists("app/legal/(frozen)/layout.tsx"));
  for (const dir of ["app/support", "app/feedback", "app/developers", "app/about"]) {
    assert.ok(!exists(`${dir}/layout.tsx`), `${dir} has no layout of its own`);
  }
  // `/docs` keeps the old handbook's segment for its chapters: it may load their styles, never draw their chrome.
  const docs = read("app/docs/layout.tsx");
  assert.doesNotMatch(docs, /PublicHeader|FrozenFooter|InfoPage|<header|<footer|<nav/);
});

test("the city's pages are made of the city only", () => {
  const dir = new URL("city/components/pages/", REPO);
  for (const name of readdirSync(dir).filter((n) => /\.(tsx?|css)$/.test(n))) {
    const source = readFileSync(new URL(name, dir), "utf8");
    assert.doesNotMatch(source, OLD, `${name} imports nothing of the old interface`);
    assert.doesNotMatch(source, /ryntra-wordmark|ry-mark-grad|ryntra-brand|#ff681c/i, `${name} carries no old mark or colour`);
  }
});

test("the menu opens the city's windows: no link of it leads to an old page", () => {
  const menu = read("city/components/hud/Menu.tsx");
  for (const path of [...Object.values(PAGE_PATHS).flat(), "/docs", "/developers", "/support", "/feedback"]) {
    assert.ok(!menu.includes(`'${path}'`) && !menu.includes(`"${path}"`), `the menu writes no ${path}`);
  }
  assert.doesNotMatch(menu, /href=\{l\.href\}|target="_blank"[^>]*>\s*\{w\[/, "no row of the menu is a link out");
  assert.match(menu, /MENU_PAGES\.map/);
  assert.match(menu, /MENU_LEGAL\.map/);
  assert.match(menu, /openPage\(id\)/);
  assert.deepEqual([...MENU_PAGES, ...MENU_LEGAL].sort(), [...PAGE_IDS].sort(), "every page has its row");
  // Two links leave the window frame: the site's own documents at their address (CITY-177) and the city's own X.
  assert.equal((menu.match(/href=/g) ?? []).length, 2);
  assert.match(menu, /href=\{CONTACTS\.companyX\}/);
  assert.match(menu, /MENU_SITE_DOCS\.map[\s\S]*href=\{SITE_DOC_PATHS\[id\]\}/);
});

test("the site's documents — «What we're building», the partner page, the roadmap — are pages of the city, in the menu and at every page's foot", () => {
  const advertised = new Set(CITY_PAGES.map((page) => page.path));
  for (const id of SITE_DOCS) assert.ok(advertised.has(SITE_DOC_PATHS[id]), `${SITE_DOC_PATHS[id]} is a live page of the city`);
  // «Partners» stays the menu's own window above the documents; the other two leave for their page.
  assert.deepEqual([...MENU_SITE_DOCS], ["build", "roadmap"]);
  assert.match(read("city/components/hud/Menu.tsx"), /openPartners\(\)/);
  const shell = read("city/components/pages/DocumentPage.tsx");
  assert.match(shell, /SITE_DOCS\.map[\s\S]*href=\{SITE_DOC_PATHS\[page\]\}/, "the foot of every page leads to the three documents");
});

test("the pages are windows of the city: mounted once, known to Back and to «a window is open»", () => {
  assert.match(read("city/components/CityApp.tsx"), /<PagesLayer \/>/);
  assert.match(read("city/lib/city/windows.ts"), /'pages'/);
  assert.match(read("city/components/hud/useBackLayers.ts"), /pages: \(\) =>/);
  assert.match(read("city/components/hud/useWindowOpen.ts"), /pages: usePages\.getState\(\)/);
});

test("the store: a page opens once, with the anchor it was asked for, and closes", () => {
  usePages.setState({ open: [], anchor: null });
  openPage("terms");
  openPage("privacy", "#android");
  openPage("terms");
  assert.deepEqual(usePages.getState().open, ["terms", "privacy"]);
  assert.equal(usePages.getState().anchor?.id, "privacy");
  assert.equal(usePages.getState().anchor?.hash, "android");
  usePages.getState().close("privacy");
  assert.deepEqual(usePages.getState().open, ["terms"]);
  assert.equal(usePages.getState().anchor, null);
  usePages.getState().closeAll();
  assert.deepEqual(usePages.getState().open, []);
});

test("each page's still is a frame of our own city that exists", () => {
  for (const id of PAGE_IDS) {
    for (const src of [PAGE_ART[id].small, PAGE_ART[id].large]) {
      // A district frame filmed from the live scene — never the intro or the share card, which are not frames of it.
      assert.match(src, /^\/city\/art\/district-[a-z]+-(800|1600)\.webp$/);
      assert.ok(exists(`public${src}`), src);
    }
  }
});

test("Help: the engine's bounds, what it sends, and every answer the inbox gives", async () => {
  assert.equal(helpReady({ topic: "bug", body: "too short", contact: "" }), false);
  assert.equal(helpReady({ topic: "bug", body: "x".repeat(HELP_MIN), contact: "" }), true);
  assert.equal(helpReady({ topic: "bug", body: "x".repeat(HELP_MAX + 1), contact: "" }), false);
  assert.equal(helpReady({ topic: "bug", body: "x".repeat(20), contact: "y".repeat(121) }), false);

  const where = { source: "site", route: "/support", locale: "uk" };
  assert.deepEqual(helpPayload({ topic: "security", body: "  a real report here  ", contact: "  @me  " }, where), {
    source: "site",
    topic: "security",
    body: "a real report here",
    route: "/support",
    locale: "uk",
    contact: "@me",
  });
  assert.equal("contact" in helpPayload({ topic: "idea", body: "an idea worth ten", contact: " " }, where), false, "no contact unless typed");

  const answer = (status, json) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => json });
  const seen = [];
  const spy = async (url, init) => (seen.push([url, init]), answer(200, { ok: true, ref: "RYN-FB-0A1B2C3D" })());
  assert.deepEqual(await sendHelp({ topic: "question" }, spy), { kind: "sent", ref: "RYN-FB-0A1B2C3D" });
  assert.equal(seen[0][0], "/api/feedback");
  assert.equal(seen[0][1].method, "POST");
  assert.equal(JSON.parse(seen[0][1].body).topic, "question");
  assert.deepEqual(await sendHelp({}, answer(429, {})), { kind: "busy" });
  assert.deepEqual(await sendHelp({}, answer(503, {})), { kind: "offline" });
  assert.deepEqual(await sendHelp({}, answer(400, {})), { kind: "failed" });
  assert.deepEqual(await sendHelp({}, answer(200, { ref: "not a ref" })), { kind: "failed" });
  assert.deepEqual(await sendHelp({}, async () => Promise.reject(new Error("offline"))), { kind: "failed" });
});

test("Help sends what the engine's inbox takes", () => {
  const route = read("app/api/feedback/route.ts");
  assert.match(route, /isFeedbackTopic\(body\.topic\)/, "the inbox takes a topic");
  const topics = read("lib/admin/feedback-context.ts");
  for (const topic of ["question", "bug", "idea", "security"]) assert.ok(topics.includes(`"${topic}"`), topic);
});

test("Developers: every address behind «Technical details» is served", () => {
  assert.equal(API_BASE, "https://ryntra.io/api/v1");
  for (const row of DEV_ROWS) {
    for (const path of row.value.replace(/^https:\/\/ryntra\.io/, "").match(/\/[A-Za-z0-9_./-]+/g) ?? []) {
      if (path.startsWith("/api/v1")) assert.ok(exists(`app${path}/route.ts`) || path === "/api/v1", `${path} has a route`);
      else assert.ok(exists(`public${path}`), `${path} is a file of the site`);
    }
  }
});

test("llms.txt: the site for language models, with live addresses only", () => {
  const text = read("public/llms.txt");
  assert.match(text, /^# Ryntra\n\n> /, "a title and a summary, as llmstxt.org lays it out");
  assert.match(text, /^## Pages$/m);
  for (const id of PAGE_IDS) assert.ok(text.includes(`(https://ryntra.io${pagePath(id)})`), `${id} is listed`);
  for (const [, path] of text.matchAll(/\(https:\/\/ryntra\.io(\/[^)\s]*)\)/g)) {
    const page = pageOfHref(path);
    const served = page || exists(`app${path}/route.ts`) || exists(`public${path}`);
    assert.ok(served, `${path} answers`);
  }
  assert.ok(text.includes(`(${CONTACTS.companyX})`), "the city's X, as the contacts name it");
  assert.doesNotMatch(text, /seed phrase.*(send|paste|enter)/i);
});

test("security.txt: a contact, an expiry ahead, its own address; the contact is marked as a stand-in", () => {
  const text = read("public/.well-known/security.txt");
  const field = (name) => text.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1];
  assert.ok(field("Contact"), "Contact is required (RFC 9116)");
  const expires = Date.parse(field("Expires") ?? "");
  assert.ok(Number.isFinite(expires) && expires > Date.now(), "Expires is required and ahead — renew it before it passes");
  assert.equal(field("Canonical"), "https://ryntra.io/.well-known/security.txt");
  assert.match(text, /^# PLACEHOLDER:/m, "the stand-in contact is said to be one until the owner names the inbox");
  assert.ok(pageOfHref(new URL(field("Contact")).pathname), "the stand-in leads to a page of the city");
});

test("AI chats (CITY-170): the connector's own addresses, its real limit, one action, and no chat's site linked", async () => {
  const { CONNECTOR_CATALOG_MCP_PATH, CONNECTOR_DOCS_PATH, CONNECTOR_MCP_PATH } = await import("../../../lib/connector/metadata.ts");
  const { CONNECTOR_QUOTA_PER_MINUTE } = await import("../../../lib/connector/ledger.ts");
  const { CALLS_A_MINUTE, CATALOG_URL, CONNECTOR_ROWS, CONNECTOR_URL } = await import("./connector.ts");
  assert.equal(pagePath("connector"), CONNECTOR_DOCS_PATH, "the page the connector's metadata names as its documentation");
  assert.equal(CONNECTOR_URL, `https://ryntra.io${CONNECTOR_MCP_PATH}`);
  assert.equal(CATALOG_URL, `https://ryntra.io${CONNECTOR_CATALOG_MCP_PATH}`);
  assert.equal(CALLS_A_MINUTE, CONNECTOR_QUOTA_PER_MINUTE, "the page says the limit the server keeps");
  assert.ok(exists("app/mcp/route.ts") && exists("app/mcp/read/route.ts"), "both addresses answer");
  assert.ok(CONNECTOR_ROWS.some((row) => row.value === CONNECTOR_URL) && CONNECTOR_ROWS.some((row) => row.value === CATALOG_URL));
  assert.ok(MENU_PAGES.includes("connector"), "the menu opens it");

  const body = read("city/components/pages/ConnectorBody.tsx");
  assert.equal((body.match(/className=\{`\$\{s\.display\} \$\{s\.action\}`\}/g) ?? []).length, 1, "one amber action");
  assert.match(body, /<More label=\{w\.technical\}>/, "the addresses stand behind «Technical details»");
  assert.match(read("city/components/pages/InfoBodies.tsx"), /door="connector"/, "Developers opens it");
  // No link to a chat's own site on a public page: a person adds Ryntra from inside their chat.
  for (const file of ["city/components/pages/ConnectorBody.tsx", "city/components/pages/words.ts", "city/lib/pages/connector.ts", "public/llms.txt", "app/connector/page.tsx"]) {
    assert.doesNotMatch(read(file), /claude\.ai|claude\.com|chatgpt\.com|openai\.com/i, file);
  }
});
