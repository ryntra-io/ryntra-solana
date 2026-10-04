import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inDevelopmentRepository, needsDevelopmentRepository } from "../../../lib/development-repository.mjs";

const read = (path) => readFileSync(new URL("../../../" + path, import.meta.url), "utf8");

/**
 * Prose is not code, and on these three surfaces the distinction matters twice.
 *
 * A source scan that cannot tell a comment from a call forces the comment to be
 * deleted — the design gate's own lesson. And the reader-facing copy here
 * legitimately contains words the code must not carry as values: *Ryntra issues
 * no recommendation* is the claim these pages exist to make, and refusing the
 * word would refuse the claim. So the scans below look for the *shape of the
 * operation* in stripped code, never for a word in prose.
 */
const codeOnly = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");

const ADVISER = read("app/app/adviser/page.tsx");
const ADVISER_TILES = read("app/app/adviser/tiles.tsx");
const ADVISER_READ = read("app/app/adviser/read.ts");
const ADVISER_LOADING = read("app/app/adviser/loading.tsx");
/* `app/app/strategies/page.tsx` is My strategies — the wallet's trading plans
   (`plans/plans-panel.tsx`), read behind the wallet's proof rather than an
   account session. The lab's own read model (`read.ts`, `tiles.tsx`, `[id]/`)
   stays for the lab's pages, so the rules below follow the code that is
   mounted rather than the filename. */
const STRATEGIES = read("app/app/strategies/plans/plans-panel.tsx");
const STRATEGY_DETAIL = read("app/app/strategies/[id]/page.tsx");
const STRATEGY_TILES = read("app/app/strategies/tiles.tsx");
const STRATEGY_READ = read("app/app/strategies/read.ts");
const CONTROL = read("app/app/control/page.tsx");
const CONTROL_TILES = read("app/app/control/tiles.tsx");
const CONTROL_READ = read("app/app/control/read.ts");
const CSS = read("app/app/home-surface.module.css");
/* The Home rail is the Shell v2 manifest (`home-shell.tsx` supplies it); the
   workspace registry keeps no navigation of Home's own. */
const HOME_NAV = read("app/app/home-manifest.ts");
const DESIGN_CHECK = inDevelopmentRepository ? read("scripts/design-check.mjs") : "";
const ROUTES = read("lib/documented-routes.test.mjs");

const SURFACES = [
  ["adviser", ADVISER],
  ["adviser tiles", ADVISER_TILES],
  ["adviser read", ADVISER_READ],
  ["strategies", STRATEGIES],
  ["strategy detail", STRATEGY_DETAIL],
  ["strategy tiles", STRATEGY_TILES],
  ["strategy read", STRATEGY_READ],
  ["control", CONTROL],
  ["control tiles", CONTROL_TILES],
  ["control read", CONTROL_READ],
];

test("the comment stripper removes prose and keeps code", () => {
  const stripped = codeOnly([
    "/* a comment naming a verdict \"BUY\" in prose */",
    "// another one naming \"BUY\"",
    " * a JSDoc continuation naming \"BUY\"",
    "const value = 1;",
  ].join("\n"));
  assert.equal(stripped.includes("BUY"), false);
  assert.match(stripped, /const value = 1;/);
  assert.equal(codeOnly('const verdict = "BUY";').includes("BUY"), true);
});

test("no personalized verdict is issuable from any adviser, strategy or control surface", () => {
  for (const [name, source] of SURFACES) {
    for (const verdict of ['"BUY"', '"SELL"', '"HOLD"', '"REDUCE"', '"HEDGE"', '"REBALANCE"']) {
      assert.equal(codeOnly(source).includes(verdict), false, `${name} must not carry the verdict ${verdict}`);
    }
  }
});

