import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { ensureRewardAccount } from "../rewards/ledger.ts";
import { cardDate, cardDollars, cardPercent, cardPeriod, cardPrice, cardWords, priceDecimals } from "./card-copy.ts";
import { privateAddress } from "./public-address.ts";
import { listShareableTrades, makeTradeCard, readTradeCard, tokenFacts } from "./card-store.ts";
import { setBoardVisibility } from "./league-store.ts";
import { referralDestination } from "./referral-destination.ts";
import {
  heldDays,
  shareableTrades,
  TRADE_CARD_ART_REVISION,
  TradeCardSchema,
  tradeCardId,
  tradeCardImagePath,
  tradeCardPath,
  tradeCardVersion,
  tradeKey,
  unitPrice,
} from "./trade-cards.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const ELSE = "ELsEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const addr = (tag) => `${tag}${"x".repeat(44)}`.slice(0, 44);
const ME = addr("Me");
const DAY = 86_400_000;
const T0 = Date.parse("2026-10-01T09:00:00.000Z");
const at = (days, hours = 0) => new Date(T0 + days * DAY + hours * 3_600_000).toISOString();

let serial = 0;
/** A settled swap: `out` left, `arrived` came in; whole units of 6 decimals. */
function swap({ wallet = ME, out, outAmount, arrived, inAmount, days, statedUsd = null, outcome = "DONE", network = "mainnet", symbols = {} }) {
  serial += 1;
  const leg = (mint, amount) => ({ mint, amountRaw: String(Math.round(amount * 1_000_000)), decimals: 6, symbol: symbols[mint] ?? (mint === USDC ? "USDC" : null) });
  return {
    schema: "ryntra.solana.wallet-action",
    schemaVersion: "1.0.0",
    version: 0,
    network,
    wallet,
    actionId: `sig${String(serial).padStart(6, "0")}`,
    lane: "SWAP",
    outcome,
    out: leg(out, outAmount),
    in: leg(arrived, inAmount),
    destination: null,
    signature: null,
    receiptHash: null,
    sourceTx: null,
    destinationTx: null,
    fee: null,
    origin: null,
    providerRef: null,
    statedUsd,
    startedAt: at(days),
    updatedAt: at(days),
  };
}

const buy = (mint, usd, qty, days, extra = {}) => swap({ out: USDC, outAmount: usd, arrived: mint, inAmount: qty, days, ...extra });
const sell = (mint, qty, usd, days, extra = {}) => swap({ out: mint, outAmount: qty, arrived: USDC, inAmount: usd, days, ...extra });

const noCatalog = { markets: async () => ({ ok: false }) };
const catalogOf = (byMint) => ({ markets: async () => ({ ok: true, byMint: new Map(Object.entries(byMint)) }) });

test("a sale's card result is measured against what was paid through Ryntra, newest first", () => {
  const actions = [buy(BONK, 100, 1_000, 0), sell(BONK, 1_000, 142.5, 3)];
  const trades = shareableTrades(actions, ME);
  assert.deepEqual(trades.map((trade) => trade.kind), ["SELL", "BUY"]);
  const [sale, purchase] = trades;
  assert.equal(sale.resultBps, 4250);
  assert.equal(sale.costMicros, 100_000_000n);
  assert.equal(sale.proceedsMicros, 142_500_000n);
  assert.equal(sale.openedAt, at(0));
  assert.equal(sale.at, at(3));
  assert.equal(purchase.resultBps, null);
  assert.equal(purchase.costMicros, 100_000_000n);
});

test("a loss is a card exactly like a gain — no filter for wins", () => {
  const trades = shareableTrades([buy(WIF, 200, 50, 0), sell(WIF, 50, 150, 1)], ME);
  assert.equal(trades[0].kind, "SELL");
  assert.equal(trades[0].resultBps, -2500);
});

test("a sale of tokens that came from elsewhere, or were bought unmeasured, has no card", () => {
  /* Bought for another token without a dollar figure: the cost is unknown. */
  const unmeasured = [swap({ out: ELSE, outAmount: 5, arrived: BONK, inAmount: 1_000, days: 0 }), sell(BONK, 1_000, 120, 2)];
  assert.deepEqual(shareableTrades(unmeasured, ME).map((trade) => trade.kind), []);
  /* Never bought through Ryntra at all. */
  assert.deepEqual(shareableTrades([sell(BONK, 500, 80, 1)], ME), []);
});

