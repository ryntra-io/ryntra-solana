// Run from repo root: node --test city/lib/earn/dollar.test.mjs
//
// The Dollar Saver (CITY-192): the sentence, the engine's answer read into the card, the amount checked before the tap,
// and the one tap end to end — review, the wallet's signature, the relay — with the engine and the wallet stood in.
// No network, no key and no wallet of anybody's.
import assert from "node:assert/strict";
import { test } from "node:test";

import { readDollarAsk } from "./dollar-read.ts";
import { DOLLAR_MINT, dollarProblem, dollarRaw, dollarText, readDollarSurface, walletSpendable, yearAt } from "./dollar.ts";
import { DOLLAR_OPEN, dollarOpen } from "./dollar-gate.ts";
import { dollarChoice, heldOf, setDollarEnv, setDollarRefusals, useDollar } from "./dollar-store.ts";
import { useEarn } from "./open.ts";
import { fit, keyOf } from "../command/parse.ts";
import { DOORS, run } from "../command/run.ts";

const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const USDC = DOLLAR_MINT.USDC;
const WSOL = DOLLAR_MINT.SOL;

/* ------------------------------------------------------------------------------------------------ The sentence */

test("the owner's three sentences open the Saver: the coin, the side, the amount when said", () => {
  assert.deepEqual(pick(readDollarAsk("поклади мої USDC працювати")), { side: "deposit", asset: "USDC", amount: null });
  assert.deepEqual(pick(readDollarAsk("put my USDC to work")), { side: "deposit", asset: "USDC", amount: null });
  assert.deepEqual(pick(readDollarAsk("поклади 50 USDC під відсоток")), { side: "deposit", asset: "USDC", amount: "50" });
});

test("more ways to say it: lend, SOL, dollars, a comma, taking it back", () => {
  assert.deepEqual(pick(readDollarAsk("lend 100 USDC")), { side: "deposit", asset: "USDC", amount: "100" });
  assert.deepEqual(pick(readDollarAsk("Put $25 to work")), { side: "deposit", asset: "USDC", amount: "25" });
  assert.deepEqual(pick(readDollarAsk("поклади 0,5 SOL під відсоток")), { side: "deposit", asset: "SOL", amount: "0.5" });
  assert.deepEqual(pick(readDollarAsk("позич 2 sol")), { side: "deposit", asset: "SOL", amount: "2" });
  assert.deepEqual(pick(readDollarAsk("let my USDC earn interest")), { side: "deposit", asset: "USDC", amount: null });
  assert.deepEqual(pick(readDollarAsk("забери мої USDC зі скарбнички")), { side: "withdraw", asset: "USDC", amount: null });
  assert.deepEqual(pick(readDollarAsk("withdraw 20 USDC from savings")), { side: "withdraw", asset: "USDC", amount: "20" });
});

test("what is not the Saver's is not read as it: questions, refusals, trades, a top-up, two coins", () => {
  for (const said of [
    "what is the USDC rate?",
    "скільки відсотків на USDC",
    "не клади мої USDC",
    "put 1 SOL into JUP",
    "buy SOL for 50 USDC",
    "deposit 50 USDC",
    "поклади USDC",
    "swap USDC to SOL to earn",
    "lend",
    "забери 50 USDC",
    "",
  ]) {
    assert.equal(readDollarAsk(said), null, said);
  }
  // Two amounts, or an amount in the other coin, is no amount: the card asks.
  assert.equal(readDollarAsk("поклади 50 або 60 USDC під відсоток")?.amount, null);
  assert.equal(readDollarAsk("put 5% of my USDC to work")?.amount, null);
});

test("the line opens the card only where Earn and the Saver's switch are both open", () => {
  const command = { kind: "dollar", ask: readDollarAsk("put my USDC to work") };
  assert.equal(fit(command, { trade: true, spot: true, money: true, earn: true, launch: true, instruct: true }), null, "no switch, no card");
  assert.equal(fit(command, { trade: true, spot: true, money: true, earn: true, launch: true, instruct: true, dollar: true }), command);
  assert.equal(keyOf(command), "dollar:deposit:USDC");
  const calls = [];
  const doors = Object.fromEntries(DOORS.map((name) => [name, (...args) => calls.push([name, ...args])]));
  run(command, doors);
  assert.deepEqual(calls, [["openDollar", command.ask]], "it only opens the card");
});

