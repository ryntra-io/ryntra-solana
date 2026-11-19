import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/* One page for every section.
   Two kinds of page and nothing else — an action page, one container in the middle of the working area, and a desk,
   the whole working width — built from the kit's `Page`, `PageHead` and `ActionBody` (terminal/ui/Page.tsx). This
   file holds it:

   - every section's screen mounts `Page` of its kind, with `PageHead`; every page of the terminal's frame draws one of
     these screens, so a new section is named here first;
   - the page's measures (`--page`, `--page-main`, `--page-side`) are written in the kit alone, and add up: the action
     column, the gap and the side column are the page's width;
   - a screen's sheet writes no width, place or height of a page of its own.

   The screens not yet on the template and the sheets that still size a page of their own are closed lists that only
   get shorter. */

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(join(REPO, path), "utf8");

/* A screen's category decides its page:
   - a form — one coin, one action, no chart (Swap, Bridge, a launch, recurring buys, a ladder) — the page «action»;
   - a cabinet — the person's own and a section's catalogue (Agents, Portfolio, Rewards) — the page «action»;
   - a terminal with a chart — the price chart is the screen's main part (the Spot, the Grid) — the page «desk»;
   - a list — a table of the market — the page «desk». */
const KIND_OF = { form: "action", cabinet: "action", chart: "desk", list: "desk" };

/** Every section's screen and its category. */
const SCREENS = {
  "terminal/swap/SwapScreen.tsx": "form",
  "terminal/swap/BridgeScreen.tsx": "form",
  "terminal/launch/LaunchScreen.tsx": "form",
  "terminal/earn/EarnScreen.tsx": "list",
  "terminal/agents/AgentsScreen.tsx": "cabinet",
  "terminal/bots/BotsScreen.tsx": "form",
  "terminal/bots/GridScreen.tsx": "chart",
  "terminal/portfolio/PortfolioScreen.tsx": "cabinet",
  "terminal/money/MoneyScreen.tsx": "form",
  "terminal/rewards/RewardsScreen.tsx": "cabinet",
  "terminal/portfolio/private/ClaimScreen.tsx": "form",
  "terminal/portfolio/private/WalletCheckScreen.tsx": "form",
  "terminal/market/MarketScreen.tsx": "list",
  "terminal/coin/CoinScreen.tsx": "chart",
  "terminal/pool/ProScreen.tsx": "list",
  "terminal/pool/PoolScreen.tsx": "chart",
};

/* The screens that have not moved onto the template yet. The list only gets shorter: a screen on it that mounts `Page`
   asks to be taken off. */
const NOT_YET = new Set([]);

/** A screen's code without its comments: a word in a comment mounts nothing. */
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}|(^|[^:])\/\/.*$/gm, "$1");

