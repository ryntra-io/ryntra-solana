// Run from repo root: node --test app/brand/no-placeholder-mark.test.mjs
//
// SOL-C3: every page outside the shell carries the real
// Ryntra mark from app/brand/, never an «R» in a square. The walk starts at every route file of line A outside the
// shell — pages, layouts, loading, not-found and error screens, route handlers that answer with a page — follows each
// one's own imports and fails on a lettered placeholder anywhere on the way. The pages the owner named — the payment
// link and the credits it sells (`/pay/<id>`), its «not found», the short launch address (`/t/…`) — must also reach
// the brand itself.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/* Not walked: the shells draw the core's header with the brand (app/app, the Solana workspace); the admin's frame is an
   internal tool that names itself in text; `/api` answers with data; `/r` and `/promo` are the Growth line's (Ріст 19).
   Every other route of the tree is walked — the other lines' pages draw no tile either, and a tile there would fail here. */
const OUTSIDE = ["app/app/", "app/solana/workspace/", "app/admin/", "app/api/", "app/r/", "app/promo/"];
const ROUTE_FILE = /^(page|layout|loading|not-found|error|global-error|template|route|opengraph-image|twitter-image|icon|apple-icon)\.(tsx|ts)$/;

function routeFiles(dir = "app") {
  const found = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const path = `${dir}/${entry}`;
    if (OUTSIDE.some((prefix) => `${path}/`.startsWith(prefix))) continue;
    if (statSync(join(ROOT, path)).isDirectory()) found.push(...routeFiles(path));
    else if (ROUTE_FILE.test(entry)) found.push(path);
  }
  return found;
}

/* Comments say what a file once drew («a boxed "R"»); only code may fail the walk. Strings are kept whole, so a «/*»
   or «//» inside one (a glob, an address) never swallows the code after it. */
const LEXEME = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const code = (source) => source.replace(LEXEME, (match, string) => string ?? " ");

const PLACEHOLDERS = [
  [/>\s*R\s*<\//, "a lone «R» set as a tag's text"],
  [/\{\s*["'`]R["'`]\s*\}/, "a lone «R» set as a JSX string"],
  [/content:\s*["']R["']/, "a lone «R» drawn by CSS"],
  [/["']Ryntra["']\s*(?:\.slice\(\s*0\s*,\s*1\s*\)|\.charAt\(\s*0\s*\)|\[\s*0\s*\])/, "the first letter of «Ryntra» standing in for the mark"],
];

const placeholderIn = (source) => PLACEHOLDERS.find(([pattern]) => pattern.test(code(source)))?.[1] ?? null;

const SPECIFIER = /(?:from\s+|import\s+|import\(\s*)["']([^"']+)["']/g;
const EXTENSIONS = ["", ".tsx", ".ts", ".mjs", ".js", "/index.tsx", "/index.ts"];

function resolveImport(from, specifier) {
  const base = specifier.startsWith("@/") ? join(ROOT, specifier.slice(2)) : specifier.startsWith(".") ? resolve(dirname(join(ROOT, from)), specifier) : null;
  if (!base) return null;
  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (existsSync(candidate) && statSync(candidate).isFile()) return relative(ROOT, candidate).split("\\").join("/");
  }
  return null;
}

const sources = new Map();
const read = (path) => {
  if (!sources.has(path)) sources.set(path, readFileSync(join(ROOT, path), "utf8"));
  return sources.get(path);
};

/** Every local file a route reaches through its imports, itself first. */
function graph(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const path = queue.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    if (!/\.(tsx|ts|mjs|js)$/.test(path)) continue;
    for (const [, specifier] of code(read(path)).matchAll(SPECIFIER)) {
      const next = resolveImport(path, specifier);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

test("the detector knows the retired tile and passes the brand", () => {
  assert.ok(placeholderIn(`<span className={styles.brandMark} aria-hidden>R</span>`), "the «R» tile the payment page drew until SOL-C3");
  assert.ok(placeholderIn(`<div style={{ borderRadius: 8 }}>{"R"}</div>`));
  assert.ok(placeholderIn(`.mark::before { content: "R"; }`));
  assert.ok(placeholderIn(`const glyph = "Ryntra".slice(0, 1);`));
  assert.equal(placeholderIn(read("app/brand/ryntra-brand.tsx")), null, "the brand component itself draws the traced mark");
  assert.equal(placeholderIn(`/* the payer page once drew a boxed "R" */ <RyntraBrand size={22} />`), null, "a comment is not a drawing");
  assert.equal(placeholderIn(`draw(); // was <span>R</span>`), null, "a trailing comment is not a drawing");
  assert.ok(placeholderIn(`const glob = "@sentry/*"; <i>R</i>`), "a «/*» inside a string hides no code");
});

test("no line-A route outside the shell draws an «R» in a square, through any of its imports", () => {
  const routes = routeFiles();
  for (const named of ["app/pay/[id]/page.tsx", "app/pay/[id]/not-found.tsx", "app/t/[slug]/route.ts", "app/t/[slug]/[code]/route.ts", "app/uk/t/[slug]/route.ts"]) {
    assert.ok(routes.includes(named), `the walk covers ${named}`);
  }
  const failures = [];
  for (const route of routes) {
    for (const path of graph(route)) {
      const found = placeholderIn(read(path));
      if (found) failures.push(`${route} → ${path}: ${found}`);
    }
  }
  assert.deepEqual(failures, [], "a page outside the shell draws the mark from app/brand/, never a lettered tile");
});

test("the payment link, the credits it sells and its «not found» carry the brand from app/brand/", () => {
  /* The assistant's credits are bought on the same `/pay/<id>` page (AI-12): one page, one identity. */
  assert.match(code(read("lib/assistant/credits/order-view.ts")), /\/pay\/\$\{/, "credits are paid on the payment page");
  for (const route of ["app/pay/[id]/page.tsx", "app/pay/[id]/not-found.tsx"]) {
    assert.ok(graph(route).has("app/brand/ryntra-brand.tsx"), `${route} renders the brand lockup`);
  }
  const brand = code(read("app/pay/pay-brand.tsx"));
  assert.match(brand, /<RyntraBrand size=\{\d+\} \/>/);
  assert.match(code(read("app/pay/[id]/pay-client.tsx")), /<PayBrand \/>/, "the payer page's header is the brand");
  assert.match(code(read("app/pay/[id]/not-found.tsx")), /<PayBrand \/>/, "a wrong link still says whose page it is");
  assert.doesNotMatch(read("app/pay/pay.module.css"), /\.brandMark\b/, "the tile's style is gone with it");
});

test("the short launch address's preview names Ryntra with the brand lockup and icon", () => {
  const serve = code(read("app/t/serve.ts"));
  assert.match(serve, /const BRAND_LOCKUP = "\/brand\/ryntra-wordmark-light\.svg"/);
  assert.ok(existsSync(join(ROOT, "public/brand/ryntra-wordmark-light.svg")), "the lockup the preview names is published");
  assert.match(serve, /<img src="\$\{BRAND_LOCKUP\}" alt="Ryntra"/, "a path on the page's own host: its CSP takes images from itself only");
  assert.match(serve, /<link rel="icon" href="\/brand\/favicon\.svg"/);
  /* The card the preview points at draws the wordmark, never a lettered box. */
  assert.match(read("app/brand/launch-og.tsx"), /WORDMARK_DARK_UI_DATA_URI/);
});
