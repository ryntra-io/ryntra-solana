import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NO_BADGE_EXTENSIONS,
  QUOTE,
  STOCK_CANDIDATES,
  STOCK_PIER_FLOOR,
  STOCK_PIER_MIN_VOLUME_7D_USD,
  depositUsdOf,
  parseStockBuild,
  quoteUnitsFromText,
  rawPrice,
  readStockPierList,
  shownPrice,
  stockBuildBody,
  stockFit,
  stockMax,
  stockMinimum,
  stockSplit,
  stockWorth,
  usdShort,
  venueAccepts,
  verifyStock,
  volume7d,
} from "./stock-pier.ts";
import { CLOSING_SOON_MS, GUARD_BEFORE_MS, dividendGuard, hoursOf, planDue, stepKind, stepOf, untilText } from "./stock-pier-hours.ts";
import { CLOSED_STATES, STOCK_PIER_CANARY_CEILING_USD, STOCK_PIER_CEILING_USD, admitStockBuild, admitStockExit, stockPierMode, stockPierStates, withinStockCeiling } from "./stock-pier-gate.ts";
import { TSLAX, pair, LIST } from "./stock-pier-fixtures.mjs";

const OWNER = "4EeXyPQ1u3bWMZ3C3BaG2Tn9z8W1E6uN9rT5aS8dPGWw";
const SOL = QUOTE.sol.mint;
const USDC = QUOTE.usdc.mint;
const holdings = (sol, tokens = {}, complete = true) => ({
  owner: OWNER,
  sol: sol === null ? null : { spendableRaw: String(sol), decimals: 9 },
  tokens: new Map(Object.entries(tokens).map(([mint, raw]) => [mint, { spendableRaw: String(raw), decimals: mint === USDC ? 6 : 8 }])),
  complete,
  at: 1,
});

/* ------------------------------------------------------------------ candidates and verification */

test("the candidates are the city's avenue towers — the tokenized stocks it always shows", () => {
  assert.ok(STOCK_CANDIDATES.includes(TSLAX));
  assert.ok(STOCK_CANDIDATES.length >= 15);
  assert.ok(!STOCK_CANDIDATES.includes(SOL));
});

test("seven days of volume add the daily bars inside the week and nothing older", () => {
  const now = Date.UTC(2026, 9, 31, 12);
  const day = 86_400;
  const t = Math.floor(now / 1000);
  const bars = [
    { time: t - 9 * day, volume: 1_000_000 },
    { time: t - 6 * day, volume: 2_000 },
    { time: t - day, volume: 3_000 },
    { time: t, volume: 500 },
    { time: t - 2 * day, volume: Number.NaN },
  ];
  assert.equal(volume7d(bars, now), 5_500);
  assert.equal(volume7d([{ time: t, volume: undefined }], now), null);
  assert.equal(volume7d([], now), null);
});

test("the venue takes a plain token, a Token-2022 mint with nothing that needs a badge, or one whose badge stands", () => {
  const xstock = {
    program: "TOKEN_2022",
    extensions: ["MetadataPointer", "TokenMetadata", "ScaledUiAmountConfig", "PausableConfig", "PermanentDelegate"],
    scaled: true,
    paused: false,
    startsFrozen: false,
  };
  assert.equal(venueAccepts(xstock, false), false, "an xStock needs its badge");
  assert.equal(venueAccepts(xstock, true), true);
  assert.equal(venueAccepts({ ...xstock, extensions: [...NO_BADGE_EXTENSIONS] }, false), true);
  assert.equal(
    venueAccepts(
      {
        program: "SPL_TOKEN",
        extensions: [],
        scaled: false,
        paused: false,
        startsFrozen: false,
      },
      false,
    ),
    true,
  );
});

