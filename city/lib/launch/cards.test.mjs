import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { LaunchMarketResponseSchema } from "../../../lib/api/v1/contract.ts";
import { districtFrame } from "../art/frames.ts";
import { cardFace, costText, flewText, holdersText, multipleText, postText, roundKicker } from "./card-words.ts";
import { BIRTH_MS, cardFile, cardTag, creatorCard, legOf, roundTrip, tickerOf } from "./cards.ts";
import { fillsOf, keepFill } from "./fills.ts";
import { STUB_CREATOR, STUB_WALLET, stubAddress, stubEngine, stubWallet } from "./stub.ts";
import { runLaunchTrade } from "./trade-flow.ts";
import { stubTradeEngine } from "./trade-stub.ts";

/* The launch's share cards (L8 · CITY-145): «Народилась» and «Вийшла» for the creator, the trader's round trip — every
   figure on a card is the engine's, a figure not read is left off, and a round trip that does not add up is no card. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const LAUNCHED = Date.parse("2026-10-20T12:00:00Z");
const WALLET = stubAddress("wallet:trader");
const OTHER = stubAddress("wallet:other");
const TOKEN = stubAddress("token:owl");
const USDC = { mint: stubAddress("usdc"), symbol: "USDC", decimals: 6, dollar: true };
const sig = (seed) => `${seed}`.padEnd(88, "1").slice(0, 88);

const ROW = { token: TOKEN, symbol: "owl", image: "https://example.invalid/owl.png", launchedAt: new Date(LAUNCHED).toISOString(), migrated: false, progressBps: 4_287 };

function trade(seed, at, side, venue, tokensRaw, pairRaw, trader = WALLET) {
  return { signature: sig(seed), at: new Date(at).toISOString(), side, venue, trader, payer: trader, traderLabels: [], tokensRaw: String(tokensRaw), pairRaw: String(pairRaw), feeRaw: "0", marketCapPair: 1 };
}

/** A market as the engine answers it: only what the round trip reads, the rows newest first. */
function market(rows, { complete = true, read = rows.length } = {}) {
  return { token: TOKEN, pair: USDC, trades: { rows: [...rows].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), complete, read } };
}

/** The sale a card is for: by default the wallet's newest sale among the rows. */
const lastSale = (rows) => [...rows].filter((row) => row.side === "sell" && row.trader === WALLET).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]?.signature ?? sig("none");
const round = (rows, extra = {}) => roundTrip({ market: market(rows, extra.cover), symbol: "owl", logo: true, wallet: WALLET, launchedAt: LAUNCHED, heldRaw: null, tag: null, sale: lastSale(rows), ...extra });

/* ---------------------------------------------------------------- the creator's two cards */

test("«Born»: the launch's own time, the curve's way rounded down, the feed's holders — nothing else", () => {
  const card = creatorCard("born", ROW, { graduation: null, holders: { count: 58, atLeast: false }, tag: null });
  assert.deepEqual(card, { kind: "born", coin: { token: TOKEN, symbol: "OWL", logo: true }, at: LAUNCHED, holders: { count: 58, atLeast: false }, progressPct: 42, flewMs: null, tag: null });
  /* Holders not read, or none: left off rather than «0 holders». */
  assert.equal(creatorCard("born", ROW, { graduation: null, holders: null, tag: null }).holders, null);
  assert.equal(creatorCard("born", ROW, { graduation: null, holders: { count: 0, atLeast: false }, tag: null }).holders, null);
  /* In the pool there is no way to the exit left to show; an unparsable launch time is no card at all. */
  assert.equal(creatorCard("born", { ...ROW, migrated: true, progressBps: 10_000 }, { graduation: null, holders: null, tag: null }).progressPct, null);
  assert.equal(creatorCard("born", { ...ROW, launchedAt: "not a date" }, { graduation: null, holders: null, tag: null }), null);
});

