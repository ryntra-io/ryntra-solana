import { test } from "node:test";
import assert from "node:assert/strict";

import { signatureOfWire } from "./flow.ts";
import { orderRows } from "./account.ts";
import { sizeView } from "./sizing.ts";
import { collateralCheck, LOCKED, setExchangeEnv, ticketView, useExchange } from "./store.ts";
import { cancelBody, protectBody } from "./ticket.ts";
import { account, clock, collateralReview, figures, FILL, MARKETS, no, NO_ACCOUNT, ok, orderReview, OTHER, OWNER, scriptedEngine, SOL, wire } from "./test-fixtures.mjs";

const SIGNED = wire(9);
const SIGNATURE = signatureOfWire(SIGNED);
const CONNECTION = { wallet: "Phantom", address: OWNER };
const INITIAL = useExchange.getState();

function setup(script = {}, sign = async () => ({ ok: true, signed: SIGNED })) {
  const time = clock();
  const run = scriptedEngine({ markets: [ok(MARKETS)], funding: [no("PHOENIX_UNAVAILABLE")], account: [ok(account())], orderStates: [ok({ open: true, maxNotionalUsd: null, builder: false, builderBps: null })], collateralStates: [ok({ deposit: true, withdraw: true, maxMicro: null, maxDeposit: null, walletUsdc: "184000000" })], ...script });
  const refreshed = [];
  setExchangeEnv({ engine: run.engine, sign: () => sign, v1: () => false, now: time.now, sleep: time.sleep, refreshHoldings: (delays) => refreshed.push(delays), followMs: 8_000, followEveryMs: 4_000 });
  useExchange.setState(INITIAL, true);
  return { ...run, time, refreshed, st: () => useExchange.getState() };
}

async function opened(script) {
  const run = setup(script);
  run.st().follow(OWNER);
  run.st().show("SOL");
  await run.st().loadMarkets();
  await run.st().loadAccount();
  await run.st().loadGates();
  return run;
}

test("the window opens on the tower's market, from the dock on the last one, else Solana's own", async () => {
  const run = setup();
  run.st().show();
  assert.equal(run.st().open, true);
  assert.equal(run.st().symbol, "SOL");
  run.st().show("btc");
  await run.st().loadMarkets();
  // The listed spelling is taken once the markets arrive.
  assert.equal(run.st().symbol, "BTC");
  run.st().hide();
  run.st().show();
  assert.equal(run.st().symbol, "BTC");
});

test("another wallet starts from nothing: no account, gate, history or Review of the last one", async () => {
  const run = await opened({ reviewOrder: [ok(orderReview())] });
  run.st().setDraft({ side: "long", size: { kind: "usd", text: "30" } });
  await run.st().review(CONNECTION, { kind: "open" });
  assert.ok(run.st().pending);
  assert.equal(run.st().account.value.wallet, OWNER);
  run.st().follow(OTHER);
  assert.equal(run.st().owner, OTHER);
  assert.equal(run.st().account.value, null);
  assert.equal(run.st().orderStates, null);
  assert.equal(run.st().pending, null);
});

test("an account read of another wallet is never taken for this one's", async () => {
  const run = setup({ account: [ok({ ...account(), wallet: OTHER })] });
  run.st().follow(OWNER);
  await run.st().loadAccount();
  assert.equal(run.st().account.value, null);
  assert.equal(run.st().account.status, "failed");
});

test("the ticket's figures are shown only for the very question they answer", async () => {
  const run = await opened({ ticket: [ok(figures())] });
  run.st().setDraft({ side: "long", leverage: 5, size: { kind: "usd", text: "30" } });
  await run.st().readFigures();
  const view = ticketView(run.st());
  // $30 long at its worst price, $150.75: 199 lots of 0.001 SOL, worth $29.999 there.
  assert.equal(view.lots, 199n);
  assert.equal(view.figures.order.marginAtLeverageUsd, 15);
  assert.equal(run.routes("ticket")[0].args[0].sizeLots, "199");
  // Another size: the old figures are not this question's.
  run.st().setDraft({ size: { kind: "usd", text: "60" } });
  assert.equal(ticketView(run.st()).figures, null);
});

