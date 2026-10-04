import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * RWS panel-system contract.
 *
 * The approved workspace spec is enforced the way the brand is: a test that
 * fails when a migrated surface drifts. Scope is the migrated set — it widens
 * file by file as screens migrate, and a file listed here can never regress to
 * literals or sub-floor type without failing the suite.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

/**
 * Files already migrated onto the token system. Append-only. A hub whose
 * surfaces migrated onto the same contract holds its own files to it beside
 * them, with the same rules.
 */
const MIGRATED_CSS = [
  "app/shell/panel.css",
  "app/shell/shell.css",
];

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("migrated workspace CSS carries no hex color literals — tokens only", () => {
  for (const path of MIGRATED_CSS) {
    const css = stripComments(read(path));
    const hexes = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    assert.deepEqual(
      hexes,
      [],
      `${path} contains hex literals ${JSON.stringify(hexes)}; use the globals.css tokens.`,
    );
  }
});

test("migrated workspace CSS never sets type below the 12px floor", () => {
  for (const path of MIGRATED_CSS) {
    const css = stripComments(read(path));
    const offenders = [];
    for (const match of css.matchAll(/font-size:\s*([0-9]+(?:\.[0-9]+)?)px/g)) {
      if (Number(match[1]) < 12) offenders.push(`font-size: ${match[1]}px`);
    }
    /* In the `font:` shorthand the first px-suffixed number is the size —
       weights are unitless and line-height follows a slash. */
    for (const match of css.matchAll(/font:\s*[^;{}]*?([0-9]+(?:\.[0-9]+)?)px/g)) {
      if (Number(match[1]) < 12) offenders.push(`font: …${match[1]}px`);
    }
    assert.deepEqual(
      offenders,
      [],
      `${path} sets text below the 12px floor: ${JSON.stringify(offenders)}`,
    );
  }
});

test("the cabinet terminals sit on the same type floor, radii and rail", () => {
  /*
   * `globals.css` also carries the two cabinet Workbench surfaces — the paper
   * terminal (`dm-`) and the spot terminal (`spot-`/`tkt-`/`mp-`) — plus the
   * shared ProChart chrome (`pc-`). They are checked as a range rather than as
   * a file because the same stylesheet still holds landing-era rules with their
   * own rhythm, which this contract deliberately does not govern.
   */
  /* The markers are section banners, so the block is located in the raw file
     and only then stripped — stripping first deletes the markers themselves. */
  const raw = read("app/globals.css");
  const start = raw.indexOf("paper trading terminal");
  const end = raw.indexOf("Strategy Lab - dense paper-first");
  assert.ok(start > 0 && end > start, "the terminal block markers must exist in globals.css");
  const block = stripComments(raw.slice(start, end));

  const small = [];
  for (const match of block.matchAll(/font-size:\s*([0-9]+(?:\.[0-9]+)?)px/g)) {
    if (Number(match[1]) < 12) small.push(match[0]);
  }
  for (const match of block.matchAll(/font:\s*[^;{}]*?([0-9]+(?:\.[0-9]+)?)px/g)) {
    if (Number(match[1]) < 12) small.push(match[0]);
  }
  assert.deepEqual(small, [], `terminal CSS below the 12px floor: ${JSON.stringify(small)}`);

  const radii = new Set(
    [...block.matchAll(/border-radius:\s*([^;}]+)/g)].map((match) => match[1].trim()),
  );
  const allowed = new Set([
    "var(--radius-sm)",
    "var(--radius-xs)",
    "var(--r-badge)",
    "var(--r-badge) var(--r-badge) 0 0",
    "var(--radius-sm) var(--radius-sm) 0 0",
    "0 0 var(--radius-sm) var(--radius-sm)",
    "999px",
    "50%",
    "0",
  ]);
  for (const value of radii) {
    assert.ok(allowed.has(value), `terminal CSS uses an off-token radius: ${value}`);
  }

  /* One width for the action rail. Terminal ran 416px and Spot Swap 424px for
     the same role — eight pixels of drift nobody chose. */
  assert.ok(!/\b(416|424)px\b/.test(block), "the action rails must share one width token");
  assert.match(block, /grid-template-columns:\s*minmax\(0, 1fr\) var\(--rw-rail\)/);
  assert.equal(
    [...block.matchAll(/grid-template-columns:\s*minmax\(0, 1fr\) var\(--rw-rail\)/g)].length,
    2,
    "both terminals must take the rail from the same token",
  );
});

