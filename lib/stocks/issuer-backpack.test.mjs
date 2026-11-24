import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { BACKPACK_ASSETS_URL, BACKPACK_GRACE_MS, backpackTicker, indexBackpackAssets, normalizeBackpackAssets, readBackpackCatalogue, readBackpackCatalogueShared, resetBackpackCache } from "./issuer-backpack.server.ts";
import { buildRepresentation, NO_CATALOGUES } from "./representations.ts";
import { shelfCompanies } from "./shelf.ts";

/**
 * Backpack's public list of assets confirms its tokens by their own contract address: ANT is Anthropic's,
 * by the issuer's word. The shape below is the one read on 2026-11-19 (`ANT-LIVE.md`): `ANT.US`, «Anthropic», one
 * Solana token with deposits and withdrawals open.
 */

const ANT = "ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe";
const ANTX = "XsYzw7AnthropicxStockMint11111111111DN1DL";
const LIST = [
  {
    symbol: "ANT.US",
    displayName: "Anthropic",
    coingeckoId: null,
    tokens: [{ displayName: "Anthropic", blockchain: "Solana", contractAddress: ANT, depositEnabled: true, minimumDeposit: "0.000001", withdrawEnabled: true, minimumWithdrawal: "0.0025", maximumWithdrawal: null, withdrawalFee: "0.0025" }],
  },
  /* A coin of the exchange with a Solana token, and one of another chain only: only Solana mints are kept. */
  { symbol: "SOL", displayName: "Solana", tokens: [{ blockchain: "Solana", contractAddress: null, depositEnabled: true, withdrawEnabled: true }] },
  { symbol: "ETH", displayName: "Ethereum", tokens: [{ blockchain: "Ethereum", contractAddress: "0x0000000000000000000000000000000000000000", depositEnabled: true, withdrawEnabled: true }] },
  { symbol: "USDC", displayName: "USD Coin", tokens: [{ blockchain: "Solana", contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", depositEnabled: true, withdrawEnabled: true }] },
  "not an asset",
];

const T0 = Date.UTC(2026, 10, 19, 18, 0, 0);
const at = (ms) => () => new Date(ms);
const answer = (body, status = 200) => async (url) => {
  assert.equal(String(url), BACKPACK_ASSETS_URL);
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
};
const noSleep = async () => {};

beforeEach(() => resetBackpackCache());
afterEach(() => resetBackpackCache());

test("the list becomes Solana mints with the exchange's ticker and the company it names", () => {
  const assets = normalizeBackpackAssets(LIST);
  assert.deepEqual(assets.map((asset) => asset.solanaMint), [ANT, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"]);
  assert.deepEqual(assets[0], { symbol: "ANT.US", ticker: "ANT", name: "Anthropic", solanaMint: ANT, depositEnabled: true, withdrawEnabled: true });
  assert.equal(backpackTicker("ANT.US"), "ANT");
  assert.equal(backpackTicker("SNDK"), "SNDK");
  assert.equal(normalizeBackpackAssets({ assets: LIST }), null, "an answer that is not a list is not the list");
});

test("the read is cached; a failed read serves the last copy marked stale, and nothing when there is none", async () => {
  const first = await readBackpackCatalogue({ fetchImpl: answer(LIST), now: at(T0) });
  assert.equal(first.ok, true);
  assert.equal(first.stale, false);
  assert.equal(first.fetchedAt, new Date(T0).toISOString());
  /* Inside ten minutes: the copy, no read. */
  const again = await readBackpackCatalogue({ fetchImpl: async () => assert.fail("not asked"), now: at(T0 + 60_000) });
  assert.equal(again.assets.length, 2);
  /* The API down an hour later: the copy, stale. */
  const down = await readBackpackCatalogue({ fetchImpl: answer({ error: "down" }, 503), now: at(T0 + 60 * 60_000), sleep: noSleep });
  assert.equal(down.ok, true);
  assert.equal(down.stale, true);
  /* Past the grace: the failure itself. */
  const gone = await readBackpackCatalogue({ fetchImpl: answer({ error: "down" }, 503), now: at(T0 + BACKPACK_GRACE_MS + 60 * 60_000), sleep: noSleep });
  assert.deepEqual(gone, { ok: false, code: "HTTP", reason: "The issuer's API answered 503." });
  resetBackpackCache();
  const limited = await readBackpackCatalogue({ fetchImpl: answer({}, 429), now: at(T0) });
  assert.equal(limited.code, "RATE_LIMITED");
  resetBackpackCache();
  const broken = await readBackpackCatalogue({ fetchImpl: answer({ assets: [] }), now: at(T0) });
  assert.equal(broken.code, "SHAPE");
});

test("a server error is asked once more after a pause; a refusal for rate is not", async () => {
  let calls = 0;
  const flaky = async () => (++calls === 1 ? new Response("", { status: 502 }) : new Response(JSON.stringify(LIST), { status: 200 }));
  const read = await readBackpackCatalogue({ fetchImpl: flaky, now: at(T0), sleep: noSleep });
  assert.equal(read.ok, true);
  assert.equal(calls, 2);
  resetBackpackCache();
  calls = 0;
  await readBackpackCatalogue({ fetchImpl: async () => (calls++, new Response("", { status: 429 })), now: at(T0), sleep: noSleep });
  assert.equal(calls, 1);
});

test("outside Next the shared read is the direct read", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = answer(LIST);
  try {
    const read = await readBackpackCatalogueShared(Date.now());
    assert.equal(read.ok, true);
    assert.equal(read.assets[0].solanaMint, ANT);
  } finally {
    globalThis.fetch = original;
  }
});

const market = (over = {}) => ({
  mint: ANT,
  symbol: "ANT",
  name: "Anthropic - Backpack Securities",
  icon: null,
  decimals: 6,
  tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  price: 95.4,
  change24hPct: -16,
  change1hPct: null,
  volume24hUsd: 27_000_000,
  liquidityUsd: 2_280_000,
  marketCapUsd: null,
  fdvUsd: null,
  holders: null,
  organicScore: null,
  organicScoreLabel: null,
  verified: true,
  tags: ["verified", "stocks", "rwa", "backpack", "token-2022"],
  category: "stock",
  issuer: { label: "Backpack Securities", tag: "backpack" },
  firstPoolAt: null,
  audit: { mintAuthorityDisabled: null, freezeAuthorityDisabled: null, topHoldersPct: null, devBalancePct: null, suspicious: false },
  links: { website: null, twitter: null, telegram: null },
  updatedAt: null,
  ...over,
});

test("a Backpack token the list names is confirmed by the issuer; one it does not name stays the venue's", () => {
  const books = { ...NO_CATALOGUES, backpack: indexBackpackAssets(normalizeBackpackAssets(LIST)) };
  const ant = buildRepresentation(market(), books);
  assert.equal(ant.issuerConfirmation, "issuer-catalogue");
  assert.deepEqual(ant.sources, ["jupiter-verified", "backpack-public-api"]);
  assert.equal(ant.underlying.symbol, "ANT");
  assert.equal(ant.underlying.name, "Anthropic");
  assert.equal(ant.companyKey, "anthropic");
  /* Not on the list: confirmed by the tag, never dropped for it. */
  const other = buildRepresentation(market({ mint: "SNDKbwMUQvZhnLnxLduradgLHG5KrPuKwpnrkkGRhfH", symbol: "SNDK", name: "Sandisk - Backpack Securities" }), books);
  assert.equal(other.issuerConfirmation, "tag-only");
  /* The list not read: every Backpack token as before. */
  assert.equal(buildRepresentation(market(), NO_CATALOGUES).issuerConfirmation, "tag-only");
  /* A copy borrowing the ticker is no representation at all: the venue did not verify it. */
  assert.equal(buildRepresentation(market({ mint: "4WdnFakeAnthropicCopy11111111111111111bpump", verified: false }), books), null);
});

test("the company card opens the deepest confirmed representation: ANT, not the thinner ANTx", () => {
  const books = { ...NO_CATALOGUES, backpack: indexBackpackAssets(normalizeBackpackAssets(LIST)) };
  const row = (representation, liquidity, volume) => ({ representation, market: { priceUsd: 95, change24hPct: -16, volume24hUsd: volume, liquidityUsd: liquidity, icon: null }, lifecycle: { tradable: true } });
  const ant = buildRepresentation(market(), books);
  const antx = {
    ...ant,
    mint: ANTX,
    symbol: "ANTx",
    name: "Anthropic xStock",
    issuer: { id: "xstocks", label: "xStocks · Backed Finance", catalogue: true },
    underlying: { symbol: "ANT", isin: "US03703U1079", listingCountry: "US", name: "Anthropic" },
    sources: ["jupiter-verified", "xstocks-public-api"],
  };
  const cards = shelfCompanies([row(antx, 58_000, 300_000), row(ant, 2_280_000, 27_000_000)]);
  assert.equal(cards.length, 1, "one company, one card");
  assert.equal(cards[0].name, "Anthropic");
  assert.equal(cards[0].mint, ANT);
  const tagOnly = buildRepresentation(market(), NO_CATALOGUES);
  assert.equal(shelfCompanies([row(antx, 58_000, 300_000), row(tagOnly, 2_280_000, 27_000_000)])[0].mint, ANTX);
});
