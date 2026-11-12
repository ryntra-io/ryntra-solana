// Run from repo root: node --test city/components/connect/get-phantom.test.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/* CITY-239: the way to a wallet when the browser has none read «Встанови Phantom» in the wallet's list of the top bar
   and «Встановити Phantom» on the agent's card — two forms of one button. Every place of the city says it one way. */

const city = fileURLToPath(new URL("../..", import.meta.url));

function wordFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const at = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...wordFiles(at));
    else if (/words\.ts$/.test(entry.name)) out.push(at);
  }
  return out;
}

test("«Get Phantom» is one button with one name, in English and in Ukrainian, everywhere it stands", () => {
  const said = [];
  for (const file of wordFiles(city)) {
    const text = readFileSync(file, "utf8");
    for (const found of text.matchAll(/^\s*getPhantom: '([^']+)',$/gmu)) said.push({ file: relative(city, file).replace(/\\/g, "/"), words: found[1] });
  }
  assert.ok(said.length >= 16, `the button's places were found (${said.length})`);
  const forms = [...new Set(said.map((entry) => entry.words))].sort();
  assert.deepEqual(forms, ["Get Phantom", "Встановити Phantom"], JSON.stringify(said.filter((entry) => !["Get Phantom", "Встановити Phantom"].includes(entry.words))));
  // The two places a person compared: the wallet's list in the top bar and the agent's card.
  for (const file of ["components/quarter/words.ts", "components/trade/words.ts"]) {
    assert.deepEqual(said.filter((entry) => entry.file === file).map((entry) => entry.words), ["Get Phantom", "Встановити Phantom"], file);
  }
});