test("a part known and a part unknown: the result counts the known part only", () => {
  const actions = [
    swap({ out: ELSE, outAmount: 5, arrived: BONK, inAmount: 1_000, days: 0 }),
    buy(BONK, 100, 1_000, 1),
    sell(BONK, 2_000, 300, 2),
  ];
  const [sale] = shareableTrades(actions, ME);
  assert.equal(sale.kind, "SELL");
  assert.equal(sale.quantityRaw, 1_000_000_000n);
  assert.equal(sale.costMicros, 100_000_000n);
  assert.equal(sale.proceedsMicros, 150_000_000n);
  assert.equal(sale.resultBps, 5000);
});

test("a token for a token is the sale of one and the buy of the other", () => {
  const actions = [buy(BONK, 100, 1_000, 0), swap({ out: BONK, outAmount: 1_000, arrived: WIF, inAmount: 40, days: 2, statedUsd: 130 })];
  const trades = shareableTrades(actions, ME);
  assert.deepEqual(trades.map(tradeKey), [`SELL:${actions[1].actionId}`, `BUY:${actions[1].actionId}`, `BUY:${actions[0].actionId}`]);
  assert.equal(trades[0].resultBps, 3000);
  assert.equal(trades[1].mint, WIF);
  assert.equal(trades[1].costMicros, 130_000_000n);
});

test("a position emptied and opened again dates its sale from the new opening", () => {
  const actions = [buy(BONK, 100, 1_000, 0), sell(BONK, 1_000, 90, 1), buy(BONK, 50, 500, 5), sell(BONK, 500, 60, 7)];
  const [latest] = shareableTrades(actions, ME);
  assert.equal(latest.openedAt, at(5));
  assert.equal(heldDays(latest.openedAt, latest.at), 2);
  assert.equal(latest.resultBps, 2000);
});

test("only this wallet's settled mainnet swaps count", () => {
  const actions = [
    buy(BONK, 100, 1_000, 0, { wallet: addr("Other") }),
    buy(BONK, 100, 1_000, 0, { outcome: "FAILED" }),
    buy(BONK, 100, 1_000, 0, { network: "devnet" }),
  ];
  assert.deepEqual(shareableTrades(actions, ME), []);
});

test("a card's id is the wallet, the trade and how it is drawn; its version is every figure and the drawing", () => {
  const base = { wallet: ME, key: "SELL:sig1", locale: "en", amounts: false };
  assert.equal(tradeCardId(base), tradeCardId({ ...base }));
  assert.match(tradeCardId(base), /^[a-z0-9]{20}$/);
  assert.notEqual(tradeCardId(base), tradeCardId({ ...base, amounts: true }));
  assert.notEqual(tradeCardId(base), tradeCardId({ ...base, locale: "uk" }));
  assert.notEqual(tradeCardId(base), tradeCardId({ ...base, wallet: addr("Other") }));
  assert.match(TRADE_CARD_ART_REVISION, /^\d{4}-\d{2}-\d{2}\.\d+$/);
});

