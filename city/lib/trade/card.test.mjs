import { test } from "node:test";
import assert from "node:assert/strict";

import { makeTradeCard, postToXUrl } from "./card.ts";
import { colourOf, PLAYER_COLOURS } from "./colour.ts";
import { holdingsOf, ownedMints } from "./wallet.ts";
import { TAKER, USDT, WSOL } from "./test-fixtures.mjs";

const SIG = "63mP5kDsXN4G5UXVVenvAYNVyXdPawEhLdcj77BTfJP2yS7o6RwoUde9Y2YbtgCZj1HqABN6WJYCDwZCKhXhC4Cd";
const REQUEST = { address: TAKER, mint: USDT, signature: SIG, kind: "BUY" };
const MADE = { id: "a1b2c3d4e5f6g7h8i9j0", url: "https://ryntra.io/r/abc/c/a1b2c3d4e5f6g7h8i9j0", image: "https://ryntra.io/r/abc/c/a1b2c3d4e5f6g7h8i9j0/image?v=1", text: "Bought $USDT on Ryntra", alt: "A trade card" };

/** The trade-card generator's routes, answering from a list. */
function generator(answers) {
  const asked = [];
  const queue = [...answers];
  return {
    asked,
    fetch: async (url, init = {}) => {
      asked.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null });
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
    },
  };
}

const deps = (gen) => ({ fetch: gen.fetch, sleep: async () => {}, delaysMs: [1, 1] });

test("the card is the generator's: the trade is named by its signature, never by a figure", async () => {
  const gen = generator([
    { status: 200, body: { complete: true, trades: [{ key: `SELL:other` }, { key: `BUY:${SIG}` }] } },
    { status: 200, body: { ok: true, card: MADE } },
  ]);
  const made = await makeTradeCard(REQUEST, deps(gen));
  /* The post links the coin's own page in the city; the generator's page stays beside it. */
  assert.deepEqual(made, { ok: true, card: { url: `https://ryntra.io/c/${USDT}`, page: MADE.url, image: MADE.image, text: MADE.text, alt: MADE.alt } });
  assert.equal(gen.asked[0].url, `/api/growth/cards?address=${TAKER}&mint=${USDT}`);
  assert.deepEqual(gen.asked[1], { url: "/api/growth/cards", method: "POST", body: { address: TAKER, trade: `BUY:${SIG}`, locale: "en", amounts: false } });
});

test("the history of a fresh trade can lag: asked again, a little later", async () => {
  const gen = generator([
    { status: 200, body: { complete: true, trades: [] } },
    { status: 200, body: { complete: true, trades: [{ key: `BUY:${SIG}` }] } },
    { status: 200, body: { ok: true, card: MADE } },
  ]);
  assert.equal((await makeTradeCard(REQUEST, deps(gen))).ok, true);
  assert.equal(gen.asked.length, 3);
});

test("a wallet that has not proved itself is asked to, before any card", async () => {
  const gen = generator([{ status: 401, body: { error: "proof required", proof: false } }]);
  assert.deepEqual(await makeTradeCard(REQUEST, deps(gen)), { ok: false, code: "PROOF_REQUIRED" });
});

test("a trade the generator cannot measure gets no card", async () => {
  const gen = generator([{ status: 200, body: { complete: true, trades: [] } }]);
  assert.deepEqual(await makeTradeCard(REQUEST, deps(gen)), { ok: false, code: "NOT_FOUND" });
  assert.equal(gen.asked.length, 3);
  const refused = generator([
    { status: 200, body: { trades: [{ key: `BUY:${SIG}` }] } },
    { status: 404, body: { ok: false, error: "TRADE_NOT_FOUND" } },
  ]);
  assert.deepEqual(await makeTradeCard(REQUEST, deps(refused)), { ok: false, code: "NOT_FOUND" });
  const down = generator([{ status: 503, body: { ok: false, error: "CARDS_UNAVAILABLE" } }]);
  assert.deepEqual(await makeTradeCard(REQUEST, deps(down)), { ok: false, code: "UNAVAILABLE" });
});

test("the post on X carries the card's own words and link", () => {
  assert.equal(postToXUrl(MADE), `https://x.com/intent/post?text=Bought%20%24USDT%20on%20Ryntra&url=${encodeURIComponent(MADE.url)}`);
});

test("your colour is your wallet's, the same everywhere, and never the city's own signals", () => {
  assert.equal(colourOf(TAKER), colourOf(TAKER));
  assert.ok(PLAYER_COLOURS.includes(colourOf(TAKER)));
  const seen = new Set();
  for (let i = 0; i < 400; i += 1) seen.add(colourOf(`wallet-${i}`));
  assert.equal(seen.size, PLAYER_COLOURS.length);
  for (const signal of ["#FFB23F", "#14F195", "#FF4B3A"]) assert.ok(!PLAYER_COLOURS.includes(signal));
});

test("your towers are the coins your wallet holds, SOL aside", () => {
  const holdings = holdingsOf(
    TAKER,
    [
      { kind: "NATIVE_SOL", mint: null, spendableRaw: "2410000000", decimals: 9 },
      { kind: "TOKEN", mint: USDT, spendableRaw: "1500000", decimals: 6 },
      { kind: "TOKEN", mint: WSOL, spendableRaw: "5", decimals: 9 },
      { kind: "TOKEN", mint: "empty", spendableRaw: "0", decimals: 6 },
      { kind: "TOKEN", mint: "broken", spendableRaw: "x", decimals: 6 },
    ],
    true,
  );
  assert.deepEqual(holdings.sol, { spendableRaw: "2410000000", decimals: 9 });
  assert.deepEqual([...holdings.tokens.keys()], [USDT, WSOL]);
  assert.deepEqual([...ownedMints(holdings)], [USDT]);
  assert.deepEqual([...ownedMints(null)], []);
});