test("a candidate is offered only when every check holds, and the first that fails is the reason", () => {
  const facts = {
    program: "TOKEN_2022",
    extensions: ["ScaledUiAmountConfig"],
    scaled: true,
    paused: false,
    startsFrozen: false,
  };
  const good = {
    facts,
    badge: true,
    verified: true,
    issuerConfirmed: true,
    halted: false,
    priceUsd: 431.2,
    volume7dUsd: 2_400_000,
  };
  assert.deepEqual(verifyStock(good), { ok: true });
  assert.deepEqual(verifyStock({ ...good, facts: null }), {
    ok: false,
    why: "not-stock",
  });
  assert.deepEqual(verifyStock({ ...good, facts: { ...facts, scaled: false } }), { ok: false, why: "not-stock" });
  assert.deepEqual(verifyStock({ ...good, verified: false }), {
    ok: false,
    why: "unverified",
  });
  assert.deepEqual(verifyStock({ ...good, issuerConfirmed: false }), {
    ok: false,
    why: "unverified",
  });
  assert.deepEqual(verifyStock({ ...good, halted: true }), {
    ok: false,
    why: "halted",
  });
  assert.deepEqual(verifyStock({ ...good, facts: { ...facts, paused: true } }), { ok: false, why: "paused" });
  assert.deepEqual(verifyStock({ ...good, facts: { ...facts, startsFrozen: true } }), { ok: false, why: "frozen" });
  assert.deepEqual(verifyStock({ ...good, badge: false }), {
    ok: false,
    why: "badge",
  });
  assert.deepEqual(verifyStock({ ...good, priceUsd: 0 }), {
    ok: false,
    why: "unpriced",
  });
  assert.deepEqual(verifyStock({ ...good, volume7dUsd: STOCK_PIER_MIN_VOLUME_7D_USD - 1 }), { ok: false, why: "quiet" });
  assert.deepEqual(verifyStock({ ...good, volume7dUsd: null }), {
    ok: false,
    why: "quiet",
  });
});

test("the list reads field by field and leaves out a pair that does not read", () => {
  const list = readStockPierList({
    ...LIST,
    pairs: [...LIST.pairs, { mint: "nope" }, { ...LIST.pairs[0], decimals: 40 }],
  });
  assert.equal(list.pairs.length, LIST.pairs.length);
  assert.equal(list.pairs[0].symbol, "TSLAx");
  assert.equal(list.pairs[0].piers.sol.built, false);
  assert.equal(list.quoteUsd.sol, 184.2);
  assert.equal(readStockPierList(null), null);
  assert.equal(readStockPierList({ pairs: "x" }), null);
});

/* ------------------------------------------------------------------ prices and amounts */

test("the pool's price is per base token: the shown price times the multiplier, in the quote coin", () => {
  const p = pair({ priceUsd: 400, multiplier: 1.0057 });
  assert.equal(shownPrice(p, 200), 2);
  assert.ok(Math.abs(rawPrice(p, 200) - 2.0114) < 1e-9);
  assert.equal(rawPrice(p, null), null);
  assert.equal(rawPrice(p, 0), null);
});

test("an amount of worth splits half into the quote coin and half into the stock at the price", () => {
  const p = pair({ priceUsd: 400, multiplier: 1, decimals: 8 });
  // 1 SOL of worth at SOL $200: 0.5 SOL and $100 of stock — a quarter of a token.
  const split = stockSplit(p, "sol", 200, 1_000_000_000n);
  assert.equal(split.quoteUnits, 500_000_000n);
  assert.equal(split.stockUnits, 25_000_000n);
  assert.equal(split.amountA, "25000000");
  assert.equal(split.amountB, "500000000");
  assert.equal(stockWorth(p, "sol", 200, split.stockUnits), 500_000_000n);
  // In USDC: 20 USDC of worth → 10 USDC and 0.025 of a token.
  const usdc = stockSplit(p, "usdc", 1, 20_000_000n);
  assert.equal(usdc.quoteUnits, 10_000_000n);
  assert.equal(usdc.stockUnits, 2_500_000n);
  assert.equal(stockSplit(p, "sol", null, 1n), null);
  assert.equal(stockSplit(p, "sol", 200, 0n), null);
  assert.ok(Math.abs(depositUsdOf(p, "sol", 200, split.stockUnits, split.quoteUnits) - 200) < 1e-6);
});

