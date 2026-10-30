import { test } from "node:test";
import assert from "node:assert/strict";

import { choiceOf, glowingMints, setTradeEnv, useTrade } from "./store.ts";
import { SOL, USDC } from "./tiles.ts";
import {
  EXECUTED,
  memoryAttempts,
  ORDER,
  orderWith,
  QUOTE,
  RECOVERED,
  recorded,
  scriptedEngine,
  signingWallet,
  signWire,
  T0,
  TAKER,
  testClock,
  USDT,
  WSOL,
} from "./test-fixtures.mjs";

// The card logic end to end over the engine's recorded answers. The wallet is a stub that signs with the
// transcripts' test key; nothing here touches a network or a real wallet.

const TOWER = { id: USDT, symbol: "USDT", name: "Tether", icon: null, district: "core", price: 1, mcap: 1, liquidity: 1, holders: 1, change5m: 0, change1h: 0, change24h: 0, volume24h: 0, traders1h: 0, organic: 90, verified: true, launchedAt: null };
const PHANTOM = { wallet: "Phantom", address: TAKER };
const SOL_ONLY = { owner: TAKER, sol: { spendableRaw: "2410000000", decimals: 9 }, tokens: new Map(), complete: true };
const WITH_USDT = { ...SOL_ONLY, tokens: new Map([[USDT, { spendableRaw: "1500000", decimals: 6 }]]) };

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function scene(script, { connection = PHANTOM, holdings = SOL_ONLY, card, prove } = {}) {
  const scripted = scriptedEngine({ quote: [{ status: 200, body: QUOTE }], order: [{ status: 200, body: ORDER }], execute: [{ status: 200, body: EXECUTED }], ...script });
  const attempts = memoryAttempts();
  const clock = testClock(T0 + 1_000);
  const signer = signingWallet(signWire);
  const wallet = { connection, holdings };
  const reads = [];
  const proofs = [];
  setTradeEnv({
    engine: scripted.engine,
    attempts: attempts.store,
    now: clock.now,
    sleep: clock.sleep,
    sign: (_connection, wire) => signer.sign(wire),
    wallet: () => wallet,
    refreshHoldings: (delays) => reads.push(delays ?? []),
    card: card ?? (async () => ({ ok: false, code: "UNAVAILABLE" })),
    prove: prove ?? (async (who) => (proofs.push(who), { ok: true })),
  });
  useTrade.setState({ open: false, tower: null, phase: "idle", pay: "SOL", typed: "", review: null, done: null, failed: null, unknown: null, optimistic: {}, celebrate: null });
  return { ...scripted, attempts, clock, signer, wallet, reads, proofs };
}

test("the card opens on a price, before any wallet", async () => {
  const { routes } = scene({}, { connection: null, holdings: null });
  useTrade.getState().openFor(TOWER);
  await flush();
  const state = useTrade.getState();
  assert.equal(state.open, true);
  assert.equal(state.side, "buy");
  assert.equal(state.quote.status, "ready");
  assert.deepEqual(routes("quote")[0].body, { inputMint: WSOL, outputMint: USDT, amountRaw: "100000000" });
  assert.equal(await state.press(), "connect");
  assert.equal(routes("order").length, 0);
});

test("a launch's tower opens the same window and asks Jupiter for nothing: the Launch engine prices it (CITY-138)", async () => {
  const { routes } = scene({});
  useTrade.getState().openFor({ ...TOWER, verified: false }, "buy", { launch: true });
  await flush();
  let state = useTrade.getState();
  assert.equal(state.open, true);
  assert.equal(state.launch, true);
  assert.equal(state.quote.status, "none");
  await state.refreshQuote();
  await state.prepare(true);
  assert.equal(routes("quote").length, 0);
  assert.equal(routes("order").length, 0);
  // Another tower after it is a Jupiter card again.
  useTrade.getState().close();
  useTrade.getState().openFor(TOWER);
  await flush();
  state = useTrade.getState();
  assert.equal(state.launch, false);
  assert.equal(routes("quote").length, 1);
});

