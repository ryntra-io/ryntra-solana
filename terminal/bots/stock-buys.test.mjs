import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { budgetFund, budgetIssue } from "../../lib/mandate/budget.ts";
import { planFrom, planText, STEADY } from "../../lib/mandate/plans.ts";
import { PublicKey } from "@solana/web3.js";

import { antMintData, paused } from "../../lib/mandate/fixtures/stock-mint.mjs";
import { ALLOWED_MINT_EXTENSIONS, STOCK_MINT_EXTENSIONS, TOKEN_2022_PROGRAM_ID, mintExtensions, readCoin } from "../../lib/mandate/token-2022.ts";
import { DAY_STEP_LAMPORTS, ENGINE_BUYS_STOCKS, STOCKS_READ, STOCK_MINT_FEATURES, WEEKS_MAX, planWithHours, stockCoinsOf, stockPartsOn, stocksShown, unitOnCoin, weekBudget, weekOf } from "./stock-buys.ts";
import { RECURRING_STOCKS } from "./words.ts";

/* «Recurring buys» of a tokenized stock, on the bot as it is: the stocks engine's verified companies, a budget a week,
   «only while the exchange is open» as a wait in the plan — and a coin that is no stock keeps the card it had. */

const source = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const SOL = 1_000_000_000n;
const ANT = "ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const FAKE = "So11111111111111111111111111111111111111112";

test("the stocks are the engine's shelf with their logos — never a coin that takes a stock's ticker", () => {
  assert.equal(STOCKS_READ, "/api/v1/stocks/popular?limit=24", "the one public list of the shelf");
  const body = {
    data: {
      companies: [
        { name: "Anthropic", ticker: "ANT", mint: ANT, icon: "https://logo/ant.png", price: 1, change24h: null, volume24h: 9, issuer: "backpack" },
        { name: "Anthropic", ticker: "ANT", mint: ANT, icon: null },
        { name: "Nvidia", ticker: "NVDAx", mint: NVDAX, icon: "" },
        { name: "Not Anthropic", ticker: "ANT", mint: FAKE, icon: "x" },
        { name: "Broken", ticker: "BRK", mint: "not-a-mint" },
        { name: "No ticker", mint: NVDAX },
      ],
    },
  };
  assert.deepEqual(stockCoinsOf(body), [
    { mint: ANT, symbol: "ANT", name: "Anthropic", icon: `/api/spot/icon?mint=${ANT}` },
    { mint: NVDAX, symbol: "NVDAx", name: "Nvidia", icon: `/api/spot/icon?mint=${NVDAX}` },
  ]);
  assert.deepEqual(stockCoinsOf({ companies: body.data.companies.slice(0, 1) }).map((one) => one.symbol), ["ANT"], "the answer with or without its envelope");
  for (const broken of [null, {}, { data: { companies: "x" } }, 42]) assert.deepEqual(stockCoinsOf(broken), []);
});

test("only the cards the issuer's catalogue names — the review refuses a token only a venue's tag vouches for", () => {
  /* 22.11: DJT, SQQQ, AMC, BABA and HIMS stood on the shelf as Backpack's tag-only tokens and the review refused each
     («its issuer can take the coin out of any wallet»): the form offers what the engine buys, nothing more. */
  const DJT = "DJTxFbGZQ5AXSkJvM9FXDGxgMRWbV7N2bRA6NxgJ2M2A";
  const body = {
    companies: [
      { name: "Anthropic", ticker: "ANT", mint: ANT, icon: null, issuer: "backpack", catalogued: true },
      { name: "Trump Media", ticker: "DJT", mint: DJT, icon: null, issuer: "backpack", catalogued: false },
      { name: "Nvidia", ticker: "NVDAx", mint: NVDAX, icon: null, issuer: "xstocks" },
    ],
  };
  assert.deepEqual(stockCoinsOf(body).map((one) => one.symbol), ["ANT", "NVDAx"], "a tag-only card is left out; a server before 1.107.0 (no field) is taken at its word");
});

test("at hand: the first eight, and the one picked where it is further down", () => {
  const stocks = Array.from({ length: 12 }, (_, n) => ({ mint: `m${n}`, symbol: `S${n}`, name: `S${n}`, icon: null }));
  assert.deepEqual(stocksShown(stocks, null).map((one) => one.mint), ["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7"]);
  assert.deepEqual(stocksShown(stocks, "m10").map((one) => one.mint), ["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m10"]);
  assert.deepEqual(stocksShown(stocks, "m3"), stocks.slice(0, 8));
});