test("«Graduated»: only once the coin moved and the chain's mark of the move was read; the time it flew from the two marks", () => {
  const facts = { graduation: { at: LAUNCHED + 23 * HOUR + 40 * MINUTE }, holders: { count: 214, atLeast: true }, tag: "devnet" };
  assert.equal(creatorCard("graduated", ROW, facts), null, "still on its curve");
  assert.equal(creatorCard("graduated", { ...ROW, migrated: true }, { ...facts, graduation: null }), null, "the move's mark not read");
  const card = creatorCard("graduated", { ...ROW, migrated: true }, facts);
  assert.equal(card.at, facts.graduation.at);
  assert.equal(card.flewMs, 23 * HOUR + 40 * MINUTE);
  assert.equal(card.tag, "devnet");
  /* Two marks that disagree say nothing of how long it flew. */
  assert.equal(creatorCard("graduated", { ...ROW, migrated: true }, { ...facts, graduation: { at: LAUNCHED - 1 } }).flewMs, null);
});

test("a test card says so: devnet and the stand carry their tag, mainnet none", () => {
  assert.equal(cardTag("solana:devnet", false), "devnet");
  assert.equal(cardTag("solana:mainnet", true), "stub");
  assert.equal(cardTag("solana:mainnet", false), null);
  assert.equal(cardTag(null, false), null);
});

/* ---------------------------------------------------------------- the trader's round trip */

test("bought at birth, sold at the exit: paid and received are the wallet's own rows, the multiple their ratio", () => {
  const card = round([
    trade("buy", LAUNCHED + 42_000, "buy", "curve", 1_000_000_000, 25_000_000),
    trade("other", LAUNCHED + 50_000, "buy", "curve", 9_000_000_000, 400_000_000, OTHER),
    trade("sell", LAUNCHED + 2 * DAY, "sell", "pool", 1_000_000_000, 187_500_000),
    trade("other2", LAUNCHED + 3 * DAY, "sell", "pool", 9_000_000_000, 9_000_000_000, OTHER),
  ]);
  assert.equal(card.paidRaw, "25000000");
  assert.equal(card.receivedRaw, "187500000");
  assert.equal(card.gainRaw, "162500000");
  assert.equal(card.multiple, 7.5);
  assert.equal(card.up, true);
  assert.equal(card.bought, "birth");
  assert.equal(card.sold, "exit");
  assert.deepEqual(card.coin, { token: TOKEN, symbol: "OWL", logo: true });
  assert.deepEqual(card.pair, { symbol: "USDC", decimals: 6, dollar: true });
});

test("first bought, first sold: a part sale carries its share of the oldest buy's price, rounded up", () => {
  const part = round([trade("b", LAUNCHED + MINUTE, "buy", "curve", 3, 10), trade("s", LAUNCHED + DAY, "sell", "pool", 1, 9)], { heldRaw: "2", cover: { complete: false } });
  /* 10 × 1 ÷ 3 = 3.33… → 4: the cost never reads lower than it was. */
  assert.equal(part.paidRaw, "4");
  assert.equal(part.receivedRaw, "9");
  const two = round([
    trade("b1", LAUNCHED + MINUTE, "buy", "curve", 1_000, 25),
    trade("b2", LAUNCHED + HOUR, "buy", "curve", 1_000, 100),
    trade("s1", LAUNCHED + DAY, "sell", "pool", 1_500, 300),
  ]);
  assert.equal(two.paidRaw, "75", "the whole first buy and half the second");
  assert.equal(two.multiple, 4);
  assert.equal(two.bought, "curve", "half the sold tokens were bought an hour in: not «at birth»");
});