test("«Mine» opens the card on selling, the whole holding priced into SOL", async () => {
  const { routes } = scene({}, { holdings: WITH_USDT });
  useTrade.getState().openFor(TOWER, "sell");
  await flush();
  const state = useTrade.getState();
  assert.equal(state.side, "sell");
  assert.equal(state.typed, "1.5");
  assert.deepEqual(routes("quote")[0].body, { inputMint: USDT, outputMint: WSOL, amountRaw: "1500000" });
});

test("with a wallet, the exact order is on the card before the tap; one tap signs, sends and lights the tower", async () => {
  const { routes, signer, attempts, reads } = scene({});
  useTrade.getState().openFor(TOWER);
  await flush();
  await useTrade.getState().prepare(true);
  let state = useTrade.getState();
  assert.equal(state.review?.order.order.minReceivedRaw, ORDER.order.minReceivedRaw);
  assert.equal(signer.shown.length, 0, "building the order never opens the wallet");
  assert.equal(routes("order")[0].body.input.taker, TAKER);

  await state.press();
  state = useTrade.getState();
  assert.equal(state.phase, "done");
  assert.equal(signer.shown.length, 1);
  assert.equal(routes("execute").length, 1);
  assert.equal(state.done.trade.signature, EXECUTED.signature);
  assert.equal(state.done.trade.outputRaw, "1500000");
  assert.equal(state.done.decimals[USDT], 6);
  assert.equal(state.optimistic[USDT].held, true);
  assert.equal(state.celebrate.mint, USDT);
  assert.deepEqual(reads.at(-1), [1_500, 7_000]);
  assert.deepEqual(attempts.log, ["SIGNED_NOT_SENT", "CLEARED"]);
});

test("a tap on a price alone builds the order and shows it; the wallet waits for the next tap", async () => {
  const { signer, routes } = scene({});
  useTrade.getState().openFor(TOWER);
  await flush();
  await useTrade.getState().press();
  const state = useTrade.getState();
  assert.equal(state.phase, "idle");
  assert.ok(state.review);
  assert.equal(signer.shown.length, 0);
  assert.equal(routes("execute").length, 0);
});

test("the card builds an order by itself once per choice, and a refusal is said, not retried", async () => {
  const { routes } = scene({ order: [recorded("order refused: Jupiter finds no route")] });
  useTrade.getState().openFor(TOWER);
  await flush();
  await useTrade.getState().prepare(true);
  await useTrade.getState().prepare(true);
  const state = useTrade.getState();
  assert.equal(routes("order").length, 1);
  assert.equal(state.review, null);
  assert.deepEqual(state.notice, { tone: "error", text: "No route for this pair right now." });
});

test("a trade under way cannot be closed or changed", async () => {
  scene({});
  useTrade.getState().openFor(TOWER);
  await flush();
  useTrade.setState({ phase: "wallet" });
  useTrade.getState().close();
  useTrade.getState().setShare(75);
  useTrade.getState().setTyped("2");
  useTrade.getState().setSide("sell");
  const state = useTrade.getState();
  assert.equal(state.open, true);
  assert.equal(state.typed, "0.1");
  assert.equal(state.side, "buy");
  useTrade.setState({ phase: "idle" });
  useTrade.getState().close();
  assert.equal(useTrade.getState().open, false);
});

test("another amount drops the shown order and asks a new price", async () => {
  const { routes } = scene({});
  useTrade.getState().openFor(TOWER);
  await flush();
  await useTrade.getState().prepare(true);
  useTrade.getState().setShare(50);
  await flush();
  const state = useTrade.getState();
  assert.equal(state.review, null);
  // Half of 2.41 SOL less what the swap needs to land and the new $USDT account's rent.
  assert.equal(state.typed, "1.20280822");
  assert.equal(routes("quote").at(-1).body.amountRaw, "1202808220");
});

