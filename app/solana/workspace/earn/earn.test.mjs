// Run from repo root: node --test app/solana/workspace/earn/earn.test.mjs
//
// What the Earn surface must say, in both languages, and what it must never say.
//
// Two of these are promises the product makes and cannot prove to a person on the screen: that Ryntra takes
// nothing out of what they earn, and that a provider nobody can reach is drawn as unreachable rather than as
// a market with nothing in it. A page that quietly stopped saying either would still work, which is exactly
// why it is asserted here rather than left to a reader.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { EARN_IN_MENU, earnNamed as railReading, MENU_SECTIONS } from "../../../shell/domains.ts";
import { earnNamed } from "../../../../lib/earn/providers.ts";

import { EARN_WORDS, earnFailureWord, earnWord } from "./earn-words.ts";

const here = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const surface = here("./earn-surface.tsx");
const page = here("./page.tsx");
const api = here("./earn-api.ts");

test("every word of this section exists in both languages", () => {
  const en = Object.keys(EARN_WORDS.en);
  const uk = Object.keys(EARN_WORDS.uk);
  assert.deepEqual(
    en.filter((key) => !uk.includes(key)),
    [],
    "a missing Ukrainian word is a sentence in the wrong language on a page about somebody's money",
  );
  assert.deepEqual(uk.filter((key) => !en.includes(key)), []);
  for (const key of en) {
    assert.ok(EARN_WORDS.uk[key].trim().length > 0, `${key} is empty in Ukrainian`);
    assert.ok(EARN_WORDS.en[key].trim().length > 0, `${key} is empty in English`);
  }
});

test("the zero fee is stated in words, in both languages", () => {
  assert.match(earnWord("en", "noFee"), /Ryntra takes nothing/);
  assert.match(earnWord("uk", "noFee"), /не бере нічого/);
  assert.match(earnWord("en", "noFeeLong"), /no share of what you earn/);
  assert.match(earnWord("uk", "noFeeLong"), /ні частки із заробленого/);
  /* And it is on the page itself, not only in the word list. */
  assert.match(surface, /data-earn-no-fee="true"/);
  assert.match(surface, /w\("noFee"\)/);
  assert.match(surface, /w\("noFeeLong"\)/);
  /* And inside the Review, where a person is about to sign. */
  assert.match(surface, /costsTotal=\{w\("noFee"\)\}/);
  assert.match(surface, /label: w\("costsRyntra"\), value: w\("costsNothing"\)/);
});

test("a provider that cannot be reached is drawn as unreachable, with its own reason", () => {
  for (const key of ["unavailableNoKey", "unavailableDisabled", "unavailableDown", "unavailableUnreadable"]) {
    assert.ok(earnWord("en", key).length > 20, `${key} needs a sentence, not a status word`);
    assert.ok(earnWord("uk", key).length > 20);
  }
  assert.match(surface, /data-earn-unavailable=\{provider\.code\}/);
  assert.match(surface, /provider\.code === "NO_KEY"/);
  assert.match(surface, /provider\.code === "DISABLED"/);
  assert.match(earnWord("en", "unavailableNoKey"), /nothing is empty/);
  assert.match(earnWord("uk", "unavailableNoKey"), /нічого не порожнє/);
});

test("the markets name the four figures the section is about", () => {
  for (const key of ["rate", "liquidity", "risk", "minimum"]) {
    assert.ok(earnWord("en", key).length > 0);
    assert.ok(earnWord("uk", key).length > 0);
    assert.match(surface, new RegExp(`w\\("${key}"\\)`));
  }
  /* A figure that was not read says so rather than showing a zero. */
  assert.match(surface, /\?\? w\("notRead"\)/);
  assert.match(earnWord("uk", "notRead"), /не прочитано/);
});

