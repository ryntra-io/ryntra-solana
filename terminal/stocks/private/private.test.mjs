import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { RECURRING_STOCKS } from "../../bots/words.ts";
import { flowLine, incomeClaimOf, stageLabel } from "./view.ts";
import { PRIVATE_STOCK } from "./words.ts";

/* A stock from the private balance, and a pool's fees put back into it: the words, the one line under the
   band, the income's ask, and the parts' markup. */

const EN = PRIVATE_STOCK.en;
const UK = PRIVATE_STOCK.uk;
const sayings = (half) => Object.values(half).map((v) => (typeof v === "string" ? v : v(...Array.from({ length: v.length }, () => "1"))));

test("the words say «private», never what it is not, in both languages", () => {
  const banned = [/анонімн/iu, /anonym/i, /не\s*відстеж|невідстеж|без\s+слід/iu, /untrace|untrack|no trace/i, /як\s+готівк/iu, /like\s+cash/i, /міксер|змішувач/iu, /\bmix(er|ers|ing)\b/i];
  const technical = [/\bdevnet\b|\bAPI\b|\bRPC\b|\bengine\b|\bToken-2022\b|\bextension/i, /двигун|розширенн/iu];
  for (const half of [EN, UK]) {
    for (const said of sayings(half)) {
      for (const rule of [...banned, ...technical]) assert.doesNotMatch(said, rule, said);
      assert.doesNotMatch(said, /!/, `no exclamation: ${said}`);
    }
  }
  assert.deepEqual(Object.keys(UK).sort(), Object.keys(EN).sort());
});

test("the band's line says the amount is seen on the way out, and why the stock stays on the wallet is behind «i»", () => {
  assert.match(EN.seen, /amount leaving your private balance/);
  assert.match(UK.seen, /суму, що виходить із приватного балансу/);
  assert.match(EN.stockStays, /lands in your wallet/);
  assert.match(EN.stockStays, /Helius/);
  assert.match(UK.stockStays, /Helius/);
});

test("the issuer and the exchange are «Recurring buys»' own line", () => {
  const issuerLine = readFileSync(new URL("./IssuerLine.tsx", import.meta.url), "utf8");
  assert.match(issuerLine, /RECURRING_STOCKS/);
  assert.match(issuerLine, /r\.issuerLine/);
  assert.match(issuerLine, /r\.closedLine/);
  assert.ok(RECURRING_STOCKS.en.issuerLine && RECURRING_STOCKS.uk.issuerLine);
});

const units = { amount: (raw) => raw.toString(), symbol: (mint) => ({ USDC: "USDC", NVDA: "NVDAx" })[mint] ?? "" };
const state = (over) => ({ flow: "buy", path: null, where: null, failure: null, returned: false, ...over });

test("one line under the band: a refusal before the signature, where the coins are, or a failure in the person's words", () => {
  assert.deepEqual(flowLine("buy", state({ path: { kind: "refuse", code: "ELSEWHERE" } }), EN, units), { tone: "info", text: EN.soon });
  assert.deepEqual(flowLine("buy", state({ path: { kind: "refuse", code: "ISSUER" } }), EN, units), { tone: "warn", text: EN.issuer });
  assert.deepEqual(flowLine("buy", state({ path: { kind: "refuse", code: "PAY" } }), EN, units), { tone: "warn", text: EN.pay });
  assert.deepEqual(flowLine("buy", state({ where: { place: "landing" } }), EN, units), { tone: "info", text: EN.landing });
  assert.deepEqual(flowLine("buy", state({ where: { place: "wallet", mint: "USDC", amount: 25n } }), EN, units), { tone: "warn", text: EN.inWallet("25", "USDC") });
  assert.deepEqual(flowLine("buy", state({ where: { place: "bought", received: 141n } }), EN, units, { stock: "NVDA" }), { tone: "info", text: EN.boughtAmount("141", "NVDAx") });
  assert.deepEqual(flowLine("buy", state({ where: { place: "bought", received: null } }), EN, units, { stock: "NVDA" }), { tone: "info", text: EN.bought("NVDAx") });
  assert.deepEqual(flowLine("buy", state({ where: { place: "private" } }), EN, units), { tone: "info", text: EN.nothing });
  assert.deepEqual(flowLine("buy", state({ failure: { code: "WALLET_REFUSED", detail: "" } }), EN, units), { tone: "error", text: EN.refused });
  assert.deepEqual(flowLine("buy", state({ failure: { code: "GATE_PAUSED", detail: "" } }), EN, units), { tone: "error", text: EN.paused });
  assert.equal(flowLine("income", state({ where: { place: "landing" } }), EN, units), null, "another flow's state says nothing");
});