test("the embedded terminal draws no second app bar", () => {
  const css = stripComments(read("app/globals.css"));
  assert.match(
    css,
    /\.dm-embedded \.dm-top,\s*\n?\s*\.dm-embedded \.dm-substrip \{[^}]*position: static/,
    "inside the shell the instrument bar must not be sticky — the shell's bar already is",
  );
  const terminal = read("app/demo/terminal.tsx");
  assert.match(
    terminal,
    /embedded \? null : \(\s*\n?\s*<button className="dm-theme"/,
    "the second theme toggle must not render inside the workspace",
  );
});

test("the shell aliases its palette into the one token authority", () => {
  const css = read("app/shell/shell.css");
  /* Every scoped palette name must derive from a root token. A literal here is
     the two-simultaneous-cyans defect coming back. */
  for (const name of ["--cyan", "--mint", "--amber", "--red", "--fg", "--fg-dim", "--fg-muted", "--ink", "--deep", "--raised", "--hairline", "--hairline-strong"]) {
    const declarations = [...css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, "g"))].map(
      (match) => match[1].trim(),
    );
    assert.ok(declarations.length > 0, `shell.css no longer declares ${name}`);
    for (const value of declarations) {
      assert.ok(
        value.startsWith("var("),
        `shell.css declares ${name}: ${value} as a literal; alias it to a globals.css token.`,
      );
    }
  }
});

