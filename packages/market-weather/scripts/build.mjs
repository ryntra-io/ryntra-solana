/**
 * Build without dependencies: Node's own type stripping turns each `src/**\/*.ts` into `dist/**\/*.js` (ES modules for
 * npm), and the embed files into one script, `dist/market-weather-city.js`, that a page or a WebView loads with a
 * single <script> tag.
 *
 *   node scripts/build.mjs
 *
 * The sources use erasable TypeScript only, so stripping is the whole compilation; a source that is not erasable
 * fails here, loudly.
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const src = join(root, "src");
const dist = join(root, "dist");

const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
const strip = (file) => stripTypeScriptTypes(readFileSync(file, "utf8"), { mode: "strip" });

for (const file of walk(src).filter((path) => path.endsWith(".ts"))) {
  const out = join(dist, relative(src, file)).replace(/\.ts$/, ".js");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, strip(file).replace(/(from\s+["']\.{1,2}\/[^"']+)\.ts(["'])/g, "$1.js$2"));
}

/* The one-file embed: the three embed modules in dependency order, imports dropped, exports unwrapped, one scope. */
const parts = ["embed/layout.ts", "embed/city.ts", "embed/index.ts"].map((path) =>
  strip(join(src, path))
    .split("\n")
    .filter((line) => !/^\s*import\s.*from\s+["'][^"']+["'];?\s*$/.test(line) && !/^\s*export\s*\{[^}]*\}(\s*from\s*["'][^"']+["'])?;?\s*$/.test(line))
    .map((line) => line.replace(/^export\s+(?=(const|function|class|let|async)\b)/, ""))
    .join("\n"),
);
const bundle = `/*! Market Weather city embed · Apache-2.0 · https://github.com/ryntra-io/ryntra */\n(() => {\n"use strict";\n${parts.join("\n")}\n})();\n`;
new Function(bundle); // parses, or throws here rather than in someone's WebView
writeFileSync(join(dist, "market-weather-city.js"), bundle);
console.log(`built ${relative(root, dist)}/ and dist/market-weather-city.js (${bundle.length} bytes before gzip)`);
