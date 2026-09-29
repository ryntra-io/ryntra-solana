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
 * not: the sentence *Ryntra issues no recommendation* is the claim this page
 * exists to make, and refusing the word would refuse the claim. So the scans
 * below look for the *shape of the operation* in stripped code, never for a
 * word in prose.
 */
const codeOnly = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");

const PAGE = read("app/app/action-cases/page.tsx");
const DETAIL = read("app/app/action-cases/[id]/page.tsx");
const DETAIL_BODY = read("app/app/action-cases/detail.tsx");
const LOADING = read("app/app/action-cases/loading.tsx");
const TILES = read("app/app/action-cases/tiles.tsx");
const READ = read("app/app/action-cases/read.ts");
const CONTEXT = read("app/app/action-cases/context-binding.tsx");
const CSS = read("app/app/action-cases/decisions.module.css");
const JOURNAL = read("app/app/journal/page.tsx");
const JOURNAL_READ = read("app/app/journal/read.ts");
const JOURNAL_CSS = read("app/app/journal/journal.module.css");
const DESIGN_CHECK = inDevelopmentRepository ? read("scripts/design-check.mjs") : "";
const ROUTES = read("lib/documented-routes.test.mjs");

test("the comment stripper removes prose and keeps code", () => {
  const stripped = codeOnly([
    "/* a comment naming BUY in prose */",
    "// another one naming BUY",
    " * a JSDoc continuation naming BUY",
    'const href = "/app/action-cases";',
  ].join("\n"));
  assert.equal(stripped.includes("BUY"), false);
  assert.match(stripped, /app\/action-cases/);
  assert.equal(codeOnly('const verdict = "BUY";').includes("BUY"), true);
});

test("no personalized verdict is issuable from any decision surface", () => {
  for (const [name, source] of [
    ["queue", PAGE],
    ["detail route", DETAIL],
    ["detail body", DETAIL_BODY],
    ["tiles", TILES],
    ["read", READ],
    ["journal", JOURNAL],
  ]) {
    for (const verdict of ['"BUY"', '"SELL"', '"HOLD"', '"REDUCE"', '"HEDGE"', '"REBALANCE"']) {
      assert.equal(codeOnly(source).includes(verdict), false, `${name} must not carry the verdict ${verdict}`);
    }
  }
  /* And the page states the constant rather than implying it. */
  assert.match(PAGE, /Advice authority/);
  assert.match(PAGE, />NONE</);
});

test("a chip names what a case awaits, and a book is never drawn as a warning", () => {
  /* Both found by looking. `EVIDENCE` sat beside `2 sources disagree` and read
     as a third finding; `LIVE` carried an amber warning triangle, so a real
     fill read as a problem and a paper one read as fine. */
  assert.match(TILES, /export function stageLabel/);
  assert.match(TILES, /"Awaiting decision"/);
  assert.match(TILES, /const bookTone: Tone = "quiet"/);
  for (const [name, source] of [["queue", TILES], ["detail", DETAIL_BODY], ["journal", JOURNAL]]) {
    /* `PAPER` and `LIVE` are readable words and stay as labels — the defect was
       the amber tone on them. `advice.stage` is the opaque one and may not be
       printed raw. */
    assert.equal(
      /label=\{advice\.stage\}/.test(codeOnly(source)),
      false,
      `${name} must not print the raw stage enum as a chip label`,
    );
    assert.equal(
      /book === "LIVE" \? "caution"/.test(codeOnly(source)),
      false,
      `${name} must not tone a book as a warning`,
    );
  }
  /* And a closed-but-unreviewed cycle is named by what it needs. */
  assert.match(TILES, /export function cycleLabel/);
  assert.match(TILES, /"Needs review"/);
});