test("income's line: coming, only SOL and USDC, done with the amount, still in the pool", () => {
  const inc = (over) => state({ flow: "income", ...over });
  assert.deepEqual(flowLine("income", inc({ path: { kind: "refuse", code: "ELSEWHERE" } }), EN, units), { tone: "info", text: EN.incomeSoon });
  assert.deepEqual(flowLine("income", inc({ path: { kind: "refuse", code: "COIN" } }), EN, units), { tone: "warn", text: EN.incomeCoin });
  assert.deepEqual(flowLine("income", inc({ where: { place: "private" } }), EN, units, { back: { mint: "USDC", amount: 3n } }), { tone: "info", text: EN.incomeDone("3", "USDC") });
  assert.deepEqual(flowLine("income", inc({ where: { place: "pool" } }), EN, units), { tone: "info", text: EN.incomeNothing });
});

test("the amber button's word while a flow runs", () => {
  assert.equal(stageLabel(null, 0, EN), null);
  assert.equal(stageLabel("proving", 7, EN), EN.proving("7 s"));
  assert.equal(stageLabel("signing", 0, UK), UK.signing);
});

test("the income's ask from the engine's Review: a claim's fees, a leave's fees, never an add", () => {
  const txs = [{ wireBase64: "AAAA", presigned: [] }];
  const claim = incomeClaimOf({ transactions: txs, preview: { action: "claim", claimed: { x: { units: "1200" }, y: { units: "3000000" } } } }, "NVDA", "USDC", "solana:mainnet");
  assert.deepEqual(claim, { transactions: txs, shown: { x: { mint: "NVDA", amount: 1200n }, y: { mint: "USDC", amount: 3_000_000n } }, chain: "solana:mainnet" });
  const leave = incomeClaimOf({ transactions: txs, preview: { action: "remove", feesClaimed: { x: { units: "0" }, y: { units: "9" } } } }, "NVDA", "USDC", "solana:devnet");
  assert.equal(leave.shown.y.amount, 9n);
  assert.equal(incomeClaimOf({ transactions: txs, preview: { action: "add" } }, "NVDA", "USDC", "solana:devnet"), null);
  assert.equal(incomeClaimOf(null, "NVDA", "USDC", "solana:devnet"), null);
  assert.equal(incomeClaimOf({ transactions: [], preview: { action: "claim", claimed: { x: { units: "1" }, y: { units: "1" } } } }, "NVDA", "USDC", "solana:devnet"), null);
});

test("the parts write no words into the markup, and one amber action stays the ticket's own", () => {
  const dir = new URL("./", import.meta.url);
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".tsx"))) {
    const text = readFileSync(new URL(name, dir), "utf8");
    // The stand draws the ticket's button beside the part, as the ticket does; the parts never draw one.
    if (!name.endsWith("Stand.tsx")) assert.doesNotMatch(text, /<Action\b/, `${name}: the amber button is the ticket's`);
    assert.doesNotMatch(text, />\s*[A-Za-zА-Яа-яІіЇїЄєҐґ][^<>{}]*</u, `${name}: a word written straight into the markup`);
  }
});