test("no adviser, strategy or control surface writes, signs, executes or moves funds", () => {
  for (const [name, source] of SURFACES) {
    for (const forbidden of [
      'method: "POST"',
      "eth_requestAccounts",
      "eth_sendTransaction",
      "personal_sign",
      "signTypedData",
      "paperOpen",
      "paperClose",
      "paperJournal",
      "liveNoteUpsert",
      "strategyLabAppend",
      "saveTypedDraft(",
      ".insert(",
      ".upsert(",
    ]) {
      assert.equal(codeOnly(source).includes(forbidden), false, `${name} must not ${forbidden}`);
    }
  }
});

test("no adviser, strategy or control surface calls a model", () => {
  for (const [name, source] of SURFACES) {
    for (const forbid of ["openai", "OpenAI", "responses.parse", "formalizeStrategy", "reviewStrategy"]) {
      assert.equal(codeOnly(source).includes(forbid), false, `${name} must not call ${forbid}`);
    }
  }
});

test("the workbench states that it saves nothing, on the page rather than in a comment", () => {
  assert.match(ADVISER, /label="Saves nothing"/);
  assert.match(ADVISER, /label="Nothing was saved"/);
  /* And there is no input on this surface that could accept something to save. */
  assert.equal(codeOnly(ADVISER).includes("<input"), false);
  assert.equal(codeOnly(ADVISER).includes("<textarea"), false);
  assert.equal(codeOnly(ADVISER).includes("<form"), false);
  assert.equal(codeOnly(ADVISER_TILES).includes("<input"), false);
});

test("the answer's eight sections each have an anchor, and none is conditional on being non-empty", () => {
  for (const id of ["answer", "facts", "disagreements", "scenarios", "relevance", "result", "next-step", "versions"]) {
    assert.match(ADVISER, new RegExp(`id="${id}"`), `missing section ${id}`);
  }
  /* The display layer renders an empty section's reason rather than skipping
     it — the whole point of a fixed structure, and one line of JSX from being
     undone. */
  assert.match(ADVISER_TILES, /answer\.sections\.find\(\(entry\) => entry\.id === "FACTS"\)/);
  assert.match(ADVISER_TILES, /answer\.sections\.find\(\(entry\) => entry\.id === "CONFLICTS_AND_UNKNOWNS"\)/);
  assert.match(ADVISER_TILES, /answer\.sections\.find\(\(entry\) => entry\.id === "SCENARIOS"\)/);
});

test("the surfaces consume their projections and contain no compilation logic of their own", () => {
  for (const [name, source] of [["adviser", ADVISER], ["adviser tiles", ADVISER_TILES], ["strategies", STRATEGIES], ["strategy tiles", STRATEGY_TILES], ["control", CONTROL], ["control tiles", CONTROL_TILES]]) {
    for (const forbidden of ["compileRynAnswer", "buildRynQuestions", "assessBacktest", "materialDiff", "buildControlProjection"]) {
      assert.equal(source.includes(forbidden), false, `${forbidden} belongs to lib/home, not to ${name}`);
    }
  }
});

test("the strategy surface never carries the lab's score, quality or verdict", () => {
  for (const [name, source] of [["strategies", STRATEGIES], ["detail", STRATEGY_DETAIL], ["tiles", STRATEGY_TILES], ["read", STRATEGY_READ]]) {
    for (const forbidden of ["evidence.score", "evidence.quality", "evidence.verdict"]) {
      assert.equal(codeOnly(source).includes(forbidden), false, `${name} must not carry ${forbidden}`);
    }
  }
});

test("every control tile renders its owner link, because that is what makes it a projection", () => {
  assert.match(CONTROL_TILES, /tile\.owner\.href/);
  assert.match(CONTROL_TILES, /tile\.owner\.surface/);
  /* And no control on this page acts. The scan is for the *shape of an
     operation*, never for a word: the page's own copy legitimately says it
     pauses, revokes and authorizes nothing, and that sentence is the claim this
     route exists to make. Refusing the noun would refuse the claim. */
  for (const forbidden of ["onClick", "<button", "<form", "revoke(", "killSwitch(", "onRevoke", "onPause"]) {
    assert.equal(codeOnly(CONTROL).includes(forbidden), false, `the control page must not carry ${forbidden}`);
    assert.equal(codeOnly(CONTROL_TILES).includes(forbidden), false, `the control tiles must not carry ${forbidden}`);
  }
});