test("a share of the most asks the engine's most first, then the figures of that size", async () => {
  const run = await opened({ ticket: [ok(figures({ order: null })), ok(figures())] });
  run.st().setDraft({ side: "short", size: { kind: "share", percent: 50 } });
  await run.st().readFigures();
  const asked = run.routes("ticket").map((call) => call.args[0].sizeLots);
  assert.deepEqual(asked, [null, "6500"]);
  assert.equal(ticketView(run.st()).lots, 6500n);
});

test("an engine refusal of an open says so under the ticket and builds nothing", async () => {
  for (const [code, words] of [
    ["ACCOUNT_NEEDED", /No Phoenix account for this wallet\. Phoenix opens accounts by invite/],
    ["ORDERS_CLOSED", /Orders aren’t open for this wallet yet/],
    ["CANARY_LIMIT", /Over the current limit/],
    ["TP_SIDE", /take profit is on the wrong side/],
    ["MARKET_GATED", /doesn’t take orders on this market/],
    // A code this release does not know: plain words, never the server's developer wording.
    ["SOMETHING_NEW", /^Not accepted right now\. Nothing was sent\.$/],
  ]) {
    const run = await opened({ reviewOrder: [no(code, "the engine's own words")] });
    run.st().setDraft({ side: "long", size: { kind: "usd", text: "30" } });
    await run.st().review(CONNECTION, { kind: "open" });
    assert.equal(run.st().pending, null, code);
    assert.equal(run.st().asking, null, code);
    assert.equal(run.st().phase, "idle");
    assert.match(run.st().notice.text, words, code);
  }
});

test("a refused close is said on its own card, with the engine's reason", async () => {
  const run = await opened({ reviewOrder: [no("NO_POSITION")] });
  await run.st().review(CONNECTION, { kind: "close", symbol: "SOL" }, { kind: "reduce", owner: OWNER, symbol: "SOL", size: "1", close: true });
  assert.deepEqual(run.st().asking, { kind: "close", symbol: "SOL" });
  assert.match(run.st().notice.text, /no position on this market/);
  run.st().back();
  assert.equal(run.st().asking, null);
});

test("the one amber tap signs the Review, and the account and the gates are read again after it", async () => {
  const run = await opened({ reviewOrder: [ok(orderReview())], submitOrder: [ok({ results: [{ signature: SIGNATURE, state: "LANDED", reason: null, fills: [FILL] }], settled: true })] });
  run.st().setDraft({ side: "long", size: { kind: "usd", text: "30" } });
  await run.st().review(CONNECTION, { kind: "open" });
  assert.equal(run.routes("reviewOrder")[0].args[0].size, "199");
  const before = run.routes("account").length;
  await run.st().confirm(CONNECTION);
  assert.equal(run.st().phase, "done");
  assert.equal(run.st().result.receipt.outcome, "filled");
  assert.equal(run.st().pending, null);
  assert.ok(run.routes("account").length > before);
  assert.equal(run.routes("submitOrder").length, 1);
});

test("a Review too old to sign is built again and shown first; the wallet is not opened", async () => {
  let asked = 0;
  const run = await opened({ reviewOrder: [ok(orderReview()), ok(orderReview({ ticket: "order-ticket-2" }))] });
  setExchangeEnv({ sign: () => async () => ((asked += 1), { ok: true, signed: SIGNED }) });
  run.st().setDraft({ side: "long", size: { kind: "usd", text: "30" } });
  await run.st().review(CONNECTION, { kind: "open" });
  run.time.pass(25_000);
  await run.st().confirm(CONNECTION);
  assert.equal(asked, 0);
  assert.equal(run.st().pending.review.ticket, "order-ticket-2");
  assert.equal(run.st().notice.tone, "warn");
  assert.equal(run.routes("submitOrder").length, 0);
});

test("a wallet that says no keeps the Review to sign again; a relay's refusal ends it", async () => {
  const run = await opened({ reviewOrder: [ok(orderReview())], submitOrder: [no("ORDERS_CLOSED")] });
  setExchangeEnv({ sign: () => async () => ({ ok: false }) });
  run.st().setDraft({ side: "long", size: { kind: "usd", text: "30" } });
  await run.st().review(CONNECTION, { kind: "open" });
  await run.st().confirm(CONNECTION);
  assert.ok(run.st().pending);
  assert.match(run.st().notice.text, /wallet said no/);
  setExchangeEnv({ sign: () => async () => ({ ok: true, signed: SIGNED }) });
  await run.st().confirm(CONNECTION);
  assert.equal(run.st().pending, null);
  assert.match(run.st().notice.text, /Orders aren’t open/);
});

