import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/* A picture that failed before the page came alive fired its error unheard, and
   the logo only read a loaded picture once mounted. Now a mounted picture that is broken (complete, no size, its
   decoding refused) gives way to the next address, and at the end to the letter — as an error heard does. */

const source = readFileSync(new URL("./CoinLogo.tsx", import.meta.url), "utf8");

test("a logo that failed before the page came alive gives way, as an error heard does", () => {
  assert.match(source, /if \(!picture\.complete \|\| picture\.naturalWidth > 0\) \{\s*judge\(now, picture\);\s*return;\s*\}/, "a loaded or loading picture is only read");
  assert.match(source, /picture\.decode\(\)\.then\([\s\S]*?\(\) => live && setMissed\(goneToo\(key, now\)\)/, "a broken one, its decoding refused, is gone");
  assert.match(source, /onError=\{\(\) => setMissed\(goneToo\(key, now\)\)\}/, "the same step for an error heard");
  assert.match(source, /const now = list\.find\(\(one\) => !gone\.includes\(one\)\) \?\? null;/, "the first address not gone is shown, the letter after the last");
  assert.match(source, /aria-hidden="true">\s*\{symbol\.replace/, "the letter on its disc");
});