test("the Saver's switch opens on the exact word «open», and is closed by default", () => {
  assert.equal(dollarOpen("open"), true);
  assert.equal(dollarOpen(" open "), true);
  for (const value of [undefined, "", "on", "OPEN", "true", "canary"]) assert.equal(dollarOpen(value), false, String(value));
  assert.equal(DOLLAR_OPEN, false);
});

/* ------------------------------------------------------------------------------------------------ The engine's answer */

const market = (mint, decimals, extra = {}) => ({
  provider: "jupiter",
  id: mint,
  asset: { mint, symbol: mint === WSOL ? "WSOL" : "USDC", decimals },
  share: { mint: `jl${mint}`.slice(0, 44), symbol: "jl", decimals },
  rateAnnualPercent: 5.3,
  suppliedRaw: "900000000000",
  liquidRaw: "40000000000",
  minimumRaw: mint === WSOL ? "5540000" : "1000000",
  priceUsd: mint === WSOL ? 180.5 : 1,
  readAt: "2026-11-04T10:00:00.000Z",
  ...extra,
});

const SURFACE = (over = {}) => ({
  providers: [
    { provider: "jupiter", ok: true, markets: [market(USDC, 6), market(WSOL, 9, { rateAnnualPercent: 3.75 }), market("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", 6)] },
    { provider: "kamino", ok: false, code: "DISABLED", reason: "off" },
  ],
  positions: [
    { provider: "jupiter", marketId: USDC, asset: { mint: USDC, symbol: "USDC", decimals: 6 }, sharesRaw: "500000000", underlyingRaw: "512400000", depositedRaw: "500000000", earnedRaw: "12400000", availableRaw: "512400000", readAt: "x", readFrom: "rpc" },
    { provider: "jupiter", marketId: WSOL, asset: { mint: WSOL, symbol: "WSOL", decimals: 9 }, sharesRaw: "0", underlyingRaw: "0", depositedRaw: null, earnedRaw: null, availableRaw: "0", readAt: "x", readFrom: "rpc" },
  ],
  actions: { open: true, mode: "OPEN", maxUsd: null },
  feeBps: 0,
  readAt: "2026-11-04T10:00:00.000Z",
  ...over,
});

test("the engine's surface is read into the two coins: by mint, «WSOL» is SOL, an empty position is none", () => {
  const read = readDollarSurface(SURFACE(), OWNER);
  assert.equal(read.provider, true);
  assert.equal(read.markets.USDC.rate, 5.3);
  assert.equal(read.markets.SOL.rate, 3.75, "Jupiter calls its SOL market WSOL: found by mint");
  assert.equal(read.markets.SOL.minimumRaw, 5540000n);
  assert.equal(read.positions.USDC.worthRaw, 512400000n);
  assert.equal(read.positions.USDC.earnedRaw, 12400000n);
  assert.equal(read.positions.SOL, undefined, "no shares, no position");
  assert.equal(read.actions.open, true);
  assert.equal(read.feeBps, 0);

  const guest = readDollarSurface(SURFACE(), null);
  assert.deepEqual(guest.positions, {});
  assert.equal(guest.actions.open, false, "nothing to sign without a wallet");

  const nokey = readDollarSurface(SURFACE({ providers: [{ provider: "jupiter", ok: false, code: "NO_KEY", reason: "x" }] }), OWNER);
  assert.equal(nokey.provider, false);
  assert.equal(nokey.markets.USDC, null, "a provider that did not answer is no market, never a rate of 0");

  const wild = readDollarSurface(SURFACE({ providers: [{ provider: "jupiter", ok: true, markets: [market(USDC, 6, { rateAnnualPercent: 530 })] }] }), OWNER);
  assert.equal(wild.markets.USDC.rate, null, "a rate above 100 % a year is a misread, never shown");
  assert.equal(readDollarSurface({ nope: 1 }, OWNER), null);
});

