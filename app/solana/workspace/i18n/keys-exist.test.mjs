import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { SOLANA_UK_TEXT } from "./catalog.ts";

/**
 * Every sentence this workspace can render must have a Ukrainian pair.
 *
 * `translateSolana` throws on a missing key rather than falling back, which is
 * the right choice — a silent English fallback is how a half-translated product
 * ships and nobody notices. The cost of that choice is that an unpaired string
 * is a 500 for every Ukrainian visitor of the surface that renders it, and it is
 * invisible in English.
 *
 * It has already been paid twice. `/settings` and `/map` were once error pages
 * in Ukrainian because fifteen catalogue keys had never been written, and a
 * later change to History was one `text("Export")` away from doing it again.
 *
 * The parity test beside this one asks whether copy goes *through* the
 * translation boundary. This one asks whether the boundary can answer, which is
 * a different question and the one that produces the 500.
 */

const ROOT = "app/solana/workspace";

/** Only literal calls: a variable or template is not a key this can check. */
const LITERAL_TEXT_CALL = /\btext\(\s*"((?:[^"\\]|\\.)*)"\s*[,)]/g;

function sourceFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.[cm]?[jt]sx?$/.test(entry)) continue;
    found.push(path);
  }
  return found;
}

test("every literal string this workspace renders has a Ukrainian pair", () => {
  const missing = [];
  for (const file of sourceFiles(ROOT)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(LITERAL_TEXT_CALL)) {
      /* The source carries escapes; the catalogue key is the runtime value. */
      const key = JSON.parse(`"${match[1]}"`);
      if (key.trim() === "") continue;
      if (!(key in SOLANA_UK_TEXT)) missing.push(`${file}: ${JSON.stringify(key)}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `these strings would make their surface a 500 in Ukrainian:\n  ${missing.join("\n  ")}`,
  );
});

test("the check can actually fail, and looks in the right place", () => {
  /* A scanner that finds nothing passes silently and forever. Both halves are
     asserted: that it reads real files, and that an unpaired key is caught. */
  const files = sourceFiles(ROOT);
  assert.ok(files.length > 10, `only ${files.length} source files found under ${ROOT}`);

  const sample = 'const x = text("Send");\ntext(\n  "__no_such_key_in_catalogue__",\n);';
  const keys = [...sample.matchAll(LITERAL_TEXT_CALL)].map((m) => JSON.parse(`"${m[1]}"`));
  assert.deepEqual(keys, ["Send", "__no_such_key_in_catalogue__"], "the pattern missed a call shape");
  assert.ok("Send" in SOLANA_UK_TEXT);
  assert.ok(!("__no_such_key_in_catalogue__" in SOLANA_UK_TEXT));
});

/**
 * The other way this translator takes a page down.
 *
 * `PageHead` is a client component and translates its own title, so it expects
 * the **English** literal. Handing it `text("Home")` — already Ukrainian — made
 * the fail-closed translator raise on its own output, and the whole route
 * rendered as "Application error: a client-side exception". Every gate was
 * green: the string existed, both locales had it, and the type was `string`.
 *
 * The key-existence check above cannot see this, because nothing is missing.
 * Only the shape is wrong, and the shape is checkable.
 */
test("no page hands PageHead a translated title", () => {
  const offenders = [];
  for (const file of sourceFiles(ROOT)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/<PageHead[^>]*\stitle=\{([^}]*)\}/g)) {
      const expression = match[1].trim();
      if (/\b(text|meaning|runtime)\s*\(/.test(expression)) {
        offenders.push(`${file}: title={${expression}}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "PageHead translates its own title, so a translated one is translated twice and raises",
  );
});