test("a round trip that does not add up is no card", () => {
  const rows = [trade("b", LAUNCHED + MINUTE, "buy", "curve", 1_000, 25), trade("s", LAUNCHED + DAY, "sell", "pool", 1_000, 200)];
  /* The rows are not every trade (read in part, or more read than listed): the balance must close the sum. */
  assert.equal(round(rows, { cover: { complete: false } }), null, "balance not read");
  assert.equal(round(rows, { cover: { complete: true, read: 500 } }), null, "more trades read than the rows list");
  assert.equal(round(rows, { cover: { complete: false }, heldRaw: "300" }), null, "a buy not found: 300 more held than the trades found leave");
  assert.ok(round(rows, { cover: { complete: false }, heldRaw: "0" }), "found trades leave exactly what the chain shows");
  /* More sold than any buy found — tokens sent in, or bought before the rows — never counts. */
  assert.equal(round([trade("b", LAUNCHED + MINUTE, "buy", "curve", 500, 25), trade("s", LAUNCHED + DAY, "sell", "pool", 1_000, 200)]), null);
  /* A sale before any buy, nothing sold, nothing bought. */
  assert.equal(round([trade("s", LAUNCHED + MINUTE, "sell", "curve", 10, 5), trade("b", LAUNCHED + DAY, "buy", "pool", 10, 1)]), null);
  assert.equal(round([trade("b", LAUNCHED + MINUTE, "buy", "curve", 10, 5)]), null);
  assert.equal(round([trade("s", LAUNCHED + MINUTE, "sell", "curve", 10, 5, OTHER)]), null);
});

test("the city's own fill counts once: the market's row of the same trade wins with the chain's time", () => {
  const buy = trade("b", LAUNCHED + 30_000, "buy", "curve", 1_000, 20);
  const fresh = legOf({ signature: sig("s"), side: "sell", venue: "pool", filled: { tokensRaw: "1000", pairRaw: "90" } }, LAUNCHED + DAY);
  const withFresh = round([buy], { extra: [fresh], sale: sig("s") });
  assert.equal(withFresh.receivedRaw, "90");
  const twice = round([buy, trade("s", LAUNCHED + DAY - 5_000, "sell", "pool", 1_000, 90)], { extra: [fresh, { ...fresh }] });
  assert.equal(twice.receivedRaw, "90");
  /* A fill the engine could not read yet is no leg. */
  assert.equal(legOf({ signature: sig("x"), side: "buy", venue: "curve", filled: null }, LAUNCHED), null);
  /* The buy at birth the newest rows no longer carry, kept by this browser: the balance still has to close the sum. */
  const kept = legOf({ signature: sig("k"), side: "buy", venue: "curve", filled: { tokensRaw: "1000", pairRaw: "20" } }, LAUNCHED + 30_000);
  const late = [trade("s2", LAUNCHED + DAY, "sell", "pool", 1_000, 90)];
  assert.equal(round(late, { cover: { complete: true, read: 900 } }), null);
  const found = round(late, { cover: { complete: true, read: 900 }, extra: [kept], heldRaw: "0" });
  assert.equal(found.multiple, 4.5);
  assert.equal(found.bought, "curve", "a buy timed by this device never claims «at birth»");
  assert.equal(round(late, { cover: { complete: true, read: 900 }, extra: [kept], heldRaw: "50" }), null);
  /* Even beside rows that list every trade, a kept fill they do not list is not taken on trust. */
  assert.equal(round(late, { extra: [kept] }), null, "balance not read");
  assert.ok(round(late, { extra: [kept], heldRaw: "0" }));
});

test("the card is for the sale just made: a sale whose fill was not read yet is no card, never the sales before it", () => {
  const rows = [trade("b", LAUNCHED + MINUTE, "buy", "curve", 1_000, 25), trade("s1", LAUNCHED + HOUR, "sell", "pool", 500, 100)];
  /* The second sale (a loss) came back without a fill: the earlier sale's 8× must not stand in for it. */
  assert.equal(round(rows, { sale: sig("s2") }), null);
  assert.equal(round(rows, { sale: sig("s2"), cover: { complete: false }, heldRaw: "500" }), null);
  const fresh = legOf({ signature: sig("s2"), side: "sell", venue: "pool", filled: { tokensRaw: "500", pairRaw: "5" } }, LAUNCHED + DAY);
  const both = round(rows, { sale: sig("s2"), extra: [fresh] });
  assert.equal(both.receivedRaw, "105");
  assert.equal(both.paidRaw, "25");
  /* The sale listed by the rows themselves counts as found. */
  assert.ok(round(rows, { sale: sig("s1") }));
  /* A buy is never the sale the card is for. */
  assert.equal(round(rows, { sale: sig("b") }), null);
});