test("typed amounts read in the quote coin's own decimals", () => {
  assert.equal(quoteUnitsFromText("1.5", "sol"), 1_500_000_000n);
  assert.equal(quoteUnitsFromText("12,25", "usdc"), 12_250_000n);
  assert.equal(quoteUnitsFromText("0", "sol"), null);
  assert.equal(quoteUnitsFromText("abc", "usdc"), null);
});

test("the minimum keeps what never comes back within a twentieth, never under the floor", () => {
  assert.equal(stockMinimum(null, "sol", 200), STOCK_PIER_FLOOR.sol);
  assert.equal(stockMinimum(1_000_000n, "sol", 200), STOCK_PIER_FLOOR.sol);
  assert.equal(stockMinimum(13_000_000n, "sol", 200), 260_000_000n);
  // 0.013 SOL lost × 20 = 0.26 SOL = $52 at $200.
  assert.equal(stockMinimum(13_000_000n, "usdc", 200), 52_000_000n);
  assert.equal(stockMinimum(13_000_000n, "usdc", null), STOCK_PIER_FLOOR.usdc);
});

test("the wallet must hold both sides, and in SOL what it keeps aside for rent", () => {
  const p = pair({ priceUsd: 400, multiplier: 1, decimals: 8 });
  const split = stockSplit(p, "sol", 200, 1_000_000_000n);
  assert.deepEqual(stockFit(p, "sol", split, holdings(2e9, { [TSLAX]: 30_000_000 }), 30_000_000n), { fits: true, short: null, stockMissing: 0n });
  assert.equal(stockFit(p, "sol", split, holdings(0.52e9, { [TSLAX]: 30_000_000 }), 30_000_000n).short, "quote");
  const short = stockFit(p, "sol", split, holdings(2e9, { [TSLAX]: 5_000_000 }), 30_000_000n);
  assert.equal(short.short, "stock");
  assert.equal(short.stockMissing, 20_000_000n);
  assert.equal(stockFit(p, "sol", split, null, 30_000_000n).fits, true, "unknown wallet: the engine has the last word");
  // USDC pier: SOL is still needed for rent.
  const usdc = stockSplit(p, "usdc", 1, 20_000_000n);
  assert.equal(stockFit(p, "usdc", usdc, holdings(0.001e9, { [USDC]: 50_000_000, [TSLAX]: 9_000_000 }), 30_000_000n).short, "quote");
  assert.equal(stockFit(p, "usdc", usdc, holdings(1e9, { [USDC]: 50_000_000, [TSLAX]: 9_000_000 }), 30_000_000n).fits, true);
});

test("the most it can put in is twice the smaller side", () => {
  const p = pair({ priceUsd: 400, multiplier: 1, decimals: 8 });
  // 1.03 SOL − 0.03 kept = 1 SOL; 0.1 token = $40 = 0.2 SOL → 0.4 SOL of worth.
  assert.equal(stockMax(p, "sol", 200, holdings(1.03e9, { [TSLAX]: 10_000_000 }), 30_000_000n), 400_000_000n);
  assert.equal(stockMax(p, "sol", 200, holdings(null, {}, false), 30_000_000n), null);
});

test("the door's body reads field by field", () => {
  const p = pair({});
  const split = stockSplit(p, "sol", 200, 1_000_000_000n);
  const body = stockBuildBody(p, "sol", OWNER, split);
  assert.deepEqual(parseStockBuild(body), body);
  assert.equal(parseStockBuild({ ...body, quote: "eth" }), null);
  assert.equal(parseStockBuild({ ...body, amountA: "0" }), null);
  assert.equal(parseStockBuild({ ...body, amountB: "1.5" }), null);
  assert.equal(parseStockBuild({ ...body, stock: "x" }), null);
  assert.equal(parseStockBuild({ ...body, action: "add" }), null);
});

test("dollar figures read short", () => {
  assert.equal(usdShort(2_412_000), "$2.4M");
  assert.equal(usdShort(84_300), "$84K");
  assert.equal(usdShort(1_250), "$1.3K");
  assert.equal(usdShort(950), "$950");
  assert.equal(usdShort(null), "—");
});

/* ------------------------------------------------------------------ hours and the dividend guard */