test("the exchange's hours ride the plan and nothing else of it changes; a coin that is no stock keeps its plan as it is", () => {
  assert.equal(planText(planWithHours(null, true)), "steady,hours:1");
  assert.equal(planText(planWithHours(planFrom("dip:800,take:2000,pace:2"), true)), "dip:800,take:2000,pace:2,hours:1");
  assert.equal(planText(planWithHours(planFrom("dip:800,pace:2,hours:1"), false)), "dip:800,pace:2");
  // Off, on a plan that has no hours: the very same plan — nothing is written, nothing the card signs changes.
  const dip = planFrom("dip:800,pace:2");
  assert.equal(planWithHours(dip, false), dip);
  assert.equal(planWithHours(null, false), STEADY);
  const on = planWithHours(null, true);
  assert.equal(planWithHours(on, true), on);
  // The card writes the plan only when it differs, and only a stock turns the hours on.
  const budget = source("./Budget.tsx");
  assert.match(budget, /planWithHours\(current, isStock && hours\)/u);
  assert.match(budget, /current === null \? next\.hours === true : next !== current/u);
});

test("a week's budget is the engine's budget: a seventh a day, one buy a day — never more than her week", () => {
  const made = weekBudget(SOL, 12);
  assert.deepEqual(made, { perDay: 142_800_000n, perTrade: 142_800_000n, days: 84 });
  assert.equal(budgetIssue(made), null);
  assert.ok(budgetFund(made) <= 12n * SOL, "the vault holds no more than her twelve weeks");
  assert.equal(made.perDay % DAY_STEP_LAMPORTS, 0n, "the day reads at a glance");
  assert.deepEqual(weekOf(made), { perWeek: 142_800_000n * 7n, weeks: 12 });
  assert.equal(weekBudget(6_000_000n, 4), null, "less than the least trade a day");
  assert.equal(weekBudget(SOL, 0), null);
  assert.equal(weekBudget(SOL, WEEKS_MAX + 1), null);
  assert.equal(weekBudget(SOL, 1.5), null);
  assert.equal(weekBudget(0n, 4), null);
  assert.ok(weekBudget(SOL, WEEKS_MAX));
  assert.equal(weekOf({ perDay: 100_000_000n, perTrade: 50_000_000n, days: 28 }), null, "a day of two buys is no week's budget");
  assert.equal(weekOf({ perDay: 100_000_000n, perTrade: 100_000_000n, days: 30 }), null, "thirty days are no whole weeks");
  assert.equal(weekOf(null), null);
});

test("the signature of a stock opens with the engine's narrow rule — a stock's rights on the stocks' own list, never on every coin's", () => {
  /* The form's features are what a real stock's mint carries beyond a name: ANT's own bytes from mainnet. */
  const mint = new PublicKey(ANT);
  const info = { owner: TOKEN_2022_PROGRAM_ID, data: antMintData() };
  const rights = mintExtensions(info.data).map((extension) => extension.type).filter((type) => !ALLOWED_MINT_EXTENSIONS.includes(type));
  assert.deepEqual([...rights].sort((a, b) => a - b), [...STOCK_MINT_FEATURES].sort((a, b) => a - b));
  /* The trap: on the common list any of them would open to every coin. None is there, and none may be put there. */
  for (const type of STOCK_MINT_FEATURES) assert.equal(ALLOWED_MINT_EXTENSIONS.includes(type), false, `feature ${type} stays off the list every coin is read by`);
  /* The switch is the engine's own: the stocks' list holds every one of them — and then the engine buys that very mint as a stock, and only as one. */
  assert.equal(ENGINE_BUYS_STOCKS, STOCK_MINT_FEATURES.every((type) => STOCK_MINT_EXTENSIONS.includes(type)));
  assert.equal(ENGINE_BUYS_STOCKS, readCoin(mint, info, undefined, { stock: true }).ok, "the form opens a stock's signature exactly when the engine buys a stock's mint");
  assert.equal(readCoin(mint, info).ok, false, "with no word of the shelf the same mint is refused, as any coin's would be");
  assert.equal(readCoin(mint, { ...info, data: paused(info.data) }, undefined, { stock: true }).ok, false, "and a stock its issuer has paused is not bought");
  const budget = source("./Budget.tsx");
  assert.match(budget, /closed: isStock && !ENGINE_BUYS_STOCKS \? s\.coming : null/u, "only a stock is held back, and only while the engine refuses it");
  assert.match(budget, /terms: isStock && coin \? <StockTerms /u, "the stock's lines stand only for a stock");
});

