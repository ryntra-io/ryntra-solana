import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const APP = resolve(ROOT, "app");
const read = (absolute) => readFileSync(absolute, "utf8");
const rel = (absolute) => relative(ROOT, absolute).split(sep).join("/");

/**
 * Every layout class a route renders must be defined in a stylesheet that route
 * loads.
 *
 * This is the check a public page's break needed and no gate performed. The
 * `WorkspaceWidget` wrapper carries `.rs-widget`, and `display: contents` is
 * what stops that wrapper from becoming the grid item in place of the panel,
 * which is where the `.rw-w*` spans live. That rule was written in `shell.css`,
 * which only `app-shell.tsx` imports, so it reached a screen only when the
 * screen rendered inside the app shell. A public page renders the same panels
 * outside the shell and shipped to production with four panels at 81px of a
 * 1200px twelve-column grid — one column each — 13px at 375, headings truncated
 * to three characters, body text stacked one letter per line, content over the
 * footer.
 *
 * Nothing could see it. CSS is not typed. No test in this repository renders a
 * page. `design:check` reads token values, not whether a rule is reachable. The
 * route tests resolve that page, and resolving is not rendering. The rendered
 * audit covers the hubs. The defect was found by opening the page.
 *
 * The model here is the browser's: reachability is a property of a **route**,
 * not of a file. A component may rely on a rule its own module never imports,
 * as long as every route rendering it loads that rule some other way — which is
 * how `hub.css` served `.rs-status` until this pass moved it. So the unit is
 * the route: the page plus the layouts above it, resolved transitively.
 *
 * What each component needs is declared, not discovered. Scraping `className`
 * would miss the classes that matter most: `panel.tsx:197` builds its spans as
 * `["rw", "rw-w" + w, "rw-h" + h]`, so a reader of the file sees none of them.
 */