test("a wallet short of the first amount starts at a quarter; one that cannot pay the network spends nothing", async () => {
  const low = { ...SOL_ONLY, sol: { spendableRaw: "10000000", decimals: 9 } };
  let { routes } = scene({}, { holdings: low });
  useTrade.getState().openFor(TOWER);
  await flush();
  assert.equal(useTrade.getState().typed, "0.00140411");
  assert.equal(routes("quote").at(-1).body.amountRaw, "1404110");

  const dry = { ...SOL_ONLY, sol: { spendableRaw: "4000000", decimals: 9 } };
  ({ routes } = scene({}, { holdings: dry }));
  useTrade.getState().openFor(TOWER);
  await flush();
  const choice = choiceOf({ mint: USDT, symbol: "USDT", name: "Tether", icon: null }, "buy", dry, { typed: useTrade.getState().typed });
  assert.equal(useTrade.getState().typed, "");
  assert.equal(choice.amountRaw, null);
  assert.equal(choice.sizing.max, "0");
  assert.ok(choice.sizing.chips.every((chip) => !chip.usable));
  assert.equal(routes("quote").length, 0);
  useTrade.getState().setShare(100);
  assert.equal(useTrade.getState().typed, "");
  useTrade.getState().setTyped("0.003");
  await flush();
  assert.equal(choiceNow(dry).problem.kind, "balance");
  await useTrade.getState().prepare(true);
  await useTrade.getState().press();
  assert.equal(routes("quote").length, 0);
  assert.equal(routes("order").length, 0);
});

test("selling: shares of the holding, all by default; selling all lets the tower's light go", async () => {
  const { routes } = scene({}, { holdings: WITH_USDT });
  useTrade.getState().openFor(TOWER);
  await flush();
  useTrade.getState().setSide("sell");
  await flush();
  let state = useTrade.getState();
  assert.equal(state.side, "sell");
  assert.equal(state.typed, "1.5");
  assert.deepEqual(choiceNow(WITH_USDT).sizing.chips.map((chip) => chip.on), [false, false, false, true]);
  assert.deepEqual(routes("quote").at(-1).body, { inputMint: USDT, outputMint: WSOL, amountRaw: "1500000" });
  await state.prepare(true);
  assert.deepEqual(routes("order").at(-1).body.origin, { surface: "SPOT", side: "SELL" });
  await useTrade.getState().press();
  state = useTrade.getState();
  assert.equal(state.phase, "done");
  assert.equal(state.optimistic[USDT].held, false);
  assert.equal(state.celebrate, null);
  // The next trade starts from buying, at its start: the balances are a moment behind the chain.
  state.again();
  assert.equal(useTrade.getState().side, "buy");
  assert.equal(useTrade.getState().typed, "0.1");
  assert.equal(useTrade.getState().phase, "idle");
});

test("a signature already out is read back on the card, then the trade is done", async () => {
  const { routes } = scene({ order: [recorded("order refused: the owner holds a signature the server claimed")], recover: [{ status: 200, body: RECOVERED }] });
  useTrade.getState().openFor(TOWER);
  await flush();
  await useTrade.getState().prepare(false);
  await flush();
  const state = useTrade.getState();
  assert.equal(routes("recover").length, 1);
  assert.equal(routes("execute").length, 0);
  assert.equal(state.phase, "done");
});

test("renewed bytes that got worse are shown and a tap right after is not consent", async () => {
  const { clock, signer } = scene({ order: [{ status: 200, body: ORDER }, { status: 200, body: orderWith({ minReceivedRaw: "1400000" }) }] });
  useTrade.getState().openFor(TOWER);
  await flush();
  await useTrade.getState().prepare(true);
  await useTrade.getState().renew();
  let state = useTrade.getState();
  assert.equal(state.review.order.order.minReceivedRaw, "1400000");
  assert.equal(state.notice.tone, "warn");
  await state.press();
  assert.equal(signer.shown.length, 0);
  clock.advance(1_500);
  await useTrade.getState().press();
  state = useTrade.getState();
  assert.equal(signer.shown.length, 1);
  assert.equal(state.phase, "done");
});