test("the position's figures come from the read, and the read is asked again rather than remembered", () => {
  for (const key of ["deposited", "earned", "availableNow", "readFromChain"]) {
    assert.match(surface, new RegExp(`w\\("${key}"`));
  }
  /* A finished action bumps the version the read depends on; nothing adjusts a figure in place. */
  assert.match(surface, /onFinished=\{\(\) => setVersion\(\(seen\) => seen \+ 1\)\}/);
  assert.match(api, /useEarnSurface\(initial: EarnSurface, owner: string \| null, version: number\)/);
  assert.match(api, /\/api\/solana\/earn\$\{owner \? `\?owner=/);
});

test("the page signs nothing and the browser decides nothing", () => {
  /* The page reads the markets on the server and hands them over; it never reads a wallet there. */
  assert.match(page, /readEarnSurface\(null\)/);
  assert.doesNotMatch(page, /useSolanaConnection|signTransaction|connection\./);
  /* The browser asks the wallet to sign and the server to relay; it never calls a provider itself. */
  assert.match(api, /signTransaction\(/);
  assert.doesNotMatch(api, /api\.jup\.ag/);
  assert.doesNotMatch(surface, /signTransaction\(/);
  /* Nothing in the browser holds a key or a secret. */
  for (const source of [surface, api]) {
    assert.doesNotMatch(source, /x-api-key|BETA_TOKEN_SECRET|RYNTRA_JUPITER/);
  }
});

test("a failure a person sees is a sentence, and an unknown code still is one", () => {
  assert.match(earnFailureWord("en", "RATE_MOVED"), /Nothing was sent/);
  assert.match(earnFailureWord("uk", "RATE_MOVED"), /Нічого не надіслано/);
  assert.match(earnFailureWord("en", "NO_LIQUIDITY"), /Nothing was sent/);
  assert.match(earnFailureWord("en", "SOMETHING_NOBODY_WROTE"), /Nothing was sent/);
  assert.match(earnFailureWord("uk", "SOMETHING_NOBODY_WROTE"), /Нічого не надіслано/);
});

test("a receipt that the chain has not answered for keeps asking", () => {
  assert.match(api, /receipt\.state !== "UNKNOWN"/);
  assert.match(api, /\/api\/solana\/earn\/status\?signatures=/);
  assert.match(earnWord("en", "receiptUnknown"), /chain has not answered/);
  assert.match(earnWord("uk", "receiptUnknown"), /ланцюг ще не відповів/);
});

test("the words carry no internal vocabulary onto a customer page", () => {
  /* The names of this repository's own machinery: a gate, a live check with a small sum, a test network, an
     environment variable, a row of the build plan. None of them is a word a person reading about their own
     money should meet. */
  const forbidden = /\b(gate G[0-4]|canary|devnet|RYNTRA_[A-Z_]+|NEXT_PUBLIC_[A-Z_]+)\b/i;
  for (const locale of ["en", "uk"]) {
    for (const [key, value] of Object.entries(EARN_WORDS[locale])) {
      assert.doesNotMatch(value, forbidden, `${locale}.${key} says something only this repository would say`);
    }
  }
});

test("the menu row and the section read the same switch, and the row opens where the page is", () => {
  /* Two readings of one deployment variable — the rail keeps its own so it depends on nothing — so they are
     held to each other here rather than left to drift. */
  for (const value of [undefined, "", "on", " ON ", "later", "off"]) {
    assert.equal(railReading(value), earnNamed(value), `the two readings disagree about «${String(value)}»`);
  }
  assert.equal(typeof EARN_IN_MENU, "boolean");
  assert.equal(MENU_SECTIONS.lend.href, "/app/earn");
  assert.deepEqual([...MENU_SECTIONS.lend.match], ["/app/earn"]);
});

test("the section says plainly that borrowing is not here", () => {
  assert.match(earnWord("en", "noLoans"), /not here yet/);
  assert.match(earnWord("uk", "noLoans"), /поки немає/);
  assert.match(surface, /w\("noLoans"\)/);
});
