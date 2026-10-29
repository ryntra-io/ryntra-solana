import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { LAUNCH_SHORT_SLUG, launchShortPath, launchShortSlug, localizedShareLink } from "./share-link.ts";
import { CARD_MARKS_SHOWN, launchShareFacts, launchShareFactsOfRecord, resolveLaunchShort } from "./share.server.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const MINT = "F4pmJAEZDtJ4JPE7QwK7zrD6R1Ypgi7nTCGxTM7AsLGQ";

test("SOL-L1e: the short address — the mint's first eight letters, the code after them, `/uk` for Ukrainian", () => {
  assert.equal(launchShortSlug(MINT), "F4pmJAEZ");
  assert.equal(launchShortPath(MINT, null), "/t/F4pmJAEZ");
  assert.equal(launchShortPath(MINT, "ABC123"), "/t/F4pmJAEZ/ABC123");
  assert.equal(localizedShareLink("https://ryntra.io/t/F4pmJAEZ/ABC123", "uk"), "https://ryntra.io/uk/t/F4pmJAEZ/ABC123");
  assert.equal(localizedShareLink("https://ryntra.io/t/F4pmJAEZ/ABC123", "en"), "https://ryntra.io/t/F4pmJAEZ/ABC123");
  /* Any other link — a trade card's, the page itself — is left as it is. */
  assert.equal(localizedShareLink("https://ryntra.io/r/ABC123/c/x", "uk"), "https://ryntra.io/r/ABC123/c/x");
  assert.equal(localizedShareLink("not a link", "uk"), "not a link");
  /* Base58 only: no `%` or `_` reaches the store's prefix scan, no `0`, `O`, `I`, `l`. */
  for (const bad of ["F4pmJAE", "F4pm%AEZ", "F4pm_AEZ", "0OIlabcd", "F4pmJAEZ/x"]) assert.equal(LAUNCH_SHORT_SLUG.test(bad), false, bad);
  assert.equal(LAUNCH_SHORT_SLUG.test("F4pmJAEZ"), true);
  assert.equal(LAUNCH_SHORT_SLUG.test(MINT), true);
});

test("SOL-L1e: a short address lands on exactly one launch of this network — never on a guess", async () => {
  const store = createMemoryGuardStore();
  const launches = store.collection("launches");
  await launches.set(`solana:mainnet:${MINT}`, { token: MINT, name: "Wick", symbol: "WICK" });
  await launches.set("solana:devnet:Zzzzzzzz1111111111111111111111111111", { token: "Zzzzzzzz1111111111111111111111111111" });
  assert.deepEqual(await resolveLaunchShort(store, "mainnet", "F4pmJAEZ"), { token: MINT, name: "Wick", symbol: "WICK" });
  assert.equal((await resolveLaunchShort(store, "mainnet", MINT))?.token, MINT, "the whole mint names it too");
  assert.equal(await resolveLaunchShort(store, "mainnet", "Zzzzzzzz"), null, "another network's launch is not this one's");
  assert.equal(await resolveLaunchShort(store, "mainnet", "F4pmJAEY"), null);
  assert.equal(await resolveLaunchShort(store, "mainnet", "F4pmJAEZD"), null, "eight letters or the whole mint, nothing between");
  /* Two launches sharing the eight letters: neither — the route sends the person to every market instead. */
  await launches.set("solana:mainnet:F4pmJAEZ22222222222222222222222222", { token: "F4pmJAEZ22222222222222222222222222" });
  assert.equal(await resolveLaunchShort(store, "mainnet", "F4pmJAEZ"), null);
  assert.equal((await resolveLaunchShort(store, "mainnet", MINT))?.token, MINT, "the whole mint still names it");
});

const token = (over = {}) => ({
  network: "solana:mainnet",
  token: MINT,
  name: "Wick",
  symbol: "WICK",
  image: null,
  progressBps: 4_210,
  migrated: false,
  receipt: {
    marks: [
      { code: "MINT_REVOKED", account: "a" },
      { code: "NO_FREEZE", account: "a" },
      { code: "LP_LOCKED_FOREVER", account: "p1" },
      { code: "LP_LOCKED_FOREVER", account: "p2" },
      { code: "METADATA_FIXED", account: "a" },
      { code: "CREATOR_BUY_LOCKED", account: "e" },
      { code: "CURVE_HOLDS_FUNDS", account: "c" },
    ],
  },
  ...over,
});
const market = (over = {}) => ({
  pair: { symbol: "USDC", dollar: true },
  price: { pair: 0.0000512, usd: 0.0000512 },
  progress: { bps: 4_300, migrated: false },
  observedAt: "2026-10-19T14:05:00.000Z",
  ...over,
});