test("the card for X: the wallet proves itself once, then the generator draws the trade", async () => {
  const asked = [];
  let first = true;
  const card = async (request) => {
    asked.push(request);
    if (first) {
      first = false;
      return { ok: false, code: "PROOF_REQUIRED" };
    }
    return { ok: true, card: { url: "https://ryntra.io/r/abc/c/x", image: "https://ryntra.io/r/abc/c/x/image?v=1", text: "Bought", alt: "Card" } };
  };
  const { proofs } = scene({}, { card });
  useTrade.getState().openFor(TOWER);
  await flush();
  await useTrade.getState().prepare(true);
  await useTrade.getState().press();
  await useTrade.getState().shareCard();
  const state = useTrade.getState();
  assert.equal(state.card.status, "ready");
  assert.equal(proofs.length, 1);
  assert.deepEqual(asked[1], { address: TAKER, mint: USDT, signature: EXECUTED.signature, kind: "BUY" });
});

test("a sale the generator cannot measure says why there is no card", async () => {
  scene({}, { holdings: WITH_USDT, card: async () => ({ ok: false, code: "NOT_FOUND" }) });
  useTrade.getState().openFor(TOWER);
  await flush();
  useTrade.getState().setSide("sell");
  await flush();
  await useTrade.getState().prepare(true);
  await useTrade.getState().press();
  await useTrade.getState().shareCard();
  assert.deepEqual(useTrade.getState().card, { status: "error", message: "No card for this sale: Ryntra has no record of what these coins cost." });
});

test("a signature left open before a reload is read back quietly when its wallet returns", async () => {
  const { attempts, reads, routes } = scene({ recover: [{ status: 200, body: RECOVERED }] });
  attempts.store.write({
    schema: "ryntra.solana.swap-client-attempt",
    schemaVersion: "1.0.0",
    requestId: "golden-order-0001",
    signature: EXECUTED.signature,
    taker: TAKER,
    state: "SUBMITTED_UNKNOWN",
    recordedAt: new Date(T0).toISOString(),
  });
  await useTrade.getState().recoverQuietly();
  assert.equal(routes("recover").length, 1);
  assert.equal(attempts.current, null);
  assert.deepEqual(reads.at(-1), [1_500, 7_000]);
  assert.equal(useTrade.getState().phase, "idle");
  // Once per signature.
  await useTrade.getState().recoverQuietly();
  assert.equal(routes("recover").length, 1);
});

test("your towers glow from the wallet's balances, and from a trade until the balances catch up", () => {
  const owned = new Set(["A", "B"]);
  const now = T0;
  assert.deepEqual([...glowingMints(owned, {}, now)].sort(), ["A", "B"]);
  assert.deepEqual([...glowingMints(owned, { C: { held: true, at: now - 1_000 } }, now)].sort(), ["A", "B", "C"]);
  assert.deepEqual([...glowingMints(owned, { A: { held: false, at: now - 1_000 } }, now)].sort(), ["B"]);
  // A minute later the balances are the truth again.
  assert.deepEqual([...glowingMints(owned, { C: { held: true, at: now - 61_000 } }, now)].sort(), ["A", "B"]);
});

const WITH_USDC = { ...WITH_USDT, tokens: new Map([...WITH_USDT.tokens, [USDC.mint, { spendableRaw: "30000000", decimals: 6 }]]) };
const choiceNow = (holdings) => {
  const state = useTrade.getState();
  return choiceOf(state.tower, state.side, holdings, { pay: state.pay, typed: state.typed });
};

