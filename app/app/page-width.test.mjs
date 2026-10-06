import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

/*
 * DESIGN.md → «Page width»: the canvas is the page's width. A cabinet page
 * that caps itself leaves the rest of a wide screen empty — «Мої лаунчі» at
 * 2560 px with two thirds of it bare is what this rule exists for. A cap of
 * a desk's width (700 px or more) in the cabinet's styles fails here unless
 * its line says why with a `width-law:` comment; the rendered page is
 * measured by scripts/width-qa/measure.mjs.
 */

const ROOTS = ["app/app", "app/shell", "app/solana/workspace"];
/* The Growth line's own paths: its pages answer to the same law through its handoff. */
const GROWTH = [/^app\/app\/rewards\//, /^app\/solana\/workspace\/rewards\//];
const DESK = 700;

function cssFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

/* A kept cap says why in words, not with an empty or token reason. */
const REASON = /width-law:\s*\S.{8,}/;

/**
 * Every `max-width` / `max-inline-size` declaration with its widest fixed length in px (inside `min()`, `clamp()` or
 * `calc()` too), with its line — never a media or container query's condition, never a commented-out line.
 */
export function caps(source) {
  const found = [];
  /* Comments blanked across lines (their newlines kept, so line numbers hold); the reason is read from the original line. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " ")).split("\n");
  source.split("\n").forEach((line, index) => {
    const excused = REASON.test(line);
    /* A query's condition is not a declaration — a one-line `@media (…) { .x { … } }` keeps its declarations. */
    const declarations = code[index].replace(/@(media|container)[^{]*/g, "");
    for (const match of declarations.matchAll(/(?<![-\w])max-(?:width|inline-size)\s*:\s*([^;}]+)/g)) {
      const lengths = [...match[1].matchAll(/([\d.]+)(px|rem|em)\b/g)].map(([, n, unit]) => Number(n) * (unit === "px" ? 1 : 16));
      if (lengths.length) found.push({ line: index + 1, px: Math.max(...lengths), text: line.trim(), excused });
    }
  });
  return found;
}

test("a cap is read from a declaration, never from a query's condition or a comment", () => {
  assert.deepEqual(
    caps(
      [
        ".a { max-width: 1200px; }",
        "@media (max-width: 1279px) {",
        "  .b { max-width: 42rem; }",
        "}",
        ".c { max-width: 720px; /* width-law: a single action's card */ }",
        ".d { max-inline-size: min(100%, 1100px); }",
        "/* .e { max-width: 1400px; } */",
        ".f { max-width: 900px; /* width-law: */ }",
        "/*",
        "  .g { max-width: 1300px; }",
        "*/",
        "@media (min-width: 1600px) { .h { max-width: 1500px; } }",
      ].join("\n"),
    ).map(({ line, px, excused }) => ({ line, px, excused })),
    [
      { line: 1, px: 1200, excused: false },
      { line: 3, px: 672, excused: false },
      { line: 5, px: 720, excused: true },
      { line: 6, px: 1100, excused: false },
      { line: 8, px: 900, excused: false },
      { line: 12, px: 1500, excused: false },
    ],
  );
});

test("no cabinet page caps itself below the canvas", () => {
  const offenders = [];
  for (const root of ROOTS) {
    for (const file of cssFiles(root)) {
      const path = relative(".", file).replaceAll("\\", "/");
      if (GROWTH.some((pattern) => pattern.test(path))) continue;
      for (const cap of caps(readFileSync(file, "utf8").replace(/\r\n/g, "\n"))) {
        if (cap.px >= DESK && !cap.excused) offenders.push(`${path}:${cap.line} ${cap.text}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "A page takes the canvas's width (DESIGN.md → «Page width»); a kept cap says why with `width-law:`.");
});