test("the hours come from the issuer's session: open, closing within the hour, closed, or not known", () => {
  const now = Date.UTC(2026, 9, 30, 18);
  assert.deepEqual(hoursOf({ open: true, nextChangeAt: new Date(now + 3 * 3_600_000).toISOString() }, now), { state: "open", nextAt: now + 3 * 3_600_000 });
  assert.equal(
    hoursOf(
      {
        open: true,
        nextChangeAt: new Date(now + CLOSING_SOON_MS - 1).toISOString(),
      },
      now,
    ).state,
    "closing",
  );
  assert.equal(
    hoursOf(
      {
        open: false,
        nextChangeAt: new Date(now + 60 * 3_600_000).toISOString(),
      },
      now,
    ).state,
    "closed",
  );
  assert.equal(hoursOf({ open: null, nextChangeAt: null }, now).state, "unknown");
  assert.equal(hoursOf(null, now).state, "unknown");
  assert.equal(hoursOf({ open: true, nextChangeAt: new Date(now - 1).toISOString() }, now).nextAt, null);
});

test("a plan to leave asks for the tap only while the exchange closes or is closed", () => {
  assert.equal(planDue("leave", { state: "closing", nextAt: 1 }), true);
  assert.equal(planDue("leave", { state: "closed", nextAt: 1 }), true);
  assert.equal(planDue("leave", { state: "open", nextAt: 1 }), false);
  assert.equal(planDue("stay", { state: "closed", nextAt: 1 }), false);
});

test("a dividend step holds new liquidity from a day before to a quarter of an hour after", () => {
  const at = Date.UTC(2026, 10, 3, 14, 30);
  const step = { at: new Date(at).toISOString(), from: 1.0057, to: 1.0089 };
  assert.equal(stepKind(step), "dividend");
  assert.equal(dividendGuard(step, at - 3 * GUARD_BEFORE_MS).kind, "ahead");
  assert.deepEqual(dividendGuard(step, at - GUARD_BEFORE_MS - 1), {
    kind: "ahead",
    step: "dividend",
    at,
    holdFrom: at - GUARD_BEFORE_MS,
  });
  assert.deepEqual(dividendGuard(step, at - GUARD_BEFORE_MS), {
    kind: "hold",
    step: "dividend",
    at,
    until: at + 15 * 60_000,
  });
  assert.equal(dividendGuard(step, at + 15 * 60_000).kind, "hold");
  assert.equal(dividendGuard(step, at + 15 * 60_000 + 1).kind, "none");
  assert.equal(dividendGuard(step, at - 8 * GUARD_BEFORE_MS).kind, "none", "a week off is not in sight");
});

test("a split holds only the issuer's quarter of an hour either side; a no-step is nothing", () => {
  const at = Date.UTC(2026, 10, 3, 14, 30);
  const split = { at: new Date(at).toISOString(), from: 1, to: 2 };
  assert.equal(stepKind(split), "split");
  assert.equal(dividendGuard(split, at - 3_600_000).kind, "ahead");
  assert.equal(dividendGuard(split, at - 10 * 60_000).kind, "hold");
  assert.equal(stepKind({ at: split.at, from: 1, to: 0.9317 }), "units");
  assert.equal(dividendGuard(null, at).kind, "none");
  assert.equal(dividendGuard({ ...split, to: 1 }, at).kind, "none");
  assert.equal(dividendGuard({ ...split, at: "soon" }, at).kind, "none");
});

test("the chain's Scaled UI config gives the step, pending or just taken", () => {
  assert.deepEqual(
    stepOf({
      multiplier: 1,
      newMultiplier: 1.004,
      newMultiplierEffectiveAt: "2026-11-03T14:30:00.000Z",
    }),
    { at: "2026-11-03T14:30:00.000Z", from: 1, to: 1.004 },
  );
  assert.equal(
    stepOf({
      multiplier: 1.004,
      newMultiplier: 1.004,
      newMultiplierEffectiveAt: "2026-11-03T14:30:00.000Z",
    }),
    null,
  );
  assert.equal(
    stepOf({
      multiplier: 1,
      newMultiplier: 1.004,
      newMultiplierEffectiveAt: null,
    }),
    null,
  );
  assert.equal(stepOf(null), null);
});