test("pay with USDC: the buy spends USDC, the sale is paid in USDC, through the same engine routes", async () => {
  const { routes } = scene({}, { holdings: WITH_USDC });
  useTrade.getState().openFor(TOWER);
  await flush();
  assert.equal(routes("quote").at(-1).body.inputMint, WSOL);
  useTrade.getState().setPay("USDC");
  await flush();
  let choice = choiceNow(WITH_USDC);
  assert.equal(choice.pay, USDC);
  // Shares of the 30 USDC in the wallet, spent to the last cent; the buy starts at 10.
  assert.deepEqual(choice.sizing.chips.map((chip) => chip.amountRaw), ["7500000", "15000000", "22500000", "30000000"]);
  assert.equal(useTrade.getState().typed, "10");
  assert.deepEqual(routes("quote").at(-1).body, { inputMint: USDC.mint, outputMint: USDT, amountRaw: "10000000" });
  await useTrade.getState().prepare(true);
  assert.equal(routes("order").at(-1).body.input.inputMint, USDC.mint);
  assert.equal(routes("order").at(-1).body.input.amountRaw, "10000000");
  // Selling: the coin into USDC.
  useTrade.getState().setSide("sell");
  await flush();
  assert.deepEqual(routes("quote").at(-1).body, { inputMint: USDT, outputMint: USDC.mint, amountRaw: "1500000" });
  // The pick stays for the next card.
  useTrade.getState().close();
  useTrade.getState().openFor(TOWER);
  await flush();
  assert.equal(routes("quote").at(-1).body.inputMint, USDC.mint);
  useTrade.getState().setPay("SOL");
  await flush();
  assert.deepEqual(routes("quote").at(-1).body, { inputMint: WSOL, outputMint: USDT, amountRaw: "100000000" });
});

test("the SOL tower is paid only with USDC; the switch cannot pick SOL for it", async () => {
  const { routes } = scene({}, { holdings: WITH_USDC });
  useTrade.getState().openFor({ ...TOWER, id: SOL.mint, symbol: "SOL", name: "Solana" });
  await flush();
  assert.equal(choiceNow(WITH_USDC).options.length, 1);
  const asked = routes("quote").length;
  useTrade.getState().setPay("SOL");
  await flush();
  assert.equal(routes("quote").length, asked);
  assert.equal(routes("quote").at(-1).body.inputMint, USDC.mint);
});

test("an amount of your own: priced once the typing pauses, ordered like a chip's, a chip replaces it", async () => {
  const { routes } = scene({});
  useTrade.getState().openFor(TOWER);
  await flush();
  assert.equal(routes("quote").length, 1);
  useTrade.getState().setTyped("1");
  useTrade.getState().setTyped("1,2");
  useTrade.getState().setTyped("1.25");
  await flush();
  // Three keystrokes, one price: for the last amount.
  assert.equal(routes("quote").length, 2);
  assert.equal(routes("quote").at(-1).body.amountRaw, "1250000000");
  const choice = choiceNow(SOL_ONLY);
  assert.equal(choice.amountRaw, "1250000000");
  assert.ok(choice.sizing.share > 51 && choice.sizing.share < 52);
  assert.equal(useTrade.getState().quote.key, choice.key);
  await useTrade.getState().prepare(true);
  assert.equal(routes("order").at(-1).body.input.amountRaw, "1250000000");
  // A chip is priced at once, without waiting for a pause.
  const asked = routes("quote").length;
  useTrade.getState().setShare(25);
  await flush();
  assert.equal(routes("quote").length, asked + 1);
  assert.equal(useTrade.getState().typed, "0.60140411");
  assert.equal(routes("quote").at(-1).body.amountRaw, "601404110");
  assert.deepEqual(choiceNow(SOL_ONLY).sizing.chips.map((chip) => chip.on), [true, false, false, false]);
});