test("a card is made once from the receipts, with the code and the rank of the moment", async () => {
  const store = createMemoryGuardStore();
  const actions = [buy(BONK, 100, 1_000, 0), sell(BONK, 1_000, 142.5, 3)];
  for (const action of actions) await store.collection("solanaWalletActions").set(`solana:mainnet:${ME}:${action.actionId}`, action);
  const now = at(4);

  const missing = await makeTradeCard(store, { wallet: ME, key: "SELL:nope", locale: "en", amounts: false, now }, noCatalog);
  assert.equal(missing.state, "NOT_FOUND");

  const key = `SELL:${actions[1].actionId}`;
  const made = await makeTradeCard(store, { wallet: ME, key, locale: "uk", amounts: false, now }, catalogOf({ [BONK]: { symbol: "Bonk", name: "Bonk", icon: "https://arweave.net/bonk.png", category: "meme" } }));
  assert.equal(made.state, "MADE");
  const card = made.card;
  assert.equal(TradeCardSchema.safeParse(card).success, true);
  assert.equal(card.code, (await ensureRewardAccount(store, ME, now)).code);
  assert.equal(card.rank, "BRONZE");
  assert.equal(card.token.symbol, "Bonk");
  assert.equal(card.token.icon, "https://arweave.net/bonk.png");
  assert.equal(card.token.stock, false);
  assert.equal(card.trade.resultBps, 4250);
  assert.equal(card.trade.costMicros, "100000000");
  assert.equal(card.trade.proceedsMicros, "142500000");
  assert.equal(tradeCardPath(card), `/r/${card.code}/c/${card.id}`);
  assert.equal(tradeCardImagePath(card), `/api/growth/cards/${card.id}/image?v=${tradeCardVersion(card)}`);

  const again = await makeTradeCard(store, { wallet: ME, key, locale: "uk", amounts: false, now: at(9) }, noCatalog);
  assert.equal(again.state, "EXISTING");
  assert.deepEqual(again.card, card);
  assert.deepEqual(await readTradeCard(store, card.id), card);
  assert.equal(await readTradeCard(store, "../../etc"), null);

  /* Shown with dollars, it is another card with its own version. */
  const dollars = await makeTradeCard(store, { wallet: ME, key, locale: "uk", amounts: true, now }, noCatalog);
  assert.notEqual(dollars.card.id, card.id);
  assert.equal(dollars.card.amounts, true);
  assert.notEqual(tradeCardVersion(dollars.card), tradeCardVersion(card));
});

test("a wallet hidden from the boards makes cards without a rank", async () => {
  const store = createMemoryGuardStore();
  const action = buy(WIF, 25, 10, 0);
  await store.collection("solanaWalletActions").set(`solana:mainnet:${ME}:${action.actionId}`, action);
  await setBoardVisibility(store, { wallet: ME, hidden: true, now: at(1) });
  const made = await makeTradeCard(store, { wallet: ME, key: `BUY:${action.actionId}`, locale: "en", amounts: false, now: at(1) }, noCatalog);
  assert.equal(made.state, "MADE");
  assert.equal(made.card.rank, null);
  /* No catalogue: the receipt's symbol, else four and four of the mint — never an invented ticker. */
  assert.equal(made.card.token.symbol, "EKpQ…zcjm");
});

test("the sheet's list is the wallet's trades, of one token when asked", async () => {
  const store = createMemoryGuardStore();
  const actions = [buy(BONK, 100, 1_000, 0), buy(WIF, 20, 10, 1), sell(BONK, 1_000, 110, 2)];
  for (const action of actions) await store.collection("solanaWalletActions").set(`solana:mainnet:${ME}:${action.actionId}`, action);
  const all = await listShareableTrades(store, ME, null);
  assert.equal(all.trades.length, 3);
  const bonk = await listShareableTrades(store, ME, BONK);
  assert.deepEqual(bonk.trades.map((trade) => trade.kind), ["SELL", "BUY"]);
  const facts = await tokenFacts(bonk.trades, catalogOf({ [BONK]: { symbol: "Bonk\u202e\u0007", name: null, icon: "http://plain.example/i.png", category: "stock" } }));
  assert.deepEqual(facts.get(BONK), { symbol: "Bonk", name: null, icon: null, stock: true });
});

test("the words: signed percents and dollars, a loss with a true minus, Ukrainian days", () => {
  assert.equal(cardPercent(4250, "en"), "+42.5%");
  assert.equal(cardPercent(-2500, "uk"), "−25,0 %");
  assert.equal(cardPercent(0, "en"), "0.0%");
  assert.equal(cardDollars(1_234_567_890n, "en"), "$1,234.57");
  assert.equal(cardDollars(-42_500_000n, "uk", true), "−$42,50");
  assert.equal(cardDollars(1_234_000_000n, "uk"), "$1 234,00");
  assert.equal(cardPrice(0.0000213, "en"), "$0.0000213");
  assert.equal(cardPrice(182.3, "en"), "$182.30");
  assert.equal(cardPrice(0.6, "en"), "$0.60");
  /* Entry and exit at one count of decimals, so they read alike. */
  const decimals = priceDecimals([0.00002, 0.00002856]);
  assert.equal(cardPrice(0.00002, "en", decimals), "$0.0000200");
  assert.equal(cardPrice(0.00002856, "uk", decimals), "$0,0000286");
  assert.equal(cardWords("uk").held(1), "1 день");
  assert.equal(cardWords("uk").held(3), "3 дні");
  assert.equal(cardWords("uk").held(11), "11 днів");
  assert.equal(cardWords("en").held(0), "same day");
  assert.equal(cardPeriod(at(0), at(0, 5), "en"), cardDate(at(0), "en"));
  assert.equal(cardPeriod(at(0), at(3), "en"), "1–4 Oct 2026");
  assert.equal(cardPeriod(at(-5), at(3), "en"), "26 Sept – 4 Oct 2026");
});

