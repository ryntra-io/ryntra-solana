// Run from repo root: node --test lib/build/bigint-buffer.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { BIGINT_BUFFER_PURE_JS, BIGINT_BUFFER_WARNING, withPureBigintBuffer } from "./bigint-buffer.ts";

const require = createRequire(import.meta.url);

test("a server compile resolves bigint-buffer to its pure-JavaScript entry, keeping every other alias", () => {
  const config = withPureBigintBuffer({ resolve: { alias: { react: "/r" } } }, true);
  assert.deepEqual(config.resolve.alias, { react: "/r", "bigint-buffer$": "bigint-buffer/dist/browser.js" });
  assert.deepEqual(withPureBigintBuffer({}, true).resolve.alias, { "bigint-buffer$": BIGINT_BUFFER_PURE_JS });
  const listed = withPureBigintBuffer({ resolve: { alias: [{ name: "x", alias: "y" }] } }, true).resolve.alias;
  assert.deepEqual(listed.at(-1), { name: "bigint-buffer", alias: BIGINT_BUFFER_PURE_JS, onlyModule: true });
  assert.equal(listed.length, 2);
});

test("a client compile is left as it came: the package's browser field already picks the same entry", () => {
  const config = { resolve: { alias: { react: "/r" } } };
  assert.deepEqual(withPureBigintBuffer(config, false), { resolve: { alias: { react: "/r" } } });
  assert.equal(JSON.parse(readFileSync(require.resolve("bigint-buffer/package.json"), "utf8")).browser["./dist/node.js"], "./dist/browser.js");
});

test("the pure entry never tries the addon and never prints the line; the Node entry is the one that does", () => {
  const pure = readFileSync(require.resolve(BIGINT_BUFFER_PURE_JS), "utf8");
  assert.doesNotMatch(pure, /bindings|console\.warn/);
  assert.ok(!pure.includes(BIGINT_BUFFER_WARNING));
  assert.ok(readFileSync(require.resolve("bigint-buffer"), "utf8").includes(BIGINT_BUFFER_WARNING));
});

test("the pure entry gives the same results as the Node entry: same bytes in, same numbers out", () => {
  const pure = require(BIGINT_BUFFER_PURE_JS);
  const quiet = console.warn;
  console.warn = () => {};
  let node;
  try {
    node = require("bigint-buffer");
  } finally {
    console.warn = quiet;
  }
  const u64Max = 2n ** 64n - 1n;
  const values = [0n, 1n, 255n, 256n, 1_000_000_000n, 18_446_744_073_709_551_615n, u64Max / 3n, 2n ** 63n, 2n ** 127n + 5n];
  for (const width of [1, 8, 16, 32]) {
    for (const value of values) {
      const limited = value % 2n ** BigInt(width * 8);
      assert.deepEqual(pure.toBufferLE(limited, width), node.toBufferLE(limited, width), `LE ${value} ${width}`);
      assert.deepEqual(pure.toBufferBE(limited, width), node.toBufferBE(limited, width), `BE ${value} ${width}`);
      const le = pure.toBufferLE(limited, width);
      assert.equal(pure.toBigIntLE(le), node.toBigIntLE(le));
      assert.equal(pure.toBigIntLE(le), limited);
      const be = pure.toBufferBE(limited, width);
      assert.equal(pure.toBigIntBE(be), node.toBigIntBE(be));
      assert.equal(pure.toBigIntBE(be), limited);
    }
  }
  assert.equal(pure.toBigIntLE(Buffer.alloc(0)), 0n);
  assert.equal(pure.toBigIntBE(Buffer.alloc(0)), 0n);
});