test("an amount above the balance is neither priced nor ordered, and says so plainly", async () => {
  const { routes } = scene({});
  useTrade.getState().openFor(TOWER);
  await flush();
  const asked = routes("quote").length;
  useTrade.getState().setTyped("3");
  await flush();
  const choice = choiceNow(SOL_ONLY);
  assert.equal(choice.amountRaw, null);
  assert.equal(choice.key, null);
  assert.deepEqual(choice.problem, { kind: "balance", text: "Up to 2.405 SOL: the rest pays the network." });
  assert.equal(routes("quote").length, asked);
  assert.equal(useTrade.getState().quote.status, "none");
  await useTrade.getState().prepare(true);
  await useTrade.getState().press();
  assert.equal(routes("order").length, 0);
  useTrade.getState().setTyped("0");
  assert.equal(choiceNow(SOL_ONLY).problem.kind, "zero");
});

test("a sale of your own amount is typed in the coin; all of it lets the tower's light go", async () => {
  const { routes } = scene({}, { holdings: WITH_USDT });
  useTrade.getState().openFor(TOWER);
  await flush();
  useTrade.getState().setSide("sell");
  await flush();
  useTrade.getState().setTyped("2");
  await flush();
  assert.equal(choiceNow(WITH_USDT).problem.text, "You have 1.5 $USDT. Type that or less.");
  useTrade.getState().setTyped("1.5");
  await flush();
  assert.deepEqual(routes("quote").at(-1).body, { inputMint: USDT, outputMint: WSOL, amountRaw: "1500000" });
  assert.equal(choiceNow(WITH_USDT).all, true);
  await useTrade.getState().prepare(true);
  await useTrade.getState().press();
  const state = useTrade.getState();
  assert.equal(state.phase, "done");
  assert.equal(state.optimistic[USDT].held, false);
  state.again();
  assert.equal(useTrade.getState().typed, "0.1");
});

test("typing drops the price on screen, so a timer left from the tile never orders the half-typed amount", async () => {
  const { routes } = scene({});
  useTrade.getState().openFor(TOWER);
  await flush();
  assert.equal(useTrade.getState().quote.status, "ready");
  useTrade.getState().setTyped("0.5");
  assert.deepEqual(useTrade.getState().quote, { status: "none" });
  // The card's own timer, set for the tile's price, fires now: nothing is ordered.
  await useTrade.getState().prepare(true);
  assert.equal(routes("order").length, 0);
  await flush();
  const choice = choiceNow(SOL_ONLY);
  assert.equal(useTrade.getState().quote.key, choice.key);
  await useTrade.getState().prepare(true);
  assert.equal(routes("order").length, 1);
  assert.equal(routes("order").at(-1).body.input.amountRaw, "500000000");
  assert.equal(useTrade.getState().review.key, choice.key);
});

test("by itself the card orders only the amount whose price is on screen; a tap still orders", async () => {
  const { routes } = scene({});
  useTrade.getState().openFor(TOWER);
  await flush();
  const key = choiceNow(SOL_ONLY).key;
  useTrade.setState({ quote: { status: "none" } });
  await useTrade.getState().prepare(true);
  useTrade.setState({ quote: { status: "loading", key } });
  await useTrade.getState().prepare(true);
  useTrade.setState({ quote: { status: "ready", key: `${key}0`, body: QUOTE, at: T0 } });
  await useTrade.getState().prepare(true);
  assert.equal(routes("order").length, 0);
  assert.equal(useTrade.getState().autoKey, null, "a refused start is not counted as the one try");
  await useTrade.getState().prepare(false);
  assert.equal(routes("order").length, 1);
  assert.equal(useTrade.getState().review.key, key);
});

test("typing goes on over an order the card is building by itself, and that order is dropped", async () => {
  const { routes, signer } = scene({});
  useTrade.getState().openFor(TOWER);
  await flush();
  const building = useTrade.getState().prepare(true);
  assert.equal(useTrade.getState().phase, "preparing");
  assert.equal(useTrade.getState().auto, true);
  useTrade.getState().setTyped("0.");
  let state = useTrade.getState();
  assert.equal(state.typed, "0.");
  assert.equal(state.phase, "idle");
  await building;
  state = useTrade.getState();
  assert.equal(state.review, null, "the order for the tile never reaches the card");
  assert.equal(state.phase, "idle");
  useTrade.getState().setTyped("0.3");
  await flush();
  const choice = choiceNow(SOL_ONLY);
  await useTrade.getState().prepare(true);
  assert.equal(routes("order").at(-1).body.input.amountRaw, "300000000");
  assert.equal(useTrade.getState().review.key, choice.key);
  await useTrade.getState().press();
  assert.equal(signer.shown.length, 1);
  assert.equal(useTrade.getState().phase, "done");
});