test("nothing closes the window while the wallet signs or the bytes are on their way", async () => {
  const run = await opened({ reviewOrder: [ok(orderReview())], submitOrder: [ok({ results: [{ signature: SIGNATURE, state: "LANDED", reason: null, fills: [FILL] }], settled: true })] });
  let release;
  setExchangeEnv({ sign: () => () => new Promise((resolve) => (release = () => resolve({ ok: true, signed: SIGNED }))) });
  run.st().setDraft({ side: "long", size: { kind: "usd", text: "30" } });
  await run.st().review(CONNECTION, { kind: "open" });
  const done = run.st().confirm(CONNECTION);
  assert.ok(LOCKED.has(run.st().phase));
  run.st().hide();
  run.st().follow(OTHER);
  assert.equal(run.st().open, true);
  assert.ok(run.st().pending);
  release();
  await done;
  // The bytes went out for the first wallet; its receipt is not shown to the wallet that took over.
  assert.equal(run.routes("submitOrder").length, 1);
  assert.equal(run.st().result, null);
  assert.equal(run.st().pending, null);
  assert.equal(run.st().phase, "idle");
});

test("nothing is left holding the window when the answer cannot be read", async () => {
  const run = await opened({ reviewOrder: [ok(orderReview())] });
  setExchangeEnv({ sign: () => async () => ({ ok: true, signed: "not base64 at all %%" }) });
  run.st().setDraft({ side: "long", size: { kind: "usd", text: "30" } });
  await run.st().review(CONNECTION, { kind: "open" });
  await run.st().confirm(CONNECTION);
  assert.equal(run.st().phase, "idle");
  assert.equal(run.routes("submitOrder").length, 0);
  // A wallet that never answers in time: the bytes are let go, and nothing is sent.
  setExchangeEnv({ sign: () => async () => ({ ok: false, timedOut: true }) });
  await run.st().confirm(CONNECTION);
  assert.equal(run.routes("submitOrder").length, 0);
  assert.equal(run.st().phase, "idle");
});

test("another market chosen while its Review is being built lets that Review go", async () => {
  let answer;
  const run = await opened({ reviewOrder: [() => new Promise((resolve) => (answer = resolve))] });
  run.st().setDraft({ side: "long", size: { kind: "usd", text: "30" } });
  const building = run.st().review(CONNECTION, { kind: "open" });
  run.st().choose("BTC");
  assert.equal(run.st().symbol, "BTC");
  assert.equal(run.st().phase, "idle");
  answer(ok(orderReview()));
  await building;
  assert.equal(run.st().pending, null);
});

test("a deposit: checked against the wallet and the first check, reviewed, signed, and the wallet's coins read again", async () => {
  const run = await opened({ reviewCollateral: [ok(collateralReview())], submitCollateral: [ok({ results: [{ signature: SIGNATURE, state: "LANDED", reason: null, usdcMoved: "-25000000" }], settled: true })] });
  run.st().openCollateral("deposit");
  run.st().setCollateralText("25");
  await run.st().reviewCollateral(CONNECTION);
  assert.deepEqual(run.routes("reviewCollateral")[0].args[0], { action: "deposit", owner: OWNER, amount: "25000000" });
  await run.st().confirm(CONNECTION);
  assert.equal(run.st().result.receipt.movedMicro, 25_000_000n);
  assert.equal(run.st().collateralForm, null);
  assert.deepEqual(run.refreshed, [[4_000, 12_000]]);
});

test("a collateral form holds to the engine's figures: at least $1, no more than the wallet, the account or the check", () => {
  const states = { deposit: true, withdraw: true, maxMicro: "5000000", maxDeposit: "5000000", walletUsdc: "3000000" };
  assert.equal(collateralCheck({ action: "deposit", text: "0.5" }, states, null).issue, "MIN");
  assert.equal(collateralCheck({ action: "deposit", text: "4" }, states, null).issue, "WALLET");
  assert.equal(collateralCheck({ action: "deposit", text: "2" }, states, null).issue, null);
  assert.equal(collateralCheck({ action: "deposit", text: "2" }, states, null).maxMicro, 3_000_000n);
  assert.equal(collateralCheck({ action: "withdraw", text: "10" }, states, 20_000_000n).issue, "CANARY");
  assert.equal(collateralCheck({ action: "withdraw", text: "30" }, { ...states, maxMicro: null }, 20_000_000n).issue, "WITHDRAWABLE");
  assert.equal(collateralCheck({ action: "withdraw", text: "1" }, states, 20_000_000n).maxMicro, 5_000_000n);
  assert.equal(collateralCheck({ action: "deposit", text: "" }, states, null).amount, null);
});