const importCache = new Map();
function importsOf(file) {
  if (importCache.has(file)) return importCache.get(file);
  const out = [];
  for (const match of read(file).matchAll(/(?:^|\n)\s*import\s+(?:[^"';]*?from\s*)?["']([^"']+)["']/g)) {
    const spec = match[1];
    if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;
    const base = spec.startsWith("@/") ? resolve(ROOT, spec.slice(2)) : resolve(dirname(file), spec);
    const candidates = extname(base)
      ? [base]
      : [".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"].map((suffix) => base + suffix);
    const hit = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
    if (hit) out.push(hit);
  }
  importCache.set(file, out);
  return out;
}

/** Everything a set of entries reaches. Stylesheets are leaves. */
function graphFrom(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    if (file.endsWith(".css")) continue;
    for (const next of importsOf(file)) queue.push(next);
  }
  return seen;
}

const definedCache = new Map();
/**
 * Classes a stylesheet actually styles — the subject of a selector, not a
 * context named on the way to one.
 *
 * `.rs-canvas > .rs-widget > .dm-root` styles `.dm-root`. It says nothing about
 * how `.rs-widget` itself renders, so counting it as a definition would let the
 * exact arrangement that shipped that page broken read as covered.
 */
function definedIn(cssFile) {
  if (definedCache.has(cssFile)) return definedCache.get(cssFile);
  const source = read(cssFile).replace(/\/\*[\s\S]*?\*\//g, "");
  const set = new Set();
  for (const block of source.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const selector of block[1].split(",")) {
      const subject = selector.trim().split(/[\s>+~]+/).pop() ?? "";
      for (const cls of subject.matchAll(/\.((?:rs|rw)(?:-[a-z0-9-]+)?)\b/g)) set.add(cls[1]);
    }
  }
  definedCache.set(cssFile, set);
  return set;
}

/** Every page route, with the layouts that wrap it. */
function routes() {
  const found = [];
  (function walk(directory) {
    for (const name of readdirSync(directory)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = resolve(directory, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "page.tsx") {
        const entries = [full];
        for (let dir = directory; dir.startsWith(APP); dir = dirname(dir)) {
          const layout = resolve(dir, "layout.tsx");
          if (existsSync(layout)) entries.push(layout);
        }
        found.push({ route: rel(full).replace(/^app/, "").replace(/\/page\.tsx$/, "") || "/", entries });
      }
    }
  })(APP);
  return found;
}

/**
 * What each shell component requires, wherever it is rendered.
 *
 * Stated as a table rather than discovered by scraping `className`, because the
 * classes that matter most are not literals: `panel.tsx:197` builds its spans as
 * `["rw", `rw-w${w}`, `rw-h${h}`]`, and those are precisely the names whose loss
 * collapses a screen. A scraper reads the file and sees none of them.
 *
 * Only structural rules belong here — the ones whose absence changes a layout
 * rather than a colour. A missing decoration is a blemish; a missing
 * `display: contents` is four panels at 81px.
 */
const REQUIRES = [
  { component: "app/shell/widget.tsx", classes: ["rs-widget"] },
  { component: "app/shell/panel.tsx", classes: ["rs-widget", "rw-grid", "rw", "rw-w12", "rw-h3", "rw-b", "rw-h"] },
  { component: "app/shell/status-chip.tsx", classes: ["rs-status"] },
];

test("a route that renders a shell component loads the rules that component needs", () => {
  const all = routes();
  assert.ok(all.length > 100, `expected the full route set, walked ${all.length}`);

  const gaps = [];
  for (const { route, entries } of all) {
    const graph = graphFrom(entries);
    const defined = new Set();
    for (const file of graph) {
      if (file.endsWith(".css") && !file.endsWith(".module.css")) {
        for (const cls of definedIn(file)) defined.add(cls);
      }
    }
    for (const { component, classes } of REQUIRES) {
      if (!graph.has(resolve(ROOT, component))) continue;
      for (const cls of classes) {
        if (!defined.has(cls)) gaps.push(`${route} renders ${component} but loads no rule for .${cls}`);
      }
    }
  }
  assert.deepEqual(
    [...new Set(gaps)].sort(),
    [],
    "a structural class with no reachable rule does not render plainer — it renders broken:\n" +
      [...new Set(gaps)].sort().join("\n"),
  );
});

test("the widget wrapper generates no box, and ships that rule with itself", () => {
  const widget = resolve(APP, "shell/widget.tsx");
  assert.match(read(widget), /className="rs-widget"/, "WorkspaceWidget still emits the wrapper class");

  const rule = [...graphFrom([widget])]
    .filter((file) => file.endsWith(".css"))
    .map((file) => read(file).replace(/\/\*[\s\S]*?\*\//g, ""))
    .find((css) => /\.rs-widget\s*\{[^}]*display:\s*contents/.test(css));

  assert.ok(
    rule,
    "a stylesheet reachable from widget.tsx must set .rs-widget { display: contents } — without it the " +
      "wrapper becomes the grid item, the panel's .rw-w* spans land on a child the grid cannot read, " +
      "and every panel collapses to one column of twelve",
  );
});

test("a structural rule has exactly one home, and it is the component's own stylesheet", () => {
  /**
   * The guard's own guard, and the reason the table above cannot pass by
   * accident. A rule duplicated into a page-level sheet would satisfy the route
   * check while leaving the component still unable to stand on its own — the
   * arrangement that shipped that page broken. So each structural rule is
   * required to be defined once, in the stylesheet its component imports.
   *
   * This is also what stops the tempting non-fix: adding `import shell.css` to
   * a page makes that page work and teaches the codebase nothing.
   */
  const owners = [
    ["rs-widget", "shell/widget.css", "shell/widget.tsx"],
    ["rs-status", "shell/status-chip.css", "shell/status-chip.tsx"],
  ];

  for (const [cls, sheet, component] of owners) {
    const sheetPath = resolve(APP, sheet);
    assert.ok(existsSync(sheetPath), `${sheet} exists`);
    assert.ok(
      graphFrom([resolve(APP, component)]).has(sheetPath),
      `${component} must import ${sheet}, so the rule travels with every consumer`,
    );

    const definers = [];
    (function walk(directory) {
      for (const name of readdirSync(directory)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const full = resolve(directory, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(".css") && !full.endsWith(".module.css") && definedIn(full).has(cls)) definers.push(rel(full));
      }
    })(APP);

    assert.deepEqual(
      definers.sort(),
      [rel(sheetPath)],
      `.${cls} must be defined only in ${sheet}; a second definition makes the component's ` +
        `independence accidental and the next page to render it outside its usual home breaks again`,
    );
  }
});