test("the offer is the product's sentence, and no card word promises", () => {
  for (const locale of ["en", "uk"]) {
    const words = cardWords(locale);
    const all = JSON.stringify(Object.fromEntries(Object.entries(words).filter(([, value]) => typeof value === "string")));
    assert.doesNotMatch(all, /guarantee|гарант|passive|пасивн|airdrop|аірдроп|токен скоро|\bRyn\b|earn money|заробляй/i);
  }
  assert.equal(cardWords("uk").offer, "Кешбек 50 % кожному з першої угоди");
});

test("a referral link lands only on this site's product pages", () => {
  const base = "https://ryntra.io/r/ABCDEFGHJKLM";
  const to = (value) => referralDestination(value, base).toString();
  assert.equal(to(null), "https://ryntra.io/app/rewards");
  assert.equal(to(`/app/spot?mint=${BONK}`), `https://ryntra.io/app/spot?mint=${BONK}`);
  assert.equal(to(`/app/launch/${BONK}`), `https://ryntra.io/app/launch/${BONK}`);
  for (const bad of ["//evil.example/app", "https://evil.example/app", "/\\evil.example", "/docs", "/application", "javascript:alert(1)", "/app/\u0000x", "app/spot"]) {
    assert.equal(to(bad), "https://ryntra.io/app/rewards", bad);
  }
});

test("a token's unit price is display-only and absent without decimals", () => {
  assert.equal(unitPrice(100_000_000n, 1_000_000_000n, 6), 0.1);
  assert.equal(unitPrice(100_000_000n, 1_000_000_000n, null), null);
  assert.equal(unitPrice(1n, 0n, 6), null);
});

test("the trade's line carries its period and never reads as a price move", () => {
  assert.equal(cardWords("en").tradeLine("Bonk", "+42.8%", 9), "Bonk trade on Ryntra: +42.8% in 9 days");
  assert.equal(cardWords("en").tradeLine("Bonk", "−12.0%", 0), "Bonk trade on Ryntra: −12.0%, same day");
  assert.equal(cardWords("uk").tradeLine("Bonk", "+42,8 %", 3), "Угода Bonk у Ryntra: +42,8 % за 3 дні");
  assert.equal(cardWords("uk").tradeLine("JUP", null, null), "Купівля JUP у Ryntra");
  assert.equal(cardWords("en").postText("Bonk", "+42.8%", 1), "Bonk trade on Ryntra: +42.8% in 1 day");
});

test("a token's picture is fetched only from public addresses", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe", "198.18.0.1", "::7f00:1", "64:ff9b::a9fe:a9fe", "2002:c0a8:101::1"]) {
    assert.equal(privateAddress(ip), true, ip);
  }
  for (const ip of ["104.18.12.1", "172.15.0.1", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "8.8.8.8"]) {
    assert.equal(privateAddress(ip), false, ip);
  }
});

test("a history that cannot be read whole makes no card", async () => {
  const store = createMemoryGuardStore();
  const action = buy(BONK, 100, 1_000, 0);
  await store.collection("solanaWalletActions").set(`solana:mainnet:${ME}:${action.actionId}`, action);
  await store.collection("solanaWalletActions").set(`solana:mainnet:${ME}:broken`, { schema: "nonsense" });
  const made = await makeTradeCard(store, { wallet: ME, key: `BUY:${action.actionId}`, locale: "en", amounts: false, now: at(1) }, noCatalog);
  assert.equal(made.state, "INCOMPLETE");
  assert.equal((await listShareableTrades(store, ME, null)).complete, false);
});