test("the market's rows as they come: a buy and a sale in the same second read buy first; two events of one transaction sum", () => {
  const flip = round([trade("s", LAUNCHED + MINUTE, "sell", "curve", 10, 30), trade("b", LAUNCHED + MINUTE, "buy", "curve", 10, 10)]);
  assert.equal(flip.multiple, 3);
  const one = round([trade("t", LAUNCHED + MINUTE, "buy", "curve", 10, 1), trade("t", LAUNCHED + MINUTE, "buy", "curve", 10, 99), trade("s", LAUNCHED + DAY, "sell", "pool", 20, 200)]);
  assert.equal(one.paidRaw, "100", "both buys of the transaction, not the cheaper alone");
  assert.equal(one.multiple, 2);
});

test("where it was bought and sold: birth is the curve's first minutes; the exit is the pool after a buy before it", () => {
  const sell = trade("s", LAUNCHED + DAY, "sell", "pool", 10, 50);
  assert.equal(round([trade("b", LAUNCHED + BIRTH_MS, "buy", "curve", 10, 5), sell]).bought, "birth");
  assert.equal(round([trade("b", LAUNCHED + BIRTH_MS + 1, "buy", "curve", 10, 5), sell]).bought, "curve");
  assert.equal(round([trade("b", LAUNCHED + MINUTE, "buy", "curve", 10, 5), sell], { launchedAt: null }).bought, "curve", "no launch time, no «birth»");
  const dex = round([trade("b", LAUNCHED + 2 * HOUR, "buy", "pool", 10, 5), trade("s", LAUNCHED + DAY, "sell", "pool", 10, 50)]);
  assert.deepEqual([dex.bought, dex.sold], ["pool", "dex"]);
  const curve = round([trade("b", LAUNCHED + MINUTE, "buy", "curve", 10, 5), trade("s", LAUNCHED + HOUR, "sell", "curve", 10, 9)]);
  assert.deepEqual([curve.bought, curve.sold], ["birth", "curve"]);
  /* A crumb bought at birth does not make a big buy an hour later «at birth»; one sale on the curve is not «the exit». */
  const crumb = round([trade("b1", LAUNCHED + MINUTE, "buy", "curve", 1, 1), trade("b2", LAUNCHED + HOUR, "buy", "curve", 1_000, 1_000), trade("s", LAUNCHED + DAY, "sell", "pool", 1_001, 2_100)]);
  assert.deepEqual([crumb.bought, crumb.sold], ["curve", "exit"]);
  const mixed = round([trade("b", LAUNCHED + MINUTE, "buy", "curve", 10, 5), trade("s1", LAUNCHED + HOUR, "sell", "curve", 5, 9), trade("s2", LAUNCHED + DAY, "sell", "pool", 5, 50)]);
  assert.deepEqual([mixed.bought, mixed.sold], ["birth", "curve"]);
  /* Half bought on the curve, half on the DEX: neither story, just «bought». */
  const both = round([trade("b1", LAUNCHED + HOUR, "buy", "curve", 10, 5), trade("b2", LAUNCHED + 2 * DAY, "buy", "pool", 10, 50), trade("s", LAUNCHED + 3 * DAY, "sell", "pool", 20, 120)]);
  assert.deepEqual([both.bought, both.sold], ["mixed", "exit"]);
  assert.deepEqual(roundKicker(both, "en"), ["Bought.", "Sold at the exit."]);
});

