import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inDevelopmentRepository, needsDevelopmentRepository } from "../../../lib/development-repository.mjs";

const read = (path) => readFileSync(new URL("../../../" + path, import.meta.url), "utf8");

/**
 * Prose is not code, and on this surface the distinction matters twice.
 *
 * A source scan that cannot tell a comment from a call forces the comment to be
 * deleted — the design gate's own lesson, learned again here. And the
 * reader-facing copy on this page legitimately contains the words the code must
 * not: "no average is computed" is the claim this page makes, and refusing the
 * word would refuse the claim. So the scans below look for the *shape of the
 * operation* in stripped code, never for a word in prose.
 */
const codeOnly = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");

const RESEARCH = read("app/app/research/page.tsx");
const DETAIL = read("app/app/research/[id]/page.tsx");
const DETAIL_BODY = read("app/app/research/detail.tsx");
const LOADING = read("app/app/research/loading.tsx");
const TILES = read("app/app/research/tiles.tsx");
const READ = read("app/app/research/read.ts");
const CSS = read("app/app/research/research.module.css");
const DESIGN_CHECK = inDevelopmentRepository ? read("scripts/design-check.mjs") : "";
const ROUTES = read("lib/documented-routes.test.mjs");
const VERCEL = JSON.parse(read("vercel.json"));

test("the comment stripper removes prose and keeps code", () => {
  const stripped = codeOnly([
    "/* a comment naming /app/radar in prose */",
    "// another one naming /app/radar",
    " * a JSDoc continuation naming /app/radar",
    "const href = \"/app/research\";",
  ].join("\n"));
  assert.equal(stripped.includes("/app/radar"), false);
  assert.match(stripped, /app\/research/);
  assert.equal(codeOnly("const href = \"/app/radar\";").includes("/app/radar"), true);
});

test("Research is a third direct route beside Today and Portfolio, and none redirects", () => {
  assert.doesNotMatch(RESEARCH, /\bredirect\(/);
  assert.match(RESEARCH, /href="\/app"/);
  assert.match(RESEARCH, /href="\/app\/portfolio"/);
});

test("the six defined views are the only ones the route serves", () => {
  assert.match(RESEARCH, /RESEARCH_VIEW_IDS\.includes/);
  /* An unknown `?view=` falls back rather than 404s: a reader who typed a URL
     is not an error condition. */
  assert.match(RESEARCH, /:\s*"FOR_ME";/);
});

test("every section carries its anchor id", () => {
  for (const id of ["radar", "mandate", "sources"]) {
    assert.match(RESEARCH, new RegExp(`id="${id}"`), `missing section ${id}`);
  }
  for (const id of ["what-changed", "measurement", "rule", "evidence"]) {
    assert.match(DETAIL_BODY, new RegExp(`id="${id}"`), `missing detail section ${id}`);
  }
  /* The route itself keeps the one section a reader sees when the change is
     gone, which is the state the detail body cannot render. */
  assert.match(DETAIL, /id="gone"/);
});

test("the surface consumes the projection and contains no detection logic of its own", () => {
  for (const source of [RESEARCH, DETAIL, DETAIL_BODY, TILES]) {
    for (const forbidden of [
      "detectMaterialChanges",
      "compileMonitorRules",
      "compileResearchMandate",
      "nextCronOccurrence",
      "relativeBps",
      "subtractDecimal",
    ]) {
      assert.equal(source.includes(forbidden), false, `${forbidden} belongs to lib/home/research, not to a page`);
    }
  }
});

test("no reconciled value is computed anywhere on this surface", () => {
  /* The averaging defect, refused in the display layer as well as in the model. */
  for (const source of [RESEARCH, DETAIL, DETAIL_BODY, TILES]) {
    for (const forbidden of ["reduce((sum", "/ 2", "median(", "average(", "Number("]) {
      assert.equal(
        codeOnly(source).includes(forbidden),
        false,
        `${forbidden} must not appear on a surface that shows conflicting values side by side`,
      );
    }
  }
});

test("no model call, provider write, wallet or execution path enters the research surface", () => {
  for (const source of [RESEARCH, DETAIL, DETAIL_BODY, TILES, READ, LOADING]) {
    for (const forbidden of [
      "eth_requestAccounts",
      "personal_sign",
      "eth_sendTransaction",
      "signTypedData",
      "method: \"POST\"",
      "paperOpen",
      "paperClose",
      "watchList",
      "watchUpdate",
      "generateText",
      "openai",
      "anthropic",
    ]) {
      assert.equal(source.includes(forbidden), false, `${forbidden} has no place on the research surface`);
    }
  }
});

test("the declared cadence is the deployment's own cron, so the two cannot drift", () => {
  const declared = READ.match(/RESEARCH_CADENCE_CRON = "([^"]+)"/);
  assert.ok(declared, "the read layer must declare its cadence");
  const schedules = VERCEL.crons.map((entry) => entry.schedule);
  assert.ok(
    schedules.includes(declared[1]),
    `the mandate declares ${declared[1]} and vercel.json declares ${schedules.join(", ")}`,
  );
});

test("Home navigation names Research and the route exists", () => {
  const manifest = read("app/app/home-manifest.ts");
  assert.match(manifest, /labelKey: "nav.radar"/);
  assert.match(manifest, /href: "\/app\/research"/);
  assert.match(read("app/app/i18n/catalog.ts"), /"nav.radar": "Research"/);
});

test("the new surface joined the enforced design migration list", { skip: needsDevelopmentRepository("the design lint scripts/design-check.mjs") }, () => {
  assert.match(DESIGN_CHECK, /"app\/app\/research",/);
});

test("the frozen /app/radar decision is closed rather than left open", () => {
  /* Both built routes leave the planned register, and the radar entry stops
     saying it is waiting for something. */
  assert.equal(ROUTES.includes('{ path: "/app/research"'), false);
  assert.equal(ROUTES.includes('{ path: "/app/research/[id]"'), false);
  assert.match(ROUTES, /\{ path: "\/app\/radar", reason: "closed rather than left frozen/);
  /* And no redirect was added, because a redirect-only route is still a route.
     The decision may be *explained* in a comment — that is where it belongs. */
  assert.equal(codeOnly(RESEARCH).includes("/app/radar"), false);
  assert.match(RESEARCH, /`\/app\/radar` is deliberately not created/);
});

test("the loading state reserves geometry and shows no earlier result", () => {
  assert.match(LOADING, /aria-busy="true"/);
  assert.match(LOADING, /skeleton/);
  assert.match(CSS, /prefers-reduced-motion/);
});

test("the detail route refuses an id it cannot resolve instead of inventing one", () => {
  assert.match(DETAIL, /findChange\(/);
  assert.match(DETAIL, /This change is not in the current read/);
  assert.match(DETAIL, /notFound\(\)/);
});

test("every explanation on both routes lives behind the info control", () => {
  /* The standing rule: a workspace prints no documentation. Prose belongs to
     `info={...}`, which `Section` renders inside `InfoControl`. */
  for (const [name, source] of [["research", RESEARCH], ["detail", DETAIL], ["detail body", DETAIL_BODY]]) {
    const sections = [...source.matchAll(/<Section\b/g)].length;
    const infos = [...source.matchAll(/\n\s+info=\{/g)].length;
    assert.equal(infos, sections, `${name}: every Section must carry an info control`);
  }
});
