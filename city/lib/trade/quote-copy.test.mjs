import { test } from "node:test";
import assert from "node:assert/strict";

import { quoteLine } from "./quote-copy.ts";

// A price that did not come is one calm line chosen by the code: no setting names, addresses or engine words.
const TECHNICAL = /RYNTRA_|API|engine|route|provider|Jupiter|mint|schema|key/i;

test("a price that did not come is one calm line, never the engine's own words", () => {
  const codes = [
    "PROVIDER_KEY_MISSING",
    "PRODUCTION_KEY_REQUIRED",
    "ASSET_NOT_OFFERED",
    "MINT_UNREADABLE",
    "PASSPORT_REFUSED",
    "VALIDATION_ERROR",
    "QUOTE_NO_ROUTE",
    "QUOTE_RATE_LIMITED",
    "RATE_LIMITED",
    "QUOTE_UNREACHABLE",
    "QUOTE_MALFORMED",
    "QUOTE_IMPLAUSIBLE_QUOTE",
    "TIMEOUT",
    "NETWORK",
    "HTTP_502",
    "SOMETHING_NEW",
  ];
  for (const code of codes) {
    const line = quoteLine(code);
    assert.ok(line.text.length > 0 && line.text.length <= 48, code);
    assert.doesNotMatch(line.text, TECHNICAL, code);
  }
});

test("a deployment that cannot price offers no «Try again»; a passing failure does", () => {
  assert.deepEqual(quoteLine("PROVIDER_KEY_MISSING"), { text: "Prices are unavailable right now.", retryable: false });
  assert.equal(quoteLine("ASSET_NOT_OFFERED").retryable, false);
  assert.equal(quoteLine("QUOTE_NO_ROUTE").retryable, true);
  assert.equal(quoteLine("TIMEOUT").retryable, true);
});