test("a coin that is no stock keeps the card as it was: the same fields, the same signature, no line of a stock", () => {
  const card = source("../agents/NewAgent.tsx");
  assert.match(card, /\{parts\?\.budget \?\? <Budget \/>\}/u, "without the page's fields, the day's own");
  assert.match(card, /disabled=\{!budget \|\| \(needsCoin && !coin\) \|\| short \|\| Boolean\(parts\?\.closed\)\}/u, "the signature's conditions, and the stock's one more");
  assert.match(card, /agentCoins\(book, Number\.MAX_SAFE_INTEGER\)\.filter\(\(c\) => passesForStock\(c\) === null\)/u, "the search never offers a coin passing for a stock");
  const budget = source("./StockBuys.tsx");
  assert.match(budget, /create<UnitState>\(\(set\) => \(\{\s*unit: 'day',/u, "a day, as before, until she picks a week");
});

test("back from a stock to a coin, the budget is counted a day again — unless a sentence chose the week for that coin", () => {
  const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
  assert.equal(unitOnCoin("week", { wasStock: true, isStock: false, said: null, mint: JUP }), "day", "from TSLAx to JUP: «A day»");
  assert.equal(unitOnCoin("week", { wasStock: true, isStock: false, said: JUP, mint: JUP }), "week", "«buy JUP every week» chose the week for JUP");
  assert.equal(unitOnCoin("week", { wasStock: true, isStock: true, said: null, mint: NVDAX }), "week", "from one stock to another: her week stays");
  assert.equal(unitOnCoin("week", { wasStock: false, isStock: false, said: null, mint: JUP }), "week", "a week she picked for a coin stays while the coin does");
  assert.equal(unitOnCoin("day", { wasStock: false, isStock: true, said: null, mint: NVDAX }), "day", "a stock picked does not choose for her");
  const page = source("./Budget.tsx");
  assert.match(page, /unitOnCoin\(unit\.unit, \{ wasStock: wasStock\.current, isStock, said: unit\.said, mint: coin\?\.mint \?\? null \}\)/u, "the page applies the rule on every change of coin");
});

test("the words say it in both languages, with nothing technical and no promise", () => {
  const en = RECURRING_STOCKS.en;
  const uk = RECURRING_STOCKS.uk;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(uk).sort());
  const all = [en, uk].flatMap((set) => Object.values(set).map((value) => (typeof value === "function" ? value("2") : value)));
  for (const text of all) {
    assert.doesNotMatch(text, /CITY-|API|engine|route|mint|x1000|guarant|гарант|profit|прибут|buy now|купуй зараз/iu, text);
  }
  assert.equal(uk.hoursOnly, "Купувати лише в години біржі");
  /* Before she signs: every right of the issuer's in one line — the pause, her own account frozen, the token taken, a check on transfers. */
  assert.equal(uk.issuerLine, "Емітент може зупинити цей токен, заморозити твій рахунок, забрати його й перевіряти кожен переказ.");
  assert.equal(en.issuerLine, "The issuer can pause this token, freeze your account, take it back, and check every transfer.");
  for (const why of [en.issuerWhy("Backpack Securities"), uk.issuerWhy("Backpack Securities")]) assert.doesNotMatch(why, /program|програм|hook|extension|розширен|delegate|делегат/iu, why);
  assert.match(uk.closedLine, /лише в пулах/u);
  assert.equal(en.weeksUnit("1"), "week");
  assert.equal(uk.weeksUnit("5"), "тижнів");
});

test("the stocks' group stands behind the build's switch: closed, the card, the picker and the chart are the ones they always were", () => {
  assert.equal(stockPartsOn(false, { coins: "group" }), undefined);
  assert.deepEqual(stockPartsOn(true, { coins: "group" }), { coins: "group" });
  const model = readFileSync(new URL("./stock-buys.ts", import.meta.url), "utf8");
  assert.match(model, /export const BOTS_STOCKS_OPEN = process\.env\.NEXT_PUBLIC_RYNTRA_BOTS_STOCKS === 'open';/);
  const card = readFileSync(new URL("./Budget.tsx", import.meta.url), "utf8");
  // The AI trader's plan (`agent`) is the same card without the bot's own parts: no stocks' group there either.
  assert.match(card, /const stocks = useBotStocks\(BOTS_STOCKS_OPEN && !agent\);/, "closed, the shelf is not read");
  assert.match(card, /const isStock = BOTS_STOCKS_OPEN && !agent && coin !== null/, "closed, no coin is a stock: no hours, no exchange over the chart");
  assert.match(card, /parts=\{agent \? parts : stockPartsOn\(BOTS_STOCKS_OPEN, parts\)\}/, "closed, the form takes no parts at all");
  const shelf = readFileSync(new URL("./StockBuys.tsx", import.meta.url), "utf8");
  assert.match(shelf, /export function useBotStocks\(on = true\)[\s\S]*?if \(!on\) return;/);
});
