import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/*
 * The site's faces are files in the repository, and the build asks nobody for a font: a face fetched from
 * Google Fonts at build time made every build depend on Google's answer. These tests keep next/font's Google loader out
 * of the build and hold every face to what it replaced — the same variables, families, scripts, ranges, preloads and
 * fallbacks (`./README.md`).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const FILES = join(HERE, "files");
const read = (path) => readFileSync(path, "utf8");
const rel = (path) => relative(ROOT, path).split(sep).join("/");

/* The build's tree: what tsconfig takes in (everything but `node_modules`, `apps` and `output`), without the build's
   own output and git. */
const SKIP = new Set(["node_modules", ".git", "apps", "output"]);
function walk(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith(".next")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, found);
    else if (/\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name)) found.push(path);
  }
  return found;
}
const CODE = walk(ROOT);

/* A module that loads a face from Google, in any of the ways a module can name one. */
const GOOGLE_LOADER = /(?:\bfrom|\bimport|\brequire\s*\()\s*\(?\s*["']next\/font\/google["']/;

test("no module in the build's tree loads a face from Google Fonts", () => {
  assert.ok(CODE.length > 1000, `the walk found the tree (${CODE.length} modules)`);
  const offenders = CODE.filter((path) => GOOGLE_LOADER.test(read(path))).map(rel);
  assert.deepEqual(offenders, [], "next/font's Google loader fetches at build time; a face is a file in app/fonts/files");
});

/** Every `localFont({ … })` call of a module: its name and the options it was written with. */
function localFaces(path) {
  const source = read(path);
  if (!/from\s*["']next\/font\/local["']/.test(source)) return [];
  const faces = [];
  for (const match of source.matchAll(/const\s+(\w+)\s*=\s*localFont\(/g)) {
    let depth = 0;
    let end = match.index + match[0].length - 1;
    for (; end < source.length; end++) {
      if (source[end] === "(") depth++;
      else if (source[end] === ")" && --depth === 0) break;
    }
    const body = source.slice(match.index, end);
    const declared = (prop) => new RegExp(`prop:\\s*["']${prop}["'],\\s*value:\\s*["']([^"']+)["']`).exec(body)?.[1] ?? null;
    faces.push({
      module: rel(path),
      name: match[1],
      variable: /variable:\s*["']([^"']+)["']/.exec(body)?.[1] ?? null,
      family: declared("font-family"),
      range: declared("unicode-range"),
      stretch: declared("font-stretch"),
      weight: /^\s*weight:\s*["']([^"']+)["']/m.exec(body)?.[1] ?? null,
      weights: [...body.matchAll(/path:\s*["'][^"']+["'],\s*weight:\s*["'](\d+)["']/g)].map((m) => m[1]),
      preload: !/preload:\s*false/.test(body),
      adjustFallback: !/adjustFontFallback:\s*false/.test(body),
      fallback: /fallback:\s*\[([^\]]*)\]/.exec(body)?.[1].trim() ?? null,
      files: [...new Set([...body.matchAll(/["'](\.\/[^"']+\.woff2)["']/g)].map((m) => join(dirname(path), m[1])))],
    });
  }
  return faces;
}
const FACES = CODE.flatMap(localFaces);

/* Google's ranges for the two scripts, the same for every family in its stylesheet. */
const LATIN = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const CYRILLIC = "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116";

/*
 * What each face replaced: the family and variable of the call to Google's loader, the scripts it served, what it
 * preloaded (the `subsets` it named) and its weights. A face carrying a variable gives it what Google's gave it:
 * `'<family>', '<family> Fallback'`.
 */
const EXPECTED = [
  { module: "app/fonts/root.ts", family: "Geist", script: "latin", variable: "--font-geist", preload: true, weight: "100 900" },
  { module: "app/fonts/root.ts", family: "Geist", script: "cyrillic", variable: null, preload: true, weight: "100 900" },
  { module: "app/fonts/root.ts", family: "Geist Mono", script: "latin", variable: "--font-geist-mono", preload: true, weights: ["400", "500", "600"] },
  { module: "app/fonts/root.ts", family: "Geist Mono", script: "cyrillic", variable: null, preload: true, weights: ["400", "500", "600"] },
  { module: "app/fonts/root.ts", family: "Unbounded", script: "latin", variable: "--font-sora", preload: true, weights: ["400", "600", "700"] },
  { module: "app/fonts/root.ts", family: "Unbounded", script: "cyrillic", variable: null, preload: false, weights: ["400", "600", "700"] },
  { module: "app/fonts/city.ts", family: "Hubot Sans", script: "latin", variable: "--font-display", preload: true, weight: "200 900", stretch: "75% 125%" },
  { module: "app/fonts/city.ts", family: "Mona Sans", script: "latin", variable: "--font-ui", preload: true, weight: "200 900", stretch: "75% 125%" },
  { module: "app/fonts/landing.ts", family: "Onest", script: "latin", variable: "--font-geist", preload: true, weight: "100 900" },
  { module: "app/fonts/landing.ts", family: "Onest", script: "cyrillic", variable: null, preload: false, weight: "100 900" },
  { module: "app/fonts/landing.ts", family: "IBM Plex Mono", script: "latin", variable: "--font-geist-mono", preload: true, weights: ["400", "500", "600"] },
  { module: "app/fonts/landing.ts", family: "IBM Plex Mono", script: "cyrillic", variable: null, preload: false, weights: ["400", "500", "600"] },
  { module: "app/fonts/lab.ts", family: "Inter", script: "latin", variable: "--font-agg-inter", preload: true, weights: ["400", "500", "600", "700"] },
  { module: "app/fonts/lab.ts", family: "Inter", script: "cyrillic", variable: null, preload: false, weights: ["400", "500", "600", "700"] },
];
const SITE_FACES = FACES.filter((face) => face.module.startsWith("app/fonts/"));

test("every face stands as the one it replaced: family, script, range, weights, preload, fallback", () => {
  assert.equal(SITE_FACES.length, EXPECTED.length, SITE_FACES.map((face) => `${face.module} ${face.name}`).join(", "));
  const fallbacks = read(join(HERE, "fallbacks.css"));
  for (const want of EXPECTED) {
    const range = want.script === "latin" ? LATIN : CYRILLIC;
    const face = SITE_FACES.find((f) => f.module === want.module && f.family === want.family && f.range === range);
    const label = `${want.family} (${want.script}) in ${want.module}`;
    assert.ok(face, `${label} is declared, with Google's range for its script`);
    assert.equal(face.variable, want.variable, `${label}: variable`);
    assert.equal(face.preload, want.preload, `${label}: preloaded as Google preloaded it`);
    if (want.weight) assert.equal(face.weight, want.weight, `${label}: weight range`);
    if (want.weights) assert.deepEqual(face.weights, want.weights, `${label}: one face per weight, as Google declared them`);
    assert.equal(face.stretch, want.stretch ?? null, `${label}: width range`);
    assert.ok(face.files.every((file) => rel(file).includes(want.script)), `${label}: its files are its script's`);
    assert.equal(face.adjustFallback, false, `${label}: the fallback is Google's, not one computed from the file`);
    if (want.variable) {
      assert.equal(face.fallback, `"'${want.family} Fallback'"`, `${label}: the variable reads '${want.family}', '${want.family} Fallback'`);
      const block = new RegExp(`@font-face \\{\\s*font-family: '${want.family} Fallback';\\s*src: local\\("Arial"\\);[^}]*size-adjust: [\\d.]+%;\\s*\\}`);
      assert.match(fallbacks, block, `${label}: fallbacks.css declares '${want.family} Fallback'`);
    } else {
      assert.equal(face.fallback, null, `${label}: a script's second face adds no fallback`);
    }
  }
});

/* Font variables read with no face behind them, before the move to local files as after: each is read with a fallback inside its
   `var()` (or is the hub's known-unresolved `--font-space-grotesk`), and none was ever a face's. The list only shrinks. */
const NEVER_A_FACE = new Set(["--font-geist-sans", "--font-mono", "--font-sans", "--font-space-grotesk"]);

test("every font variable a stylesheet reads is carried by a local face", () => {
  const sheets = CODE.filter((path) => /^(?:app|city|terminal|lib)\//.test(rel(path)))
    .concat(walkStyles(join(ROOT, "app")), walkStyles(join(ROOT, "city")), walkStyles(join(ROOT, "terminal")), walkStyles(join(ROOT, "lib")));
  const read_ = new Set();
  const aliases = new Map();
  for (const path of sheets) {
    const source = read(path).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, name] of source.matchAll(/var\(\s*(--font-[\w-]+)/g)) read_.add(name);
    if (path.endsWith(".css")) for (const [, name, target] of source.matchAll(/(--font-[\w-]+)\s*:\s*var\(\s*(--font-[\w-]+)/g)) aliases.set(name, target);
  }
  const carried = new Set(FACES.map((face) => face.variable).filter(Boolean));
  assert.ok(carried.has("--font-geist") && carried.has("--font-display") && carried.has("--font-zero"), "the faces were read");

  const orphans = [...read_].filter((name) => !carried.has(name) && !carried.has(aliases.get(name)) && !NEVER_A_FACE.has(name));
  assert.deepEqual(orphans, [], "a font variable a stylesheet reads has no local face behind it");
  for (const name of NEVER_A_FACE) {
    assert.ok(read_.has(name), `${name} is read nowhere any more: take it off the list`);
    assert.ok(!carried.has(name), `${name} has a face now: take it off the list`);
  }
});

function walkStyles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkStyles(path, found);
    else if (entry.name.endsWith(".css")) found.push(path);
  }
  return found;
}

test("each file is the package's own, as the README's table records it, with its licence beside it", () => {
  const readme = read(join(HERE, "README.md"));
  const table = new Map([...readme.matchAll(/^\| `([\w.-]+\.woff2)` \| `(@[\w/-]+@[\d.]+)` \| `([0-9a-f]{64})` \|$/gm)].map((m) => [m[1], { pkg: m[2], sha: m[3] }]));
  const files = readdirSync(FILES).filter((name) => name.endsWith(".woff2")).sort();
  assert.deepEqual([...table.keys()].sort(), files, "the table lists every file, and nothing else");
  for (const name of files) {
    const sha = createHash("sha256").update(readFileSync(join(FILES, name))).digest("hex");
    assert.equal(sha, table.get(name).sha, `${name} is unchanged from ${table.get(name).pkg}`);
  }

  const used = new Set(SITE_FACES.flatMap((face) => face.files.map((file) => rel(file))));
  assert.deepEqual(files.filter((name) => !used.has(`app/fonts/files/${name}`)), [], "every file is loaded by a face");
  for (const file of used) assert.ok(existsSync(join(ROOT, file)) && statSync(join(ROOT, file)).size > 1000, `${file} is there`);

  const licences = { Geist: "OFL-Geist.txt", "Geist Mono": "OFL-GeistMono.txt", Unbounded: "OFL-Unbounded.txt", "Hubot Sans": "OFL-HubotSans.txt", "Mona Sans": "OFL-MonaSans.txt", Onest: "OFL-Onest.txt", "IBM Plex Mono": "OFL-IBMPlexMono.txt", Inter: "OFL-Inter.txt" };
  for (const family of new Set(SITE_FACES.map((face) => face.family))) {
    const licence = join(FILES, licences[family] ?? `OFL-${family}.txt`);
    assert.ok(existsSync(licence), `${family} has its licence beside its files`);
    assert.match(read(licence), /SIL OPEN FONT LICENSE Version 1\.1/, `${family}: the SIL Open Font License 1.1`);
  }
});

test("the city's faces borrow the root's Cyrillic, not a copy of it", () => {
  const city = read(join(ROOT, "city", "styles", "fonts.ts"));
  assert.match(city, /from '@\/app\/fonts\/city'/);
  assert.match(city, /import \{ geistCyrillic as cyrillic \} from '@\/app\/fonts\/root'/);
  assert.ok(!/localFont|next\/font/.test(city.replace(/\/\*[\s\S]*?\*\//g, "")), "the city declares no face of its own");
});