test("a loss is counted as it is: the gain below zero, not up", () => {
  const loss = round([trade("b", LAUNCHED + MINUTE, "buy", "curve", 10, 50), trade("s", LAUNCHED + DAY, "sell", "pool", 10, 20)]);
  assert.equal(loss.gainRaw, "-30");
  assert.equal(loss.up, false);
  assert.equal(loss.multiple, 0.4);
});

/* ---------------------------------------------------------------- what a card says */

const BORN = creatorCard("born", ROW, { graduation: null, holders: { count: 58, atLeast: false }, tag: null });
const GRADUATED = creatorCard("graduated", { ...ROW, migrated: true }, { graduation: { at: LAUNCHED + 23 * HOUR + 40 * MINUTE }, holders: { count: 1_214, atLeast: true }, tag: "devnet" });
const ROUND = round([trade("buy", LAUNCHED + 42_000, "buy", "curve", 1_000_000_000, 25_000_000), trade("sell", LAUNCHED + 2 * DAY, "sell", "pool", 1_000_000_000, 187_509_999)]);

test("the card's layout: a kicker, the one big figure, the amber line and one quiet line — all from the card's figures", () => {
  const born = cardFace(BORN, "en");
  assert.deepEqual(born.kicker, ["Born"]);
  assert.equal(born.hero, "$OWL");
  assert.equal(born.unit, "42% to exit");
  assert.match(born.line, /^58 holders · \d{1,2} Oct, \d\d:\d\d$/);
  assert.deepEqual([born.tone, born.frame, born.tag], ["mint", "docks", null]);

  const graduated = cardFace(GRADUATED, "uk");
  assert.deepEqual(graduated.kicker, ["Вийшла"]);
  assert.equal(graduated.unit, "за 23 год");
  assert.match(graduated.line, /^≥1\s214 тримачів · \d{1,2} жовт\., \d\d:\d\d$/);
  assert.deepEqual([graduated.tone, graduated.frame, graduated.tag], ["amber", "skyline", "DEVNET"]);

  const pnl = cardFace(ROUND, "en");
  assert.deepEqual(pnl.kicker, ["Bought at birth.", "Sold at the exit."]);
  assert.equal(pnl.hero, "7.5×");
  assert.equal(pnl.unit, "+$162.50", "the gain rounded down to the cent");
  assert.equal(pnl.line, "$OWL · $25.00 → $187.50");
  /* What was paid rounds up, what came back down: 25.000001 reads $25.01, never $25.00. */
  assert.equal(cardFace({ ...ROUND, paidRaw: "25000001" }, "en").line, "$OWL · $25.01 → $187.50");
  assert.equal(costText("1", USDC, "en"), "$0.01");
  assert.match(costText("1284600001", USDC, "uk"), /^\$1\s284,61$/);
  assert.equal(costText("1234567890000", USDC, "en"), "$1,234,567.89");
  assert.equal(costText("282358290000", USDC, "en"), "$282,358.29");
  assert.equal(costText("282358290001", USDC, "en"), "$282,358.30");
  assert.equal(costText("1500000", { ...USDC, dollar: false }, "en"), "1.50 USDC");
  assert.deepEqual([pnl.tone, pnl.frame], ["mint", "live"]);
  const uk = cardFace(ROUND, "uk");
  assert.deepEqual(uk.kicker, ["Купив на народженні —", "продав на виході"]);
  assert.equal(uk.hero, "7,5×");
  assert.equal(cardFace({ ...ROUND, tag: "stub" }, "uk").tag, "ТЕСТ");
});

test("figures said rounded down, never up: the multiple, the time it flew, the holders", () => {
  assert.equal(multipleText(7.59, "en"), "7.5×");
  assert.equal(multipleText(7.5, "uk"), "7,5×");
  assert.equal(multipleText(1, "en"), "1.0×");
  assert.equal(multipleText(142.99, "en"), "142×");
  assert.equal(multipleText(0.4, "en"), "0.4×");
  assert.equal(multipleText(Number.NaN, "en"), "—");
  assert.equal(flewText(20_000, "en"), "in 1 min");
  assert.equal(flewText(59 * MINUTE + 59_000, "en"), "in 59 min");
  assert.equal(flewText(47 * HOUR + 59 * MINUTE, "uk"), "за 47 год");
  assert.equal(flewText(3 * DAY + 23 * HOUR, "uk"), "за 3 дні");
  assert.equal(flewText(5 * DAY, "uk"), "за 5 днів");
  assert.equal(holdersText({ count: 1, atLeast: false }, "en"), "1 holder");
  assert.equal(holdersText({ count: 22, atLeast: false }, "uk"), "22 тримачі");
});