test("SOL-L1e: the card says only what the chain gave — the creator's lock first, the exit's two locks one line", () => {
  const facts = launchShareFacts(token(), market());
  assert.deepEqual(facts.marks, ["CREATOR_BUY_LOCKED", "MINT_REVOKED", "NO_FREEZE", "METADATA_FIXED", "LP_LOCKED_FOREVER"]);
  assert.equal(facts.marks.length, CARD_MARKS_SHOWN);
  assert.deepEqual(facts.price, { value: 0.0000512, dollar: true, pair: "USDC", at: "2026-10-19T14:05:00.000Z" });
  assert.deepEqual(facts.dex, { bps: 4_300, migrated: false }, "the market's progress, newer than the token's");
  /* No market read: no price, the token's own progress. */
  const unread = launchShareFacts(token(), null);
  assert.equal(unread.price, null);
  assert.deepEqual(unread.dex, { bps: 4_210, migrated: false });
  /* The chain not read for the receipt: no mark at all — «Чесний лаунч» is never drawn on a guess. */
  assert.deepEqual(launchShareFacts(token({ receipt: null }), null).marks, []);
  /* The chain not read in time: the recorded name and ticker, and nothing else. */
  assert.deepEqual(launchShareFactsOfRecord({ token: MINT, name: "Wick", symbol: "WICK" }, "solana:mainnet"), { name: "Wick", symbol: "WICK", image: null, network: "solana:mainnet", price: null, dex: null, marks: [] });
  /* Progress unknown: no way to the DEX drawn. */
  assert.equal(launchShareFacts(token({ progressBps: null, migrated: null }), null).dex, null);
  /* On the DEX. */
  assert.deepEqual(launchShareFacts(token(), market({ progress: { bps: 10_000, migrated: true } })).dex, { bps: 10_000, migrated: true });
  /* A pair that is not a dollar: the price in the pair. */
  assert.deepEqual(launchShareFacts(token(), market({ pair: { symbol: "SOL", dollar: false }, price: { pair: 0.0002, usd: null } })).price?.dollar, false);
});

test("SOL-L1e: the short address is open to previews — robots.txt closes `/app/`, never `/t/`", () => {
  const robots = read("app/robots.ts");
  const closed = /const PROTECTED_PATHS = \[([\s\S]*?)\];/.exec(robots)?.[1] ?? "";
  for (const path of ["/t/", "/uk/t/"]) {
    const blocked = [...closed.matchAll(/"([^"]+)"/g)].map((match) => match[1]).some((rule) => path.startsWith(rule) || rule === "/");
    assert.equal(blocked, false, `${path} must stay crawlable for X's card`);
  }
});

test("SOL-L1e: the card and its words promise no price", () => {
  const words = read("app/app/launch/launch-words.ts");
  const card = [...words.matchAll(/^\s*(card\w+|share\w*): bi\("([^"]*)", "([^"]*)"\)/gm)].flatMap((match) => [match[2], match[3]]);
  assert.ok(card.length >= 12, "the card's words are read");
  for (const text of card) {
    assert.doesNotMatch(text, /moon|100x|pump|guarantee[sd]? (?:a|the) (?:return|profit)|to the moon|гарант\w+ (?:прибут|дохід)|ракета|ікси/i, text);
  }
  /* The card and its page close on the market's own disclaimer, word for word (the words test guards that line). */
  assert.match(read("app/brand/launch-og.tsx"), /word\("cardNoAdvice"\)\} \$\{word\("noGuarantee"\)/);
  assert.match(read("app/t/serve.ts"), /word\("cardNoAdvice"\), word\("noGuarantee"\)/);
});

test("SOL-L1e: the token's picture is read from Launch's own store and drawn again as a PNG — WebP included", async () => {
  const { default: sharp } = await import("sharp");
  const { storeLaunchImage } = await import("./metadata.server.ts");
  const { launchPicture, pngOf } = await import("./share-picture.server.ts");
  const store = createMemoryGuardStore();
  const webp = await sharp({ create: { width: 64, height: 40, channels: 3, background: "#FF681C" } }).webp().toBuffer();
  const stored = await storeLaunchImage(store, new Uint8Array(webp), "2026-10-19T00:00:00.000Z");
  assert.equal(stored.ok, true);
  const picture = await launchPicture(store, `https://ryntra.io/api/launch/image/${stored.image.sha256}`);
  assert.match(picture ?? "", /^data:image\/png;base64,/);
  const meta = await sharp(Buffer.from(picture.split(",")[1], "base64")).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ["png", 208, 208]);
  /* Nothing to draw: no address, a broken one, bytes that are no picture, a host that is not public. */
  assert.equal(await launchPicture(store, null), null);
  assert.equal(await launchPicture(store, "not a url"), null);
  assert.equal(await pngOf(new Uint8Array([1, 2, 3])), null);
  /* Only Launch's own picture: any other address is never fetched. */
  assert.equal(await launchPicture(store, "http://localhost/api/x.png"), null);
  assert.equal(await launchPicture(store, "https://example.com/logo.png"), null);
  assert.equal(await launchPicture(store, `https://ryntra.io/api/launch/image/${"0".repeat(64)}`), null, "an address the store does not hold");
});