test("an account without Phoenix: the read says none, and the engine's gates answer what they answer", async () => {
  const run = await opened({ account: [ok(NO_ACCOUNT)], orderStates: [ok({ open: false, maxNotionalUsd: null, builder: false })] });
  assert.equal(run.st().account.value.state, "none");
  assert.equal(run.st().orderStates.open, false);
  // A gate that did not answer is never read as open.
  const silent = await opened({ orderStates: [no("NETWORK")] });
  assert.equal(silent.st().orderStates, null);
});

test("new TP/SL prices drop the Review of the old ones: what is signed is what is typed", async () => {
  const run = await opened({ reviewOrder: [ok(orderReview({ kind: "protect", tif: null, sizeUnits: "0", tpUsd: 165, slUsd: 140 }))] });
  run.st().openProtect({ symbol: "SOL", side: "long", tp: "165", sl: "140" });
  await run.st().review(CONNECTION, { kind: "protect", symbol: "SOL" }, { kind: "protect", owner: OWNER, symbol: "SOL", tp: "16500", sl: "14000" });
  assert.equal(run.st().pending.intent.kind, "protect");
  run.st().setProtect({ tp: "170" });
  assert.equal(run.st().pending, null);
  assert.equal(run.st().protectForm.tp, "170");
});

test("bytes the wallet returns signed by another key than the connected one are never sent", async () => {
  const run = await opened({ reviewOrder: [ok(orderReview())], submitOrder: [ok({ results: [{ signature: SIGNATURE, state: "LANDED", reason: null, fills: [FILL] }], settled: true })] });
  setExchangeEnv({ sign: () => async () => ({ ok: true, signed: wire(9, OTHER) }) });
  run.st().setDraft({ side: "long", size: { kind: "usd", text: "30" } });
  await run.st().review(CONNECTION, { kind: "open" });
  await run.st().confirm(CONNECTION);
  assert.equal(run.routes("submitOrder").length, 0);
  assert.equal(run.st().phase, "idle");
  assert.match(run.st().notice.text, /Not signed by this wallet\. Nothing was sent/);
});

const BOOK = { symbol: "SOL", slot: 1, asks: [{ price: 150.1, size: 2 }], bids: [{ price: 149.9, size: 1 }], observedAt: 1 };

test("the Book tab reads the open market's book; another market forgets the last one's levels", async () => {
  const run = await opened({ book: [ok(BOOK), no("PHOENIX_UNAVAILABLE")] });
  await run.st().loadBook();
  assert.deepEqual(run.routes("book").map((call) => call.args), [["SOL"]]);
  assert.equal(run.st().book.status, "ready");
  // A failed read keeps the last book with its own time, said as delayed.
  await run.st().loadBook();
  assert.equal(run.st().book.status, "failed");
  assert.equal(run.st().book.value.asks[0].price, 150.1);
  run.st().choose("BTC");
  assert.equal(run.st().book.value, null);
  run.st().setTab("book");
  assert.equal(run.st().tab, "book");
});

const CANDLES = (timeframe) => ({ symbol: "SOL", timeframe, last: [{ t: 1, o: 150, h: 151, l: 149, c: 150.5, v: 1, final: true }], mark: [], observedAt: 1 });