test("what the post says beside the card, and the card's file", () => {
  assert.equal(postText(BORN, "en"), "$OWL is born on Ryntra.");
  assert.equal(postText(GRADUATED, "uk"), "DEVNET · $OWL вийшла на Ryntra за 23 год.");
  assert.equal(postText({ ...GRADUATED, flewMs: null, tag: null }, "en"), "$OWL graduated on Ryntra.");
  assert.equal(postText(ROUND, "en"), "7.5× on $OWL. Bought at birth. Sold at the exit. On Ryntra.");
  assert.equal(postText(ROUND, "uk"), "7,5× на $OWL. Купив на народженні — продав на виході. На Ryntra.");
  /* A test card's words carry its tag too: the post never passes for real money without the picture. */
  assert.equal(postText({ ...ROUND, tag: "devnet" }, "en"), "DEVNET · 7.5× on $OWL. Bought at birth. Sold at the exit. On Ryntra.");
  assert.equal(postText({ ...BORN, tag: "stub" }, "uk"), "ТЕСТ · $OWL народилась на Ryntra.");
  assert.deepEqual(roundKicker({ bought: "curve", sold: "curve" }, "en"), ["Bought before the exit.", "Sold before the exit."]);
  assert.equal(cardFile(BORN), "ryntra-owl-born.png");
  assert.equal(cardFile(GRADUATED), "ryntra-owl-graduated.png");
  assert.equal(cardFile(ROUND), "ryntra-owl-x.png");
  assert.equal(cardFile({ ...BORN, coin: { ...BORN.coin, symbol: "🚀" } }), "ryntra-coin-born.png");
  assert.equal(tickerOf("$moth"), "MOTH");
});

/* ---------------------------------------------------------------- the city's own fills */

function memory() {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), map };
}

test("the fills this browser keeps: by signature, oldest first, a bad record read as none", () => {
  const storage = memory();
  const leg = (seed, at) => ({ signature: sig(seed), at, side: "buy", venue: "curve", tokensRaw: "10", pairRaw: "5", clock: "device" });
  keepFill(WALLET, TOKEN, leg("b", 20), storage);
  keepFill(WALLET, TOKEN, leg("a", 10), storage);
  keepFill(WALLET, TOKEN, leg("b", 20), storage);
  assert.deepEqual(fillsOf(WALLET, TOKEN, storage).map((l) => l.signature), [sig("a"), sig("b")]);
  assert.deepEqual(fillsOf(OTHER, TOKEN, storage), []);
  storage.setItem("ryntra:city:launch-fills", JSON.stringify({ [`${WALLET}:${TOKEN}`]: [{ signature: 1 }, leg("c", 5), { ...leg("d", 6), tokensRaw: "-4" }, { ...leg("e", 7), clock: "chain" }] }));
  assert.deepEqual(fillsOf(WALLET, TOKEN, storage).map((l) => l.signature), [sig("c")]);
  storage.setItem("ryntra:city:launch-fills", "{not json");
  assert.deepEqual(fillsOf(WALLET, TOKEN, storage), []);
  assert.deepEqual(fillsOf(WALLET, TOKEN, null), []);
  /* Forty trades a coin and thirty coins: the newest are kept. */
  for (let i = 0; i < 45; i += 1) keepFill(WALLET, TOKEN, leg(`n${i}`, 100 + i), storage);
  assert.equal(fillsOf(WALLET, TOKEN, storage).length, 40);
  for (let i = 0; i < 31; i += 1) keepFill(WALLET, stubAddress(`coin:${i}`), leg("x", i), storage);
  assert.equal(Object.keys(JSON.parse(storage.map.get("ryntra:city:launch-fills"))).length, 30);
  assert.deepEqual(fillsOf(WALLET, TOKEN, storage), [], "the oldest pair let go");
});