test("an order asked by a tap keeps the field shut until it is on the card", async () => {
  scene({});
  useTrade.getState().openFor(TOWER);
  await flush();
  const tapped = useTrade.getState().press();
  assert.equal(useTrade.getState().phase, "preparing");
  assert.equal(useTrade.getState().auto, false);
  useTrade.getState().setTyped("0.7");
  useTrade.getState().setShare(50);
  assert.equal(useTrade.getState().typed, "0.1");
  await tapped;
  const state = useTrade.getState();
  assert.equal(state.phase, "idle");
  assert.equal(state.review.key, choiceNow(SOL_ONLY).key);
});

test("the slider dragged is priced once it rests, for the amount it stopped on", async () => {
  const { routes } = scene({});
  useTrade.getState().openFor(TOWER);
  await flush();
  const asked = routes("quote").length;
  for (const share of [10, 20, 33, 37]) useTrade.getState().setShare(share, "rest");
  // Every step writes the field; the price on screen goes at the first.
  assert.equal(useTrade.getState().typed, "0.89");
  assert.deepEqual(useTrade.getState().quote, { status: "none" });
  await flush();
  assert.equal(routes("quote").length, asked + 1);
  assert.equal(routes("quote").at(-1).body.amountRaw, "890000000");
  const choice = choiceNow(SOL_ONLY);
  assert.equal(Math.round(choice.sizing.share), 37);
  // Back to 0: the field empties, nothing is priced.
  useTrade.getState().setShare(0, "rest");
  await flush();
  assert.equal(useTrade.getState().typed, "");
  assert.equal(routes("quote").length, asked + 1);
  assert.equal(useTrade.getState().quote.status, "none");
});

test("no price from the engine: the card says one calm line, never the setting it lacks", async () => {
  const raw = "Jupiter production access is not configured. Add RYNTRA_JUPITER_API_KEY or explicitly choose the labelled keyless fallback.";
  const { routes } = scene({ quote: [{ status: 503, body: { error: { code: "PROVIDER_KEY_MISSING", message: raw } } }] }, { connection: null, holdings: null });
  useTrade.getState().openFor(TOWER);
  await flush();
  const { quote } = useTrade.getState();
  assert.equal(quote.status, "error");
  assert.equal(quote.refusal.message, "Prices are unavailable right now.");
  assert.equal(quote.refusal.retryable, false);
  assert.doesNotMatch(JSON.stringify(quote), /RYNTRA_|API|Jupiter/);
  assert.equal(routes("order").length, 0);
});

test("MAX of SOL never spends the whole balance: the swap's network cost stays in the wallet", async () => {
  scene({});
  useTrade.getState().openFor(TOWER);
  await flush();
  useTrade.getState().setShare(100, "now");
  await flush();
  const max = choiceNow(SOL_ONLY);
  assert.ok(max.amountRaw);
  assert.ok(BigInt(max.amountRaw) < BigInt(SOL_ONLY.sol.spendableRaw));
  assert.equal(max.sizing.chips.at(-1).on, true);
  // Typing the whole balance is refused in plain words, and nothing is ordered on it.
  useTrade.getState().setTyped("2.41");
  await flush();
  const over = choiceNow(SOL_ONLY);
  assert.equal(over.amountRaw, null);
  assert.equal(over.problem?.kind, "balance");
  assert.doesNotMatch(over.problem.text, /lamport|reserve|API/i);
});