test("all four routes exist as direct destinations and none redirects", () => {
  for (const [name, source] of [["adviser", ADVISER], ["strategies", STRATEGIES], ["detail", STRATEGY_DETAIL], ["control", CONTROL]]) {
    assert.doesNotMatch(source, /\bredirect\(/, `${name} must not redirect`);
  }
  /* The Strategy Lab is deliberately outside every menu (its own flag says so),
     so the way in is from a strategy's own detail rather than from the list. */
  assert.match(STRATEGY_TILES, /href="\/app\/strategy-lab"/);
  assert.match(CONTROL, /href="\/agents\/workspace"/);
});

test("each route serves a no-account state rather than a blank shell", () => {
  for (const [name, source] of [["adviser", ADVISER], ["detail", STRATEGY_DETAIL], ["control", CONTROL]]) {
    /* The gate is the account (canKeepPersonalData), the legacy
       form is the channel-join flag. */
    assert.match(source, /session\?\.verified|canKeepPersonalData\(session\)/, `${name} must gate on the session`);
    assert.match(source, /No account/, `${name} must state the no-account case`);
  }
  /* The plans are the wallet's, not an account's: the list is drawn only
     behind the wallet's proof, and the unproven and unconnected states are
     named in the person's own words, never a blank shell. */
  assert.match(STRATEGIES, /const proven = proof\.state\.status === "proven" && proof\.state\.address === address/);
  assert.match(STRATEGIES, /if \(proven\) void load\(\);/);
  assert.match(STRATEGIES, /word\("connectToSee"\)/);
  assert.match(STRATEGIES, /word\("confirmToSee"\)/);
});

test("each route reserves geometry while loading rather than showing the last read", () => {
  assert.match(ADVISER_LOADING, /aria-busy="true"/);
  assert.match(read("app/app/strategies/loading.tsx"), /aria-busy="true"/);
  assert.match(read("app/app/control/loading.tsx"), /aria-busy="true"/);
});

test("the three surfaces share one stylesheet rather than three copies of one", () => {
  for (const [name, source] of SURFACES) {
    if (!source.includes("home-surface.module.css")) continue;
    assert.match(source, /@\/app\/app\/home-surface\.module\.css/, `${name} must import the shared stylesheet by alias`);
  }
  assert.match(CSS, /\.surface \{/);
});

test("the three routes joined the navigation, the design gate and left the planned register", { skip: needsDevelopmentRepository("the design lint scripts/design-check.mjs") }, () => {
  for (const href of ["/app/adviser", "/app/strategies", "/app/control"]) {
    assert.ok(HOME_NAV.includes(`href: "${href}"`), `${href} must be in a Home navigation group`);
  }
  for (const surface of ["app/app/adviser", "app/app/strategies", "app/app/control", "app/app/home-surface.module.css"]) {
    assert.ok(DESIGN_CHECK.includes(`"${surface}"`), `${surface} must join the enforced design surface`);
  }
  for (const path of ["/app/adviser", "/app/strategies", "/app/strategies/[id]", "/app/control"]) {
    assert.equal(
      ROUTES.includes(`{ path: "${path}"`),
      false,
      `${path} is built, so it must leave the planned-route register`,
    );
  }
});

test("the strategy read states that missing data is not recorded rather than inventing a count", () => {
  /* The lab scores data completeness as a rubric dimension, not a bar count.
     Mapping it to `0 missing bars` would state a fact no source recorded. */
  assert.match(codeOnly(STRATEGY_READ), /missingDataBars: null/);
  assert.equal(/missingDataBars:\s*0\b/.test(codeOnly(STRATEGY_READ)), false);
});