/* ---------------------------------------------------------------- on the stand */

test("on the stand: the stub wallet's Night Owl bought at birth, sold in the pool — the card's figures are the engine's", async () => {
  const launch = stubEngine();
  const OWL = stubAddress("OWL");
  const answer = await launch.market(OWL);
  LaunchMarketResponseSchema.parse(answer.data);
  const engine = stubTradeEngine({ market: (token) => launch.market(token) });
  const before = await engine.wallet(OWL, STUB_CREATOR);
  const mine = answer.data.trades.rows.filter((row) => row.trader === STUB_CREATOR);
  assert.equal(mine.length, 1);
  assert.equal(before.data.tokenRaw, mine[0].tokensRaw, "the stand's wallet holds what its own trades left it");

  const signer = stubWallet().signer({ wallet: STUB_WALLET, address: STUB_CREATOR });
  const result = await runLaunchTrade({ engine, signer, order: { token: OWL, side: "sell", amountRaw: before.data.tokenRaw, slippageBps: 300 }, network: "solana:devnet", open: true, onPhase: () => undefined });
  assert.equal(result.step, "done");
  assert.equal(result.done.venue, "pool");
  assert.equal(result.done.shareLink, null);
  const after = await engine.wallet(OWL, STUB_CREATOR);
  const fresh = legOf(result.done, Date.now());
  const towers = await launch.markets();
  const owl = towers.data.markets.find((row) => row.token === OWL);
  const card = roundTrip({ market: answer.data, symbol: owl.symbol, logo: false, wallet: STUB_CREATOR, launchedAt: Date.parse(owl.launchedAt), heldRaw: after.data.tokenRaw, extra: [fresh], sale: result.done.signature, tag: cardTag(answer.data.network, true) });
  assert.equal(card.paidRaw, mine[0].pairRaw);
  assert.equal(card.receivedRaw, result.done.filled.pairRaw);
  assert.equal(card.bought, "birth");
  assert.equal(card.sold, "exit");
  assert.equal(card.tag, "stub");
  assert.ok(card.up && card.multiple > 1);
  assert.equal(card.multiple, Math.floor((Number(result.done.filled.pairRaw) / Number(mine[0].pairRaw)) * 1e6) / 1e6);
});