test("amounts, the SOL the network keeps, a year at today's rate", () => {
  assert.equal(dollarRaw("50", "USDC"), 50_000_000n);
  assert.equal(dollarRaw("0,25", "SOL"), 250_000_000n);
  assert.equal(dollarRaw("0", "USDC"), null);
  assert.equal(dollarRaw("1.1234567", "USDC"), null, "USDC has six places");
  assert.equal(dollarText(512_400_000n, "USDC"), "512.4");
  assert.equal(dollarText(1_234_567_891n, "SOL"), "1.2345");
  assert.equal(walletSpendable("USDC", "248120000"), 248_120_000n);
  assert.equal(walletSpendable("SOL", "1000000000"), 990_000_000n);
  assert.equal(walletSpendable("SOL", "5000000"), 0n);
  assert.equal(walletSpendable("SOL", null), null);
  assert.equal(yearAt(100_000_000n, 5.3), 5_300_000n);
  assert.equal(yearAt(100_000_000n, null), null);
});

test("an amount is checked before the tap: the minimum, the wallet, the position, liquidity, the canary", () => {
  const read = readDollarSurface(SURFACE(), OWNER);
  const base = { side: "deposit", market: read.markets.USDC, walletRaw: 248_120_000n, position: read.positions.USDC, maxUsd: null };
  assert.equal(dollarProblem({ ...base, raw: null }), "zero");
  assert.equal(dollarProblem({ ...base, raw: 500_000n }), "minimum");
  assert.equal(dollarProblem({ ...base, raw: 300_000_000n }), "balance");
  assert.equal(dollarProblem({ ...base, raw: 50_000_000n }), null);
  assert.equal(dollarProblem({ ...base, raw: 50_000_000n, maxUsd: 5 }), "canary");
  assert.equal(dollarProblem({ ...base, raw: 5_000_000n, maxUsd: 5 }), null);
  const out = { ...base, side: "withdraw" };
  assert.equal(dollarProblem({ ...out, raw: 600_000_000n }), "position");
  assert.equal(dollarProblem({ ...out, raw: 100_000_000n }), null);
  assert.equal(dollarProblem({ ...out, raw: 100_000_000n, market: { ...base.market, liquidRaw: 0n } }), "liquidity");
});

test("the wallet's coin as the city reads it: USDC as held, SOL less the network's keep, unread is unknown", () => {
  const holdings = { owner: OWNER, sol: { spendableRaw: "2000000000", decimals: 9 }, tokens: new Map([[USDC, { spendableRaw: "248120000", decimals: 6 }]]), complete: true, at: 0 };
  assert.equal(heldOf("USDC", holdings), 248_120_000n);
  assert.equal(heldOf("SOL", holdings), 1_990_000_000n);
  assert.equal(heldOf("USDC", { ...holdings, tokens: new Map() }), 0n, "a complete read without USDC holds none");
  assert.equal(heldOf("USDC", { ...holdings, tokens: new Map(), complete: false }), null, "a half read is unknown, never zero");
  assert.equal(heldOf("USDC", null), null);
});

/* ------------------------------------------------------------------------------------------------ One tap */

const HOLDINGS = { owner: OWNER, sol: { spendableRaw: "2000000000", decimals: 9 }, tokens: new Map([[USDC, { spendableRaw: "248120000", decimals: 6 }]]), complete: true, at: 0 };
const CONNECTION = { wallet: "Phantom", address: OWNER };