test("the panel grid is the 12-column / 80px-row contract", () => {
  const css = read("app/shell/panel.css");
  assert.match(css, /\.rw-grid\s*{[^}]*repeat\(12,/, "PanelGrid must keep 12 columns");
  assert.match(
    css,
    /\.rw-grid\s*{[^}]*grid-auto-rows:\s*var\(--rw-row\)/,
    "PanelGrid must take its row unit from the --rw-row token",
  );
  const globals = stripComments(read("app/globals.css"));
  assert.match(globals, /--rw-row:\s*80px/, "the row unit token is 80px");
  /* Since the site ladder rung (2026-08-11) the legacy name projects from
     DESIGN.md; the 8px value the spec fixes now lives one hop away, and both
     hops are asserted so neither can drift silently. */
  assert.match(
    globals,
    /--radius-xs:\s*var\(--rt-radius-xs\)/,
    "control radius token projects from DESIGN.md",
  );
  assert.match(
    read("app/design/tokens.css"),
    /--rt-radius-xs:\s*8px/,
    "the projection keeps the 8px control radius",
  );
});

test("panel anatomy: fixed header band and sentence-case 14px/600 title", () => {
  const css = read("app/shell/panel.css");
  assert.match(css, /\.rw-h\s*{[^}]*flex:\s*0 0 4[02]px/, "panel header is a fixed band");
  assert.match(
    css,
    /\.rw-h h2\s*{[^}]*font-size:\s*var\(--fs-14\)/,
    "panel title is 14px via the type scale",
  );
  assert.ok(
    !/\.rw-h h2\s*{[^}]*text-transform:\s*uppercase/.test(css),
    "panel titles are sentence case, never uppercase",
  );
});

test("mobile panel headers wrap truth labels instead of truncating their titles", () => {
  const css = read("app/shell/panel.css");
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.rw-h \{[\s\S]*?flex-wrap: wrap;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.rw-h h2 \{[\s\S]*?white-space: normal;/);
});

test("panel and scrollport expose valid, non-duplicate accessibility semantics", () => {
  const panel = read("app/shell/panel.tsx");
  assert.match(
    panel,
    /data-panel=\{id\}[\s\S]{0,80}?role="group"[\s\S]{0,80}?aria-label=\{title\}/,
    "the named panel is a group, not a second landmark with the scrollport's name",
  );
  assert.match(
    panel,
    /tabIndex=\{scroll \? 0 : undefined\}[\s\S]{0,100}?role=\{scroll \? "region" : undefined\}[\s\S]{0,100}?aria-label=\{scroll \? title : undefined\}/,
    "only the keyboard-focusable scrollport is exposed as the named region",
  );
});

test("the panel neutralises the landing-page section padding", () => {
  /*
   * The regression for the defect that shipped in the first pass.
   *
   * `globals.css` sets `section { padding: 78px 0 }` for landing rhythm, and
   * `<Panel>` renders a `<section>`. Without an explicit reset the header was
   * pushed ~78px down inside a fixed-height box, landed on top of the body, and
   * `overflow: hidden` clipped whatever was left — on every panel of every
   * migrated screen at once, while every computed-style check still passed.
   */
  const globals = stripComments(read("app/globals.css"));
  assert.match(
    globals,
    /(^|\n)\s*section\s*{\s*padding:/,
    "the landing section rule this reset exists for is gone; re-derive the guard",
  );

  const css = stripComments(read("app/shell/panel.css"));
  const panelRule = /\.rw\s*{([^}]*)}/.exec(css);
  assert.ok(panelRule, "the .rw rule must exist");
  assert.match(
    panelRule[1],
    /padding:\s*0/,
    ".rw must reset padding to 0 or the landing section rule pushes the header onto the body",
  );
});

test("no CSS-module section inherits the landing-page padding", () => {
  /*
   * The `.rw` reset above guards one component. The same trap catches any
   * `<section>` that takes a module class — one hub demo's workspace grid did,
   * and silently gained 156px of empty height. So the rule is derived rather
   * than listed: find every `<section className={styles.X}>` in the migrated
   * components, and require `.X` to declare its own padding.
   */
  /*
   * Both halves of the trap: a CSS-module class, and a global class. The first
   * pass guarded only modules, and `.spot-riskbar` — a `<section>` styled from
   * globals.css — kept its 156px.
   */
  const sources = [
    ["app/robinhood/workspace/swap/swap-terminal.tsx", "app/globals.css"],
    ["app/demo/terminal.tsx", "app/globals.css"],
    /* A hub's chrome walked into the same trap on its first render: three
       `<section>` groups inside a menu came out 156px taller than their own
       content, which is the landing rhythm and nothing else. */
    ["app/shell/connection-control.tsx", "app/shell/shell.css"],
    /* Third time in this repository, and the first two were also menus: the
       Shell v2 switcher's four group `<section>`s each came out 156px taller
       than their content and the panel rendered at 1291px. */
    ["app/shell/app-shell.tsx", "app/shell/shell.css"],
    ["app/shell/action-console.tsx", "app/shell/shell.css"],
  ];

  for (const [tsx, css] of sources) {
    const markup = read(tsx);
    const rules = stripComments(read(css));
    const classes = [
      ...[...markup.matchAll(/<section\s+className=\{styles\.([A-Za-z0-9_]+)\}/g)].map(
        (match) => match[1],
      ),
      /* Global classes, plain or templated: `className="a b"` and
         ``className={`a b-${x}`}`` both style a section from globals.css. */
      ...[...markup.matchAll(/<section\s+className=\{?[`"]([^`"]+)[`"]/g)].flatMap((match) =>
        match[1]
          .split(/\s+/)
          .map((token) => token.replace(/\$\{[^}]*\}/g, "").trim())
          /* A token that ended on the interpolation is a prefix of a computed
             class (`spot-riskbar-${level}`), not a class of its own. The
             static part of the pair is checked; the variant carries modifiers. */
          .filter((token) => /^[a-z][a-z0-9-]*[a-z0-9]$/.test(token)),
      ),
    ];
    /* A class may be styled by a grouped selector, so every rule whose selector
       list mentions it counts — matching only `.name {` misses
       `.a, .name, .b { padding: 16px }` and reports a false gap. */
    const declared = [...rules.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((match) => ({
      selectors: match[1],
      body: match[2],
    }));
    for (const name of new Set(classes)) {
      const owning = declared.filter((rule) =>
        new RegExp(`\\.${name}(?![A-Za-z0-9_-])`).test(rule.selectors),
      );
      assert.ok(owning.length, `${css} has no rule for .${name}, which ${tsx} puts on a <section>`);
      assert.ok(
        owning.some((rule) => /padding\s*:/.test(rule.body)),
        `.${name} is used on a <section> and declares no padding, so globals.css adds 78px top and bottom`,
      );
    }
  }
});

test("panels draw no settings control of their own", () => {
  /*
   * Seen on the rendered screen, the per-panel `⋮` menu was
   * incomprehensible and is off until the surface itself is good. The
   * mechanism stays — panels still register as widgets and per-panel prefs are
   * still read — but the panel renders no control.
   */
  const source = read("app/shell/panel.tsx");
  assert.doesNotMatch(source, /DotsThreeVertical/, "the panel must not render a settings menu");
  assert.doesNotMatch(source, /rw-menu/, "the panel must not render a settings menu");
  assert.match(source, /panelPrefs\(id\)/, "per-panel preferences are still read");
  assert.match(source, /<WorkspaceWidget/, "panels still register with the shell's layout system");
});
