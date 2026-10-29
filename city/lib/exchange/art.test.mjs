import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

import { artSrcSet, EXCHANGE_ART } from "./art.ts";

const publicFile = (src) => new URL(`../../../public${src}`, import.meta.url);

test("every still of the Exchange is a WebP in both widths, light enough for a phone", () => {
  for (const [name, files] of Object.entries(EXCHANGE_ART)) {
    for (const src of [files.small, files.large]) {
      assert.match(src, /^\/city\/art\/exchange-[a-z]+-(800|1600)\.webp$/, name);
      assert.ok(existsSync(publicFile(src)), `${src} is missing`);
      const bytes = readFileSync(publicFile(src));
      assert.equal(bytes.subarray(0, 4).toString("latin1"), "RIFF", src);
      assert.equal(bytes.subarray(8, 12).toString("latin1"), "WEBP", src);
      assert.ok(statSync(publicFile(src)).size < 160_000, `${src} is too heavy`);
    }
    assert.equal(artSrcSet(name), `${files.small} 800w, ${files.large} 1600w`);
  }
});

test("no grey placeholder: the empty, no-wallet and no-account states and the head stand on a still", () => {
  const read = (file) => readFileSync(new URL(`../../components/exchange/${file}`, import.meta.url), "utf8");
  // The one step to open an account stands on the invite still; waiting for access and Phoenix silent on the empty one.
  assert.match(read("Account.tsx"), /art=\{step\.step === 'open' \? 'invite' : 'empty'\}/);
  assert.match(read("Account.tsx"), /<ArtState art="empty" title=\{words\.title\}/);
  assert.match(read("Account.tsx"), /<ArtState art="empty" title=\{ACCOUNT_WORDS\.connect\.title\}>/);
  assert.match(read("Book.tsx"), /<ArtState art="empty" title="No open positions" \/>/);
  assert.match(read("Book.tsx"), /<ArtState art="empty" title="No open orders" \/>/);
  assert.equal(read("ExchangeWindow.tsx").match(/<ArtImage art="head"/g)?.length, 1, "one head still, at the top of the window in either layout");
});