test("no lifecycle stage id is printed where it reads as a claim about money", () => {
  /* Found by looking. `Currently at ${action.currentStageId}` rendered as
     "Currently at risk." on a real case — a sentence about a position where a
     sentence about a stage was meant. The stage's own label is used instead. */
  assert.equal(codeOnly(TILES).includes("Currently at ${action.currentStageId}"), false);
  assert.match(TILES, /Currently at the \$\{action\.stages\.find/);
});

test("both routes exist as direct destinations and neither redirects", () => {
  assert.doesNotMatch(PAGE, /\bredirect\(/);
  assert.doesNotMatch(DETAIL, /\bredirect\(/);
  assert.match(PAGE, /href="\/app\/research"/);
  assert.match(PAGE, /href="\/app\/journal"/);
});

test("every section carries its anchor id", () => {
  for (const id of ["queue", "actions", "receipts", "activity", "sources"]) {
    assert.match(PAGE, new RegExp(`id="${id}"`), `missing section ${id}`);
  }
  for (const id of ["chain", "alternatives", "evidence", "receipt"]) {
    assert.match(DETAIL_BODY, new RegExp(`id="${id}"`), `missing detail section ${id}`);
  }
  assert.match(DETAIL, /id="gone"/);
  for (const id of ["cycle", "discipline", "adherence", "open", "closed"]) {
    assert.match(JOURNAL, new RegExp(`id="${id}"`), `missing journal section ${id}`);
  }
});

test("the surfaces consume the projection and contain no compilation logic of their own", () => {
  for (const source of [PAGE, DETAIL, DETAIL_BODY, TILES, JOURNAL]) {
    for (const forbidden of ["compileAdviceCase", "projectHomeActionCase", "projectActivity", "projectReceiptIndex", "decisionQueue("]) {
      assert.equal(source.includes(forbidden), false, `${forbidden} belongs to lib/home/advice, not to a page`);
    }
  }
});

test("the detail page issues its receipt from the same function the index uses", () => {
  /* Two receipt paths would be two answers to "does this outcome have one",
     and the index and the detail page would eventually disagree. */
  assert.match(DETAIL, /issueReceipt\(/);
  assert.equal(DETAIL_BODY.includes("issueReceipt"), false);
  assert.equal(TILES.includes("issueReceipt"), false);
});

test("nothing on these surfaces writes, signs, executes or reaches a model", () => {
  for (const source of [PAGE, DETAIL, DETAIL_BODY, TILES, READ, LOADING, CONTEXT, JOURNAL, JOURNAL_READ]) {
    for (const forbidden of [
      "eth_requestAccounts",
      "personal_sign",
      "eth_sendTransaction",
      "signTypedData",
      'method: "POST"',
      "paperOpen",
      "paperClose",
      "paperJournal",
      "liveNoteUpsert",
      "watchUpdate",
      "generateText",
      "openai",
      "anthropic",
    ]) {
      assert.equal(source.includes(forbidden), false, `${forbidden} is outside this packet`);
    }
  }
});

test("no persistence is added anywhere in this packet", () => {
  /* The founder's standing question, answered as a property of the diff: the
     read layer calls only the read RPCs that already existed. */
  for (const source of [READ, JOURNAL_READ]) {
    for (const forbidden of ["insert(", "upsert(", "supabase.from", "createClient("]) {
      assert.equal(source.includes(forbidden), false, `${forbidden} would be new persistence`);
    }
  }
  assert.match(READ, /paperList\(/);
  assert.match(READ, /liveNotesList\(/);
  assert.match(READ, /getFills\(/);
});

test("no disposition is inferred from a nearby action anywhere on the surface", () => {
  /* The model refuses it and a test in `read-model.test.mjs` proves that; this
     is the surface half — no page may join a case to an action by subject. */
  for (const source of [PAGE, DETAIL, DETAIL_BODY, TILES]) {
    assert.equal(
      codeOnly(source).includes("subjectRef ==="),
      false,
      "a surface must not match a case to an action by subject",
    );
  }
});

test("Agent Control is linked rather than restated, and its cases are named tab-local", () => {
  assert.match(PAGE, /href="\/agents\/workspace\/actions"/);
  assert.match(PAGE, /live in one browser tab/);
  /* No page reads Agent Control's tab-local store: a server render that tried
     would be claiming a list it cannot have. The scan is on stripped code —
     naming the store in a comment is how the limitation gets explained. */
  for (const source of [PAGE, DETAIL, READ]) {
    assert.equal(codeOnly(source).includes("sessionStorage"), false, "the server may not read a tab-local store");
  }
});

test("the investor-context binding is read in the browser, never invented on the server", () => {
  assert.match(READ, /NOT_SERVER_READABLE/);
  assert.match(CONTEXT, /"use client"/);
  assert.match(CONTEXT, /localStorage\.getItem/);
  /* Three distinct states: never declared, unreadable, and bound. Collapsing
     the first two would let "you have not told us" read as "we could not look". */
  for (const state of ["MISSING", "UNREADABLE", "BOUND"]) {
    assert.match(CONTEXT, new RegExp(`"${state}"`), `the binding must distinguish ${state}`);
  }
});

test("Home navigation names Decisions and the route exists", () => {
  const manifest = read("app/app/home-manifest.ts");
  assert.match(manifest, /id: "decisions"/);
  assert.match(manifest, /href: "\/app\/action-cases"/);
  assert.match(read("app/app/i18n/catalog.ts"), /"nav.decisions": "Decisions"/);
});

test("both new surfaces joined the enforced design migration list", { skip: needsDevelopmentRepository("the design lint scripts/design-check.mjs") }, () => {
  assert.match(DESIGN_CHECK, /"app\/app\/action-cases",/);
  assert.match(DESIGN_CHECK, /"app\/app\/journal",/);
});

test("the two routes left the planned-route register on the commit that built them", () => {
  assert.equal(ROUTES.includes('{ path: "/app/action-cases"'), false);
  assert.equal(ROUTES.includes('{ path: "/app/action-cases/[id]"'), false);
});

test("both loading states reserve geometry and show no earlier result", () => {
  for (const [name, source, css] of [["decisions", LOADING, CSS], ["journal", read("app/app/journal/loading.tsx"), JOURNAL_CSS]]) {
    assert.match(source, /aria-busy="true"/, `${name} must declare it is busy`);
    assert.match(source, /skeleton/, `${name} must reserve geometry`);
    assert.match(css, /prefers-reduced-motion/, `${name} must respect reduced motion`);
  }
});

test("the detail route refuses an id it cannot resolve instead of inventing one", () => {
  assert.match(DETAIL, /findDecisionCase\(/);
  assert.match(DETAIL, /This case is not in the current read/);
  assert.match(DETAIL, /notFound\(\)/);
});

test("the Journal is the cycle and reads the same projection as the queue", () => {
  /* The four stage labels are the model's, rendered rather than restated, so a
     page cannot show a fifth stage or rename one of the four. */
  const model = read("lib/home/advice/journal.ts");
  assert.match(model, /JOURNAL_STAGES = \["PLAN", "DECISION", "OUTCOME", "CONCLUSION"\]/);
  for (const label of ["Plan", "Decision", "Outcome", "Conclusion"]) {
    assert.match(model, new RegExp(`"${label}"`), `the cycle must name ${label}`);
  }
  assert.match(JOURNAL, /cycle\.stages\.map/);
  /* The per-cycle row is one shared component rather than a second copy in the
     page: two implementations of one row is how two surfaces start describing
     one trade differently. */
  assert.match(JOURNAL, /<CycleRow key=\{entry\.caseId\} cycle=\{entry\} \/>/);
  assert.match(TILES, /cycle\.links\.map/);
  assert.match(JOURNAL_READ, /projectDecisions\(/);
  assert.match(JOURNAL_READ, /projection\.journal/);
  /* One pass over the records, not two: a second reading of the paper book is
     how two surfaces end up disagreeing about what a person did. */
  assert.equal(JOURNAL_READ.includes("paperList("), false);
});

test("the Journal keeps the localized strings it already had", () => {
  for (const key of ["kpiAdherence", "kpiWin", "kpiAvgR", "kpiClosed", "kpiJournaled", "kpiDisciplineHint"]) {
    assert.match(JOURNAL, new RegExp(`copy\\.${key}`), `the rebuild dropped the localized ${key}`);
  }
  /* The header copy follows the workspace locale cookie — the same source the
     rest of the hub chrome reads — not the Telegram bot language. */
  assert.match(JOURNAL, /cabinetUiCopy\(\)/);
  assert.match(JOURNAL, /c\.journal/);
  assert.doesNotMatch(JOURNAL, /pickBetaLang/);
});

test("a missing measurement is never rendered as zero", () => {
  /* `0%` adherence and "the book did not answer" are different facts, and only
     one of them is about the reader. */
  assert.match(JOURNAL, /metricUnknown/);
  assert.match(JOURNAL, /Unavailable/);
  assert.match(JOURNAL, /statsAvailable/);
});

test("every explanation on every route lives behind the info control", () => {
  /* The founder's standing rule: a workspace prints no documentation. Prose
     belongs to `info={...}`, which `Section` renders inside `InfoControl`. */
  for (const [name, source] of [
    ["decisions", PAGE],
    ["detail route", DETAIL],
    ["detail body", DETAIL_BODY],
    ["journal", JOURNAL],
  ]) {
    const sections = [...source.matchAll(/<Section\b/g)].length;
    const infos = [...source.matchAll(/\n\s+info=\{/g)].length;
    assert.equal(infos, sections, `${name}: every Section must carry an info control`);
  }
});