test("the chart reads the open market's bars at its interval; another interval or market starts again", async () => {
  const run = await opened({ candles: [ok(CANDLES("1h")), no("PHOENIX_UNAVAILABLE"), ok(CANDLES("4h"))] });
  await run.st().loadCandles();
  assert.deepEqual(run.routes("candles").map((call) => call.args), [["SOL", "1h"]]);
  assert.equal(run.st().candles.status, "ready");
  // A refused read keeps the last bars.
  await run.st().loadCandles();
  assert.equal(run.st().candles.status, "failed");
  assert.equal(run.st().candles.value.timeframe, "1h");
  run.st().setChartTimeframe("4h");
  assert.equal(run.st().chartTimeframe, "4h");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(run.routes("candles").at(-1).args, ["SOL", "4h"]);
  assert.equal(run.st().candles.value.timeframe, "4h");
  run.st().choose("BTC");
  assert.equal(run.st().candles.value, null);
});

test("the size's chip, slider and field stay one: a share writes its dollars, a typed sum moves the slider", async () => {
  const run = await opened({ ticket: [ok(figures({ order: null })), ok(figures())] });
  run.st().setDraft({ side: "long", size: { kind: "share", percent: 50 } });
  await run.st().readFigures();
  const view = ticketView(run.st());
  assert.equal(view.maxLots, "13000");
  assert.deepEqual(sizeView(run.st().draft, view.market, view.maxLots), { text: "979.87", percent: 50, chip: 50 });
  // The person types over the field: the sum is theirs, the slider follows it, the chip goes out.
  run.st().setDraft({ size: { kind: "usd", text: "490" } });
  assert.deepEqual(sizeView(run.st().draft, view.market, ticketView(run.st()).maxLots), { text: "490", percent: 25, chip: null });
  // The slider again: a share once more.
  run.st().setDraft({ size: { kind: "share", percent: 75 } });
  assert.equal(sizeView(run.st().draft, view.market, ticketView(run.st()).maxLots).chip, 75);
  // The leverage from the slider stays inside the market's range.
  run.st().setDraft({ leverage: 80 });
  assert.equal(run.st().draft.leverage, 20);
});

test("a cancel is a Review of the engine's own first, and only the one amber tap signs it", async () => {
  const cancelled = { results: [{ signature: SIGNATURE, state: "LANDED", reason: null, fills: null }], settled: true };
  const run = await opened({ reviewOrder: [ok(orderReview({ kind: "cancel", tif: null, sizeUnits: "0", order: { side: "buy", sizeUnits: "1", priceUsd: 138 } }))], submitOrder: [ok(cancelled)], orderStatus: [ok({ results: [{ signature: SIGNATURE, state: "LANDED", reason: null, fills: null }] })] });
  const [plain] = orderRows(run.st().account.value);
  await run.st().review(CONNECTION, { kind: "cancel", symbol: "SOL", leg: null }, cancelBody(OWNER, plain));
  assert.deepEqual(run.routes("reviewOrder")[0].args[0], { kind: "cancel", owner: OWNER, symbol: "SOL", order: "101" });
  assert.equal(run.st().pending.intent.kind, "cancel");
  assert.equal(run.routes("submitOrder").length, 0);
  await run.st().confirm(CONNECTION);
  assert.equal(run.routes("submitOrder").length, 1);
  assert.equal(run.st().result.receipt.outcome, "cancelled");
});

test("a position's TP/SL form: the typed prices become the engine's protect order, checked before any Review", async () => {
  const set = { results: [{ signature: SIGNATURE, state: "LANDED", reason: null, fills: null }], settled: true };
  const run = await opened({ reviewOrder: [ok(orderReview({ kind: "protect", tif: null, sizeUnits: "0", tpUsd: 170, slUsd: 135 }))], submitOrder: [ok(set)], orderStatus: [ok({ results: [{ signature: SIGNATURE, state: "LANDED", reason: null, fills: null }] })] });
  run.st().openProtect({ symbol: "SOL", side: "long", tp: "165", sl: "140" });
  run.st().setProtect({ tp: "170", sl: "135" });
  const form = run.st().protectForm;
  assert.deepEqual([form.tp, form.sl], ["170", "135"]);
  const body = protectBody(OWNER, SOL, form.side, form.tp, form.sl);
  await run.st().review(CONNECTION, { kind: "protect", symbol: "SOL" }, body);
  assert.deepEqual(run.routes("reviewOrder")[0].args[0], { kind: "protect", owner: OWNER, symbol: "SOL", tp: "17000", sl: "13500" });
  await run.st().confirm(CONNECTION);
  assert.equal(run.st().result.receipt.outcome, "set");
  // Done: the form closes with the Review.
  assert.equal(run.st().protectForm, null);
});