function stage({ review = { ok: true, status: 200 }, signs = true, submit = { ok: true, status: 200, state: "LANDED" }, status = [] } = {}) {
  const calls = [];
  let statusAt = 0;
  setDollarRefusals(() => ({ fallback: "fallback", CANCELLED: "cancelled", UNKNOWN: "unknown", FAILED: "failed", RATE_MOVED: "rate moved", CANARY_LIMIT: "smaller" }));
  setDollarEnv({
    get: async (url) => {
      calls.push(["GET", url]);
      if (url.startsWith("/api/solana/earn/status")) {
        const state = status[statusAt++] ?? "UNKNOWN";
        return { ok: true, status: 200, json: { results: [{ signature: "Sig", state }] } };
      }
      return { ok: true, status: 200, json: SURFACE() };
    },
    post: async (url, body) => {
      calls.push(["POST", url, body]);
      if (url === "/api/solana/earn/review") {
        return review.ok
          ? { ok: true, status: 200, json: { ticket: "sealed.ticket", transaction: { wireBase64: "UNSIGNED", messageSha256: "x" }, amountRaw: body.amount, partial: false } }
          : { ok: false, status: review.status, json: { error: { code: review.code ?? "X", message: "server words never shown" } } };
      }
      if (url === "/api/solana/earn/submit") {
        if (submit.throws) throw new Error("network");
        return submit.ok
          ? { ok: true, status: 200, json: { state: submit.state, signature: "Sig", amountRaw: "50000000" } }
          : { ok: false, status: submit.status, json: { error: { code: submit.code ?? "X" } } };
      }
      return { ok: false, status: 404, json: null };
    },
    sign: async (connection, wire) => {
      calls.push(["SIGN", connection.address, wire]);
      return signs ? { ok: true, signedWireBase64: "SIGNED" } : { ok: false, reason: "User rejected" };
    },
    wallet: () => ({ connection: CONNECTION, holdings: HOLDINGS }),
    refreshHoldings: () => calls.push(["REFRESH"]),
    sleep: async () => {},
  });
  useEarn.setState({ open: true, tab: "shelf", product: "dollar", busy: false });
  useDollar.setState({ asset: "USDC", side: "deposit", typed: "50", surface: { status: "idle" }, phase: "idle", notice: null, done: null, signature: null });
  return calls;
}

test("one tap: the server builds and seals, the wallet signs those bytes, the server sends them; the card says it works", async () => {
  const calls = stage();
  await useDollar.getState().load(OWNER);
  assert.equal(useDollar.getState().surface.status, "ready");
  assert.equal(await useDollar.getState().press(), "ok");
  const posted = calls.filter(([kind]) => kind === "POST");
  assert.deepEqual(posted[0], ["POST", "/api/solana/earn/review", { provider: "jupiter", action: "deposit", owner: OWNER, market: USDC, amount: "50000000" }]);
  assert.deepEqual(calls.find(([kind]) => kind === "SIGN"), ["SIGN", OWNER, "UNSIGNED"], "the wallet signs exactly the server's bytes");
  assert.deepEqual(posted[1], ["POST", "/api/solana/earn/submit", { ticket: "sealed.ticket", signed: "SIGNED" }]);
  const st = useDollar.getState();
  assert.equal(st.phase, "done");
  assert.deepEqual(st.done, { side: "deposit", asset: "USDC", amountRaw: "50000000", signature: "Sig", partial: false });
  assert.equal(useEarn.getState().busy, false);
  assert.ok(calls.some(([kind]) => kind === "REFRESH"), "the wallet is read again");
});

test("a SOL deposit names wrapped SOL's market, the amount in lamports", async () => {
  const calls = stage();
  await useDollar.getState().load(OWNER);
  useDollar.getState().setAsset("SOL");
  useDollar.getState().setTyped("0.5");
  await useDollar.getState().press();
  const review = calls.find(([kind, url]) => kind === "POST" && url === "/api/solana/earn/review");
  assert.equal(review[2].market, WSOL);
  assert.equal(review[2].amount, "500000000");
});

test("taking back starts from the whole position and sends a withdrawal", async () => {
  const calls = stage();
  await useDollar.getState().load(OWNER);
  useDollar.getState().setSide("withdraw");
  assert.equal(useDollar.getState().typed, "512.4", "the whole position, as it can leave today");
  await useDollar.getState().press();
  const review = calls.find(([kind, url]) => kind === "POST" && url === "/api/solana/earn/review");
  assert.equal(review[2].action, "withdraw");
  assert.equal(review[2].amount, "512400000");
  assert.equal(useDollar.getState().done.side, "withdraw");
});