test("every section's screen mounts the page of its kind; an action page with its head and its body", () => {
  const wrong = [];
  for (const [path, category] of Object.entries(SCREENS)) {
    const kind = KIND_OF[category];
    if (!kind) {
      wrong.push(`${path}: no category «${category}» — a form, a cabinet, a chart or a list`);
      continue;
    }
    const source = code(path);
    const mounted = /<Page[\s>]/.test(source);
    if (NOT_YET.has(path)) {
      if (mounted) wrong.push(`${path}: on the template now — take it off NOT_YET`);
      continue;
    }
    if (!mounted) {
      wrong.push(`${path}: mounts no <Page>`);
      continue;
    }
    const pages = [...source.matchAll(/<Page(\s[^>]*)?>/g)].map((m) => m[1] ?? "");
    if (pages.length !== 1) wrong.push(`${path}: ${pages.length} pages — a screen is one page`);
    for (const props of pages) {
      if (/\bkind=\{/.test(props)) wrong.push(`${path}: the page's kind is said in words — kind="desk" or none`);
      const said = /\bkind="desk"/.test(props) ? "desk" : "action";
      if (said !== kind) wrong.push(`${path}: a «${said}» page, the template says «${kind}»`);
    }
    if (kind === "action") {
      // An action page names its section at its head and lays its content in the page's columns.
      if (!/<PageHead[\s>]/.test(source)) wrong.push(`${path}: its page has no <PageHead>`);
      if (!/<ActionBody[\s>]/.test(source)) wrong.push(`${path}: its page lays nothing in <ActionBody>`);
    }
    // The Bridge's stage — a page of its own, centred in the screen's height — is not the template's.
    if (/\b\w+\.stage\b/.test(source)) wrong.push(`${path}: draws a stage of its own inside the page`);
  }
  assert.deepEqual(wrong, []);
});

/* A section's head stands in one place on every tab. A section is a folder of SCREENS; where its tabs mix a desk
   and an action page, every action page of it says `head="desk"` — its head on the desk's line, only its content in
   the middle — and no other action page does. */
test("a section whose tabs mix a desk and action pages holds its head on the desk's line on every tab", () => {
  const sections = new Map();
  for (const [path, category] of Object.entries(SCREENS)) {
    const dir = posix.dirname(path);
    sections.set(dir, [...(sections.get(dir) ?? []), { path, kind: KIND_OF[category] }]);
  }
  const wrong = [];
  for (const screens of sections.values()) {
    const mixed = new Set(screens.map((screen) => screen.kind)).size > 1;
    for (const { path, kind } of screens) {
      if (kind !== "action") continue;
      const props = code(path).match(/<Page(\s[^>]*)?>/)?.[1] ?? "";
      const said = /\bhead="desk"/.test(props);
      if (mixed && !said) wrong.push(`${path}: its section has a desk — its head stands on the desk's line (head="desk")`);
      if (!mixed && said) wrong.push(`${path}: head="desk" with no desk in its section`);
    }
  }
  assert.deepEqual(wrong, []);
  const kit = read("terminal/ui/ui.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(kit, /\.page\[data-page='action'\]\[data-head='desk'\] \{\s*max-width: none;\s*margin-inline: 0;\s*\}/, "the page runs the working width as a desk");
  assert.match(kit, /\.page\[data-head='desk'\] > :not\(\.pageHead\) \{\s*width: 100%;\s*max-width: var\(--page\);\s*margin-inline: auto;\s*\}/, "only what is under the head keeps the action's container, in the middle");
  assert.match(read("terminal/ui/Page.tsx"), /data-head=\{kind === 'action' \? head : undefined\}/);
});

/** The files a screen draws: its own, and the terminal's files it imports — by `@/terminal/…`, `./` or `../` — as deep as they go. */
function drawn(path, seen = new Set()) {
  if (seen.has(path)) return seen;
  seen.add(path);
  const source = code(path);
  const dir = posix.dirname(path);
  for (const [, spec] of source.matchAll(/(?:from\s+|import\()\s*['"]([^'"]+)['"]/g)) {
    const base = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? posix.normalize(posix.join(dir, spec)) : null;
    if (!base || !base.startsWith("terminal/")) continue;
    const file = [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`].find((one) => /\.(tsx?)$/.test(one) && existsSync(join(REPO, one)));
    if (file && !file.startsWith("terminal/ui/")) drawn(file, seen);
  }
  return seen;
}

test("a screen that draws the price chart is a terminal with a chart — a desk; a form never draws it", () => {
  const wrong = [];
  for (const [path, category] of Object.entries(SCREENS)) {
    const charts = [...drawn(path)].some((file) => file === "terminal/coin/CoinChart.tsx");
    if (charts && category !== "chart") wrong.push(`${path}: draws the price chart in a «${category}» — a chart's screen is a desk`);
    if (!charts && category === "chart") wrong.push(`${path}: a «chart» screen with no chart`);
  }
  assert.deepEqual(wrong, []);
});

test("each bot's page is its category's: the grid a desk, the forms the section's action page", async () => {
  const { BOT_PAGE } = await import("../bots/kinds.ts");
  const frame = read("app/(terminal)/bots/grid/page.tsx");
  assert.match(frame, /<GridScreen \/>/, "the grid's address draws the grid's desk");
  for (const [bot, category] of Object.entries(BOT_PAGE)) {
    const page = read(`app/(terminal)/bots/${bot}/page.tsx`);
    const screen = category === "chart" ? "GridScreen" : "BotsScreen";
    assert.match(page, new RegExp(`<${screen}[\\s/>]`), `${bot}: a «${category}» bot is drawn by ${screen}`);
  }
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

test("every page of the terminal's frame draws one of the section screens", () => {
  const frame = join(REPO, "app/(terminal)");
  const pages = walk(frame).filter((path) => /[\\/]page\.tsx$/.test(path) && !/[\\/]terminal[\\/]kit[\\/]/.test(path));
  assert.ok(pages.length >= 8, "the frame's pages are read");
  const wrong = [];
  for (const path of pages) {
    const source = readFileSync(path, "utf8");
    const screens = [...source.matchAll(/from "@\/(terminal\/[^"]+)"/g)].map((m) => `${m[1]}.tsx`).filter((file) => /Screen\.tsx$/.test(file));
    if (!screens.length || screens.some((file) => !(file in SCREENS))) wrong.push(`${relative(REPO, path)}: draws ${screens.join(", ") || "no section screen"} — name it in SCREENS`);
  }
  assert.deepEqual(wrong, []);
});

test("the page's measures are the kit's alone, and they add up", () => {
  const root = read("terminal/styles/terminal.module.css");
  const px = (name) => Number(root.match(new RegExp(`--${name}: (\\d+)px;`))?.[1]);
  const [page, main, side] = [px("page"), px("page-main"), px("page-side")];
  assert.ok(page && main && side, "the root names the page's measures");
  const kit = read("terminal/ui/ui.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const body = kit.match(/\.actionBody \{([^}]*)\}/)?.[1] ?? "";
  const gap = Number(body.match(/gap: (\d+)px/)?.[1]);
  assert.match(body, /grid-template-columns: minmax\(0, var\(--page-main\)\) var\(--page-side\)/);
  assert.equal(main + gap + side, page, "the action column, the gap and the side column are the page's width");

  const sheets = walk(join(REPO, "terminal"))
    .filter((path) => path.endsWith(".css") && !/[\\/]terminal[\\/](ui|styles)[\\/]/.test(path))
    .filter((path) => /var\(--page(-main|-side)?\)/.test(readFileSync(path, "utf8")))
    .map((path) => relative(REPO, path).split("\\").join("/"));
  assert.deepEqual(sheets, [], "a screen takes the page's measures through the kit's parts, never by name");
});

/* A page's own size in a screen's sheet: a width of a page (640 px — or 40 rem — and more, or any part of the screen's
   width in `vw`) or a height of the screen (`vh`, `dvh`). The sheets that still write one, with how many — the list
   only gets shorter. */
const PAGE_SIZE = {};

test("a screen's sheet writes no width, place or height of a page of its own", () => {
  const counted = {};
  const screens = walk(join(REPO, "terminal")).filter((path) => path.endsWith(".css") && !/[\\/]terminal[\\/](ui|styles|shell)[\\/]/.test(path));
  for (const path of screens) {
    const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const name = relative(REPO, path).split("\\").join("/");
    for (const [, body] of css.matchAll(/[^{}]+\{([^{}]*)\}/g)) {
      // What floats over the page — a menu, a panel at the window's edge — measures itself by the window, not the page.
      if (/(?:^|;)\s*position\s*:\s*(fixed|absolute)/.test(body)) continue;
      for (const [, prop, value] of body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;]+)/g)) {
        const lengths = [...value.matchAll(/(\d*\.?\d+)(px|rem)\b/g)].map((m) => Number(m[1]) * (m[2] === "rem" ? 16 : 1));
        const wide = /^(max-|min-)?width$/.test(prop) && (lengths.some((px) => px >= 640) || /\d+s?vw\b/.test(value));
        const tall = /^(min-)?height$/.test(prop) && /\d+d?vh\b/.test(value);
        if (wide || tall) counted[name] = (counted[name] ?? 0) + 1;
      }
    }
  }
  const wrong = [];
  for (const [path, n] of Object.entries(counted)) {
    const allowed = PAGE_SIZE[path];
    if (allowed === undefined) wrong.push(`${path}: ${n} page size(s) of its own — the page is the kit's (Page, ActionBody)`);
    else if (n > allowed) wrong.push(`${path}: ${n}, the list allows ${allowed}`);
    else if (n < allowed) wrong.push(`${path}: down to ${n} — lower its count here`);
  }
  for (const path of Object.keys(PAGE_SIZE)) if (!counted[path]) wrong.push(`${path}: none now — take it off the list`);
  assert.deepEqual(wrong, []);
});
