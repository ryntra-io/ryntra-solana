import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { issuerOf, issuerTags, keepIssuer, powerWords } from "./issuer.ts";

// The engine's own recorded answer: SOL's passport (no powers held) and USDT's (both held by its issuer).
const golden = JSON.parse(readFileSync(new URL("../../../app/api/solana/swap/golden/transcripts.json", import.meta.url), "utf8"));
const quote = golden["quote: SOL to USDT with the referral fee"].steps.at(-1).body;
const SOL = "So11111111111111111111111111111111111111112";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

test("the issuer's powers are read from the passport on the engine's price, never guessed", () => {
  assert.deepEqual(issuerOf(quote.passports, SOL), { mint: { state: "gone", by: null }, freeze: { state: "gone", by: null } });
  const usdt = issuerOf(quote.passports, USDT);
  assert.equal(usdt.mint.state, "held");
  assert.equal(usdt.mint.by, quote.passports[USDT].identity.mintAuthority.value);
  assert.equal(usdt.freeze.state, "held");
  // A price without a passport for the coin says nothing.
  assert.equal(issuerOf(quote.passports, "WIF-not-in-this-price"), null);
  assert.equal(issuerOf(null, SOL), null);
  assert.equal(issuerOf(undefined, SOL), null);
});

test("an authority the chain did not verify is unread, not «nobody»", () => {
  const passports = structuredClone(quote.passports);
  passports[SOL].identity.mintAuthority = { value: null, provenance: "UNKNOWN", meaning: "" };
  const issuer = issuerOf(passports, SOL);
  assert.deepEqual(issuer.mint, { state: "unread", by: null });
  assert.equal(powerWords(issuer.mint), "Not read");
  // Unread is left out of the tags: the window shows only what the chain answered.
  assert.deepEqual(issuerTags(issuer), [{ text: "No freeze", tone: "ok" }]);
});

test("two short tags: calm for a power nobody holds, amber for one somebody does", () => {
  assert.deepEqual(issuerTags(issuerOf(quote.passports, SOL)), [
    { text: "Fixed supply", tone: "ok" },
    { text: "No freeze", tone: "ok" },
  ]);
  assert.deepEqual(issuerTags(issuerOf(quote.passports, USDT)), [
    { text: "Can mint", tone: "warn" },
    { text: "Can freeze", tone: "warn" },
  ]);
  assert.deepEqual(issuerTags(null), []);
  assert.equal(powerWords({ state: "gone", by: null }), "Nobody");
  assert.equal(powerWords({ state: "held", by: "Q6XprfkF8RQQKoQVG33xT88H7wi8Uk1B1CC7YAs69Gi" }), "Q6Xp…69Gi");
});

test("the powers stay on screen while the price for another amount is on its way", () => {
  const read = issuerOf(quote.passports, USDT);
  assert.equal(keepIssuer(USDT, read), read);
  assert.equal(keepIssuer(USDT, null), read, "a price on its way keeps the last read");
  assert.equal(keepIssuer("never-read", null), null);
});