test("nothing is built for an amount the card already refuses, or where the engine takes no actions", async () => {
  let calls = stage();
  await useDollar.getState().load(OWNER);
  useDollar.getState().setTyped("0.5");
  assert.equal(await useDollar.getState().press(), "refused");
  assert.equal(calls.filter(([kind]) => kind === "POST").length, 0, "below the minimum: nothing asked");

  calls = stage();
  setDollarEnv({ get: async () => ({ ok: true, status: 200, json: SURFACE({ actions: { open: false, mode: "CLOSED", maxUsd: null } }) }) });
  await useDollar.getState().load(OWNER);
  assert.equal(await useDollar.getState().press(), "refused");
  assert.equal(calls.filter(([kind]) => kind === "POST" || kind === "SIGN").length, 0, "a closed engine: nothing built, nothing signed");
});

test("a refusal says why in the card's words, and the wallet is never asked", async () => {
  const calls = stage({ review: { ok: false, status: 403, code: "CANARY_LIMIT" } });
  await useDollar.getState().load(OWNER);
  assert.equal(await useDollar.getState().press(), "refused");
  assert.equal(calls.some(([kind]) => kind === "SIGN"), false);
  assert.deepEqual(useDollar.getState().notice, { tone: "error", text: "smaller" });
  assert.equal(useEarn.getState().busy, false);
});

test("a wallet that says no sends nothing", async () => {
  const calls = stage({ signs: false });
  await useDollar.getState().load(OWNER);
  await useDollar.getState().press();
  assert.equal(calls.some(([, url]) => url === "/api/solana/earn/submit"), false);
  assert.equal(useDollar.getState().phase, "idle");
  assert.equal(useDollar.getState().notice.text, "cancelled");
});

test("a rate that moved while the wallet was open: the server holds the bytes, the card says nothing moved", async () => {
  stage({ submit: { ok: false, status: 409, code: "RATE_MOVED" } });
  await useDollar.getState().load(OWNER);
  await useDollar.getState().press();
  assert.equal(useDollar.getState().phase, "idle");
  assert.deepEqual(useDollar.getState().notice, { tone: "warn", text: "rate moved" });
});

test("sent and not yet seen: the signature is read back until the chain answers", async () => {
  const calls = stage({ submit: { ok: true, status: 200, state: "UNKNOWN" }, status: ["UNKNOWN", "LANDED"] });
  await useDollar.getState().load(OWNER);
  await useDollar.getState().press();
  assert.equal(calls.filter(([, url]) => String(url).startsWith("/api/solana/earn/status")).length, 2);
  assert.equal(useDollar.getState().phase, "done");
});

test("an answer lost on the way back is never «nothing happened»", async () => {
  stage({ submit: { throws: true } });
  await useDollar.getState().load(OWNER);
  await useDollar.getState().press();
  assert.equal(useDollar.getState().phase, "unknown");
  assert.equal(useDollar.getState().notice.text, "unknown");
  assert.equal(useEarn.getState().busy, false);
});

test("a sentence fills the card: coin, side, amount — and leaves a signature that is out alone", async () => {
  stage();
  await useDollar.getState().load(OWNER);
  useDollar.getState().fromAsk(readDollarAsk("поклади 0,5 SOL під відсоток"));
  assert.deepEqual([useDollar.getState().asset, useDollar.getState().side, useDollar.getState().typed], ["SOL", "deposit", "0.5"]);
  useDollar.getState().fromAsk(readDollarAsk("забери мої USDC зі скарбнички"));
  assert.deepEqual([useDollar.getState().asset, useDollar.getState().side, useDollar.getState().typed], ["USDC", "withdraw", "512.4"]);
  useDollar.setState({ phase: "wallet" });
  useDollar.getState().fromAsk(readDollarAsk("put my USDC to work"));
  assert.equal(useDollar.getState().side, "withdraw", "a signature out holds the card as it is");
  const choice = dollarChoice(useDollar.getState(), HOLDINGS);
  assert.equal(choice.max, 512_400_000n);
});

function pick(ask) {
  return ask && { side: ask.side, asset: ask.asset, amount: ask.amount };
}

test("the Shelf's rate is found by mint: Jupiter's «WSOL» market is SOL's rate", async () => {
  const { lendRates } = await import("./engine.ts");
  const rates = lendRates(SURFACE());
  assert.equal(rates.usdc, 5.3);
  assert.equal(rates.sol, 3.75);
  assert.deepEqual(lendRates({}), { usdc: null, sol: null, at: null });
});