test("time left reads in days, hours or minutes", () => {
  const w = { d: "d", h: "h", min: "min" };
  assert.equal(untilText(9 * 3_600_000, 0, w), "9 h");
  assert.equal(untilText(40 * 60_000, 0, w), "40 min");
  assert.equal(untilText(3 * 86_400_000, 0, w), "3 d");
});

/* ------------------------------------------------------------------ the switch */

test("the switch: closed by default, canary for one named wallet, open for all; the stop holds new money only", () => {
  assert.equal(stockPierMode(undefined), "closed");
  assert.equal(stockPierMode("OPEN "), "open");
  assert.equal(stockPierMode("yes"), "closed");
  const canary = {
    NEXT_PUBLIC_RYNTRA_CITY_STOCK_PIER: "canary",
    RYNTRA_CITY_STOCK_PIER_CANARY_WALLET: OWNER,
  };
  assert.deepEqual(admitStockBuild(OWNER, {}), {
    ok: false,
    code: "STOCK_PIER_CLOSED",
  });
  assert.deepEqual(admitStockBuild(OWNER, canary), {
    ok: true,
    mode: "canary",
    ceilingUsd: STOCK_PIER_CANARY_CEILING_USD,
  });
  assert.deepEqual(admitStockBuild("Someone1111111111111111111111111111111111", canary), { ok: false, code: "STOCK_PIER_CLOSED" });
  assert.deepEqual(admitStockBuild(OWNER, { NEXT_PUBLIC_RYNTRA_CITY_STOCK_PIER: "canary" }), { ok: false, code: "STOCK_PIER_CLOSED" }, "a canary without a wallet admits nobody");
  const open = { NEXT_PUBLIC_RYNTRA_CITY_STOCK_PIER: "open" };
  assert.deepEqual(admitStockBuild(null, open), {
    ok: true,
    mode: "open",
    ceilingUsd: STOCK_PIER_CEILING_USD,
  });
  assert.deepEqual(admitStockBuild(OWNER, { ...open, RYNTRA_CITY_STOCK_PIER_STOP: "1" }), { ok: false, code: "STOCK_PIER_STOPPED" });
  assert.equal(admitStockBuild(OWNER, { ...open, RYNTRA_CITY_STOCK_PIER_STOP: "off" }).ok, true);
  assert.equal(admitStockExit(OWNER, { ...open, RYNTRA_CITY_STOCK_PIER_STOP: "1" }), true, "the stop never holds money in");
  assert.equal(admitStockExit(OWNER, canary), true);
  assert.equal(admitStockExit("Someone1111111111111111111111111111111111", canary), false);
  assert.equal(admitStockExit(OWNER, {}), false);
});

test("the city's word and the engine's together: the lower ceiling, on only where both say on", () => {
  const on = { status: "on" };
  const later = { status: "later" };
  const open = { NEXT_PUBLIC_RYNTRA_CITY_STOCK_PIER: "open" };
  assert.deepEqual(stockPierStates(OWNER, open, { add: on, remove: on, maxDepositUsd: null }), { build: "on", exit: "on", ceilingUsd: 1000, stopped: false });
  assert.deepEqual(stockPierStates(OWNER, open, { add: on, remove: on, maxDepositUsd: 5 }), { build: "on", exit: "on", ceilingUsd: 5, stopped: false });
  assert.deepEqual(
    stockPierStates(OWNER, open, {
      add: later,
      remove: later,
      maxDepositUsd: null,
    }),
    CLOSED_STATES,
  );
  assert.deepEqual(stockPierStates(OWNER, { ...open, RYNTRA_CITY_STOCK_PIER_STOP: "yes" }, { add: on, remove: on, maxDepositUsd: null }), {
    build: "off",
    exit: "on",
    ceilingUsd: null,
    stopped: true,
  });
  assert.equal(withinStockCeiling(999, 1000), true);
  assert.equal(withinStockCeiling(1001, 1000), false);
  assert.equal(withinStockCeiling(null, 1000), false);
});
