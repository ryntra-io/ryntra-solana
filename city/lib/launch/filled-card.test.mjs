// The filled order's card: every figure is the order's own, read from the chain; nothing filled — no card.
import assert from "node:assert/strict";
import test from "node:test";

import { cardFace, filledPriceText, postText } from "./card-words.ts";
import { cardFile, filledCard } from "./cards.ts";

const SOL = "So11111111111111111111111111111111111111112";
const COIN = { token: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", logo: false };
/* A ladder of 25 prices bought with SOL: six filled — 0,12 SOL of it — at 0,0000186 SOL a coin, with a bonus of 0,00048 SOL. */
const BUY = { action: "buy", prices: 25, filledPrices: 6, filledRaw: "120000000", proceedsRaw: "645161290322", filledPrice: 0.0000186, quote: { mint: SOL, decimals: 9 }, bonus: { mint: SOL, ownerRaw: "480000" } };
const SELL = { action: "sell", prices: 1, filledPrices: 1, filledRaw: "400000000000", proceedsRaw: "15000000", filledPrice: 0.0000375, quote: { mint: SOL, decimals: 9 }, bonus: { mint: SOL, ownerRaw: "60000" } };
const card = (order, tag = null) => filledCard({ coin: COIN, pairSymbol: "SOL", order, tag });

test("a card is the order's own figures: what filled in the pair coin, the price it filled at, the bonus that came with it", () => {
  const bought = card(BUY);
  assert.deepEqual(bought, { kind: "filled", coin: COIN, pair: { symbol: "SOL", decimals: 9, dollar: false }, action: "buy", filledPrices: 6, prices: 25, pairRaw: "120000000", price: 0.0000186, blended: true, touched: 6, bonusRaw: "480000", tag: null });
  /* A sale is counted in what it was paid. */
  const sold = card(SELL);
  assert.deepEqual([sold.action, sold.pairRaw, sold.filledPrices, sold.prices], ["sell", "15000000", 1, 1]);
  /* A bonus paid in the coin itself is not written as the pair coin's money. */
  assert.equal(card({ ...BUY, bonus: { mint: COIN.token, ownerRaw: "999" } }).bonusRaw, null);
  assert.equal(card({ ...BUY, bonus: { mint: SOL, ownerRaw: "0" } }).bonusRaw, null);
  assert.equal(filledCard({ coin: COIN, pairSymbol: "USDC", order: { ...BUY, quote: { mint: "usdc", decimals: 6 }, bonus: { mint: "usdc", ownerRaw: "1" } }, tag: null }).pair.dollar, true);
  assert.equal(cardFile(bought), "ryntra-bonk-filled.png");
});

test("nothing filled whole, or a price not read: no card", () => {
  assert.equal(card({ ...BUY, filledPrices: 0 }), null);
  assert.equal(card({ ...BUY, filledPrice: null }), null);
  assert.equal(card({ ...BUY, filledPrice: 0 }), null);
  assert.equal(card({ ...BUY, filledRaw: "0" }), null);
  assert.equal(card({ ...SELL, proceedsRaw: "0" }), null);
  /* An order taken whole has no side left: what it filled was shared while it stood. */
  assert.equal(card({ ...BUY, action: null }), null);
});

test("the card says it in the language on screen: the ticker, the exact price, how much of the ladder filled", () => {
  const en = cardFace(card(BUY), "en");
  assert.deepEqual(en.kicker, ["Bought cheaper — at my price."]);
  assert.equal(en.hero, "$BONK");
  assert.equal(en.unit, "filled at 0.0000186 SOL on average", "six prices filled: their average, said as one");
  assert.equal(en.line, "6 of 25 prices · 0.12 SOL", "a bonus under a cent of the pair coin is left off, not written as «+<0.01»");
  assert.equal(cardFace(card({ ...BUY, bonus: { mint: SOL, ownerRaw: "25000000" } }), "en").line, "6 of 25 prices · 0.12 SOL · +0.02 SOL back");
  assert.deepEqual([en.tone, en.frame, en.tag], ["mint", "live", null]);
  const uk = cardFace(card(SELL), "uk");
  assert.deepEqual(uk.kicker, ["Продав дорожче — за своєю ціною."]);
  assert.equal(uk.unit, "виконано по 0,0000375 SOL");
  assert.equal(uk.line, "1 з 1 ціни · 0,01 SOL", "money on a card is cut, never rounded up");
  /* A price is never rounded up into a better one: four figures, cut as written. */
  assert.equal(filledPriceText({ price: 0.000018649, pair: { symbol: "SOL" } }, "en"), "0.00001865 SOL");
});

test("test money is never shared as real money: the tag is on the card and opens the post", () => {
  const devnet = card(BUY, "devnet");
  assert.match(cardFace(devnet, "en").tag ?? "", /devnet/i);
  assert.match(postText(devnet, "en"), /^DEVNET · My ladder on \$BONK: 6 prices hit, each at the exact price I set — 0\.0000186 SOL on average\. On Ryntra\.$/i);
  assert.equal(postText(card(SELL), "en"), "Sold $BONK at 0.0000375 SOL — the exact price I set. On Ryntra.");
  assert.equal(postText(card(BUY), "uk"), "Моя драбина на $BONK: спрацювало 6 цін, кожна рівно за моєю ціною — в середньому 0,0000186 SOL. На Ryntra.");
  assert.equal(postText(card({ ...BUY, filledPrices: 1 }), "uk"), "Мій ордер на $BONK виконано по 0,0000186 SOL — рівно за моєю ціною. На Ryntra.");
  /* One price whole and one in part: what filled is a blend, never «the exact price I set». */
  const blend = card({ ...BUY, filledPrices: 1, partialPrices: 1 });
  assert.equal(blend.blended, true);
  assert.match(cardFace(blend, "en").unit, /on average$/);
  assert.equal(postText(blend, "en"), "My ladder on $BONK: 2 prices hit, each at the exact price I set — 0.0000186 SOL on average. On Ryntra.");
  /* The card and the post count the same prices. */
  assert.match(cardFace(blend, "en").line, /^2 of 25 prices/);
});