/* ---------------------------------------------------------------- the frames and the screens */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the cards stand only on our own city: the docks' and the skyline's frames, or the live scene at the tap", () => {
  const draw = read("./card-draw.ts");
  assert.match(draw, /docks: districtFrame\('launch'\)/);
  assert.match(draw, /skyline: districtFrame\('market'\)/);
  assert.match(draw, /requestFrame\(\)/);
  assert.doesNotMatch(draw, /https?:\/\//, "no picture from anywhere else");
  /* The coin's logo is the engine's own (`/api/icon/<mint>`), never a URL of its own. */
  assert.match(draw, /iconSource\(\{ id: card\.coin\.token/);
  for (const id of ["launch", "market"]) for (const file of districtFrame(id).files) assert.ok(existsSync(new URL(`../../../public${file.src}`, import.meta.url)), file.src);
});

test("the screens: a reached card in «Мій причал» is one tap to share, its proof behind «i»; the sale's card only when it adds up", () => {
  const berth = read("../../components/berth/BerthWindow.tsx");
  assert.match(berth, /creatorCard\('born', row, facts\)/);
  assert.match(berth, /creatorCard\('graduated', row, facts\)/);
  assert.match(berth, /<button type="button" className=\{className\}[^>]*onClick=\{making \? undefined : onShare\}[^>]*data-share-card=\{card\.id\}>/);
  assert.match(berth, /tower && !tower\.hidden \? \{ born: creatorCard/, "a coin taken down, or not read, is not shared");
  /* Solscan is no longer the card's tap: it sits in «Details» beside the receipts. */
  const card = berth.slice(berth.indexOf("function Card("), berth.indexOf("function Details("));
  assert.doesNotMatch(card, /proofUrl|href=/);
  const details = berth.slice(berth.indexOf("function Details("), berth.indexOf("function ClaimDock("));
  assert.match(details, /moments\.map[\s\S]*proofUrl\(moment\.proof, network\)/);

  const panel = read("../../components/launch/LaunchTradePanel.tsx");
  assert.match(panel, /round=\{round\?\.up \? round : null\}/);
  assert.match(panel, /extra, sale, tag: cardTag\(market\.network, stub\)/, "the card is for this sale, tagged by the market's own network");
  assert.match(panel, /if \(!sale \|\| !market \|\| !address \|\| sellOnly\) return null;/);
  assert.match(panel, /\{round && \([\s\S]*data-round-trip=""[\s\S]*data-share-card="round"/);
  assert.match(panel, /done\.shareLink \?\? coinLink\(round\.coin\.token\)/);
  assert.match(panel, /keepFill\(connection\.address, token, leg\)/);
  /* Nothing filmed: one frame, no recorder. */
  for (const source of [read("./card-draw.ts"), read("../../components/launch/useShareCard.ts")]) assert.doesNotMatch(source, /MediaRecorder|captureStream|recordClip/);
});

/* ---------------------------------------------------------------- one tap out */

test("one tap out: the phone's share sheet gets the card and the words; a computer saves it and opens X with the link", async () => {
  const { postCard } = await import("../share/post.ts");
  const opened = [];
  const saved = [];
  const shared = [];
  const keep = { window: globalThis.window, document: globalThis.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const nav = globalThis.navigator;
  globalThis.window = { open: (url) => opened.push(url), location: { href: "http://localhost/", search: "", origin: "http://localhost" }, navigator: { userAgent: "test" } };
  globalThis.document = { createElement: () => ({ click() { saved.push(this.download); }, remove() {} }), body: { appendChild() {} } };
  URL.createObjectURL = () => "blob:card";
  URL.revokeObjectURL = () => undefined;
  Object.defineProperty(nav, "canShare", { value: () => true, configurable: true });
  Object.defineProperty(nav, "share", { value: async (data) => shared.push(data), configurable: true });
  try {
    const blob = new Blob(["png"], { type: "image/png" });
    const args = { blob, name: "ryntra-owl-x.png", text: "7.5× on $OWL. https://ryntra.io/c/x", x: { text: "7.5× on $OWL.", url: "https://ryntra.io/c/x" } };
    assert.equal(await postCard({ ...args, phone: true }), "shared");
    assert.equal(shared[0].text, args.text);
    assert.equal(shared[0].files[0].name, "ryntra-owl-x.png");
    assert.equal(opened.length, 0);
    assert.equal(await postCard({ ...args, phone: false }), "saved");
    assert.deepEqual(saved, ["ryntra-owl-x.png"]);
    assert.equal(opened[0], "https://x.com/intent/post?text=7.5%C3%97%20on%20%24OWL.&url=https%3A%2F%2Fryntra.io%2Fc%2Fx");
    Object.defineProperty(nav, "share", { value: async () => Promise.reject(new Error("closed")), configurable: true });
    assert.equal(await postCard({ ...args, phone: true }), "cancelled");
    assert.equal(await postCard({ ...args, blob: null, phone: false }), "failed", "no card: X still opens, nothing saved");
    assert.equal(opened.length, 2);
  } finally {
    delete nav.canShare;
    delete nav.share;
    globalThis.window = keep.window;
    globalThis.document = keep.document;
    URL.createObjectURL = keep.create;
    URL.revokeObjectURL = keep.revoke;
  }
});
