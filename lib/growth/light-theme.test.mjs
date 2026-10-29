import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/* The app wears the core's theme: the light one is `data-theme="porcelain"`
   on <html>, the product's own `light` stays for the pages outside the frame.
   A light-only rule of the Growth line keyed on `light` alone goes dark under
   Porcelain (a negative figure fell to 3.3:1), so every such selector names both. */

const ROOTS = ["app/solana/workspace/rewards", "app/app/rewards", "app/r"];

function cssFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

test("every light-theme rule of Rewards also holds under the core's Porcelain", () => {
  const files = ROOTS.flatMap(cssFiles);
  assert.ok(files.length > 0, "no CSS found under the Growth line's pages");
  const lonely = [];
  for (const file of files) {
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, index) => {
      if (line.includes('[data-theme="light"]') && !line.includes('[data-theme="porcelain"]')) {
        lonely.push(`${file.replaceAll("\\", "/")}:${index + 1}`);
      }
    });
  }
  assert.deepEqual(lonely, []);
});
